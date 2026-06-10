/**
 * MCP stdio middleware. Spawns an upstream MCP server, proxies JSON-RPC
 * messages between client (parent stdin/stdout) and server (child
 * stdin/stdout), and rewrites only the `description` fields inside
 * `tools/list`, `prompts/list`, and `resources/list` responses.
 *
 * Tool calls (`tools/call`) and every other RPC pass through unchanged.
 *
 * Exit codes mirror the upstream child. stderr from the child is piped
 * through verbatim so users still see its diagnostics.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { compressListPayload } from './compress.js';

export interface ProxyOptions {
  /** Upstream MCP server command, e.g. "npx" */
  command: string;
  /** Arguments for the upstream server. */
  args: string[];
  /** Environment variables to inherit / override for the child. */
  env?: NodeJS.ProcessEnv;
  /** Set to true to pass payloads through without compressing. */
  passthrough?: boolean;
  /** stdin stream (default: process.stdin). */
  stdin?: Readable;
  /** stdout stream (default: process.stdout). */
  stdout?: Writable;
  /** stderr stream (default: process.stderr). */
  stderr?: Writable;
  /** Optional callback invoked once per compressed response with byte stats. */
  onStats?: (stats: { method: string; bytesIn: number; bytesOut: number; fields: number }) => void;
}

const COMPRESSED_METHODS = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
]);

/**
 * Frame parser for a Content-Length-delimited stream (used by some MCP
 * transports) AND a newline-delimited JSON stream (used by others). We
 * detect on first frame and stay with the chosen mode.
 */
type FrameMode = 'unknown' | 'lsp' | 'ndjson';

class JsonRpcFramer {
  private buf = Buffer.alloc(0);
  private mode: FrameMode = 'unknown';

  push(chunk: Buffer): unknown[] {
    // Zero-copy in the common case: previous frames were fully consumed.
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    while (true) {
      if (this.mode === 'unknown') {
        const head = this.buf.toString('utf8', 0, Math.min(this.buf.length, 32));
        if (/^Content-Length:/i.test(head)) {
          this.mode = 'lsp';
        } else if (/^[\s]*[\{\[]/.test(head)) {
          this.mode = 'ndjson';
        } else {
          break;
        }
      }

      const before = this.buf.length;
      const frame = this.mode === 'lsp' ? this.readLsp() : this.readNdjson();
      if (frame !== undefined) {
        out.push(frame);
        continue;
      }
      // No frame produced. If no bytes were consumed we need more data;
      // otherwise we skipped garbage (blank line, garbled header) — retry,
      // since complete frames may still be buffered behind it.
      if (this.buf.length === before) break;
    }
    return out;
  }

  encode(value: unknown): Buffer {
    const json = JSON.stringify(value);
    if (this.mode === 'lsp') {
      const body = Buffer.from(json, 'utf8');
      const header = `Content-Length: ${body.length}\r\n\r\n`;
      return Buffer.concat([Buffer.from(header, 'utf8'), body]);
    }
    return Buffer.from(json + '\n', 'utf8');
  }

  /** Best-effort encode in the framing mode used by the *peer* we're sending to. */
  encodeAs(mode: FrameMode, value: unknown): Buffer {
    const saved = this.mode;
    this.mode = mode === 'unknown' ? 'ndjson' : mode;
    const out = this.encode(value);
    this.mode = saved;
    return out;
  }

  get framing(): FrameMode {
    return this.mode;
  }

  private readLsp(): unknown | undefined {
    // Look for header terminator
    const headerEnd = this.buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) return undefined;
    const header = this.buf.toString('utf8', 0, headerEnd);
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) {
      // Garbled — drop a byte and retry.
      this.buf = this.buf.subarray(1);
      return undefined;
    }
    const len = Number(m[1]);
    const start = headerEnd + 4;
    if (this.buf.length < start + len) return undefined;
    const body = this.buf.subarray(start, start + len).toString('utf8');
    this.buf = this.buf.subarray(start + len);
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }

  private readNdjson(): unknown | undefined {
    const nl = this.buf.indexOf(0x0a); // \n
    if (nl < 0) return undefined;
    const line = this.buf.subarray(0, nl).toString('utf8').trim();
    this.buf = this.buf.subarray(nl + 1);
    if (!line) return undefined;
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  }
}

interface PendingRequest {
  method: string;
}

/**
 * Run the proxy. Resolves with the child's exit code.
 */
export function runProxy(opts: ProxyOptions): Promise<number> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const passthrough = opts.passthrough === true;

  const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(
    opts.command,
    opts.args,
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    },
  ) as ChildProcessByStdio<Writable, Readable, Readable>;

  child.stderr.on('data', (c: Buffer) => stderr.write(c));

  const inFramer = new JsonRpcFramer();   // client → server
  const outFramer = new JsonRpcFramer();  // server → client
  const pending = new Map<string | number, PendingRequest>();

  stdin.on('data', (chunk: Buffer) => {
    const msgs = inFramer.push(chunk);
    for (const msg of msgs) {
      if (isRequest(msg)) {
        pending.set(msg.id, { method: msg.method });
      }
      child.stdin.write(inFramer.encode(msg));
    }
  });

  child.stdout.on('data', (chunk: Buffer) => {
    const msgs = outFramer.push(chunk);
    for (const raw of msgs) {
      let out = raw;
      if (!passthrough && isResponse(raw)) {
        const req = pending.get(raw.id);
        if (req && COMPRESSED_METHODS.has(req.method) && raw.result !== undefined) {
          const { payload, stats } = compressListPayload(raw.result);
          out = { ...raw, result: payload };
          if (stats.fields > 0 && opts.onStats) {
            opts.onStats({
              method: req.method,
              bytesIn: stats.bytesIn,
              bytesOut: stats.bytesOut,
              fields: stats.fields,
            });
          }
        }
      }
      if (raw && typeof raw === 'object' && 'id' in (raw as object)) {
        pending.delete((raw as { id: string | number }).id);
      }
      // Echo back to client using the framing the *client* used.
      stdout.write(inFramer.encodeAs(inFramer.framing, out));
    }
  });

  return new Promise((resolve) => {
    const onClose = (code: number | null) => {
      try { child.stdin.end(); } catch { /* ignore */ }
      resolve(code ?? 0);
    };
    child.on('close', onClose);
    child.on('error', (err: Error) => {
      stderr.write(`octerse-shrink: upstream spawn error: ${err.message}\n`);
      resolve(1);
    });
    stdin.on('end', () => {
      try { child.stdin.end(); } catch { /* ignore */ }
    });
  });
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: unknown;
}

function isRequest(v: unknown): v is JsonRpcRequest {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { method?: unknown }).method === 'string' &&
    (v as { id?: unknown }).id !== undefined
  );
}

function isResponse(v: unknown): v is JsonRpcResponse {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { id?: unknown }).id !== undefined &&
    ('result' in (v as object) || 'error' in (v as object))
  );
}
