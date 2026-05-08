import { describe, it, expect } from 'vitest';
import { runProxy } from '../index.js';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The proxy spawns a real child process. We use a small Node script as the
 * "upstream MCP server" so the test exercises the actual stdio + framing
 * path.
 */
function makeUpstream(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'octerse-shrink-test-'));
  const file = join(dir, 'server.mjs');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

function collectChunks(): { stream: Writable; buffer: () => Buffer; waitFor: (re: RegExp) => Promise<string> } {
  const chunks: Buffer[] = [];
  let waiter: { re: RegExp; resolve: (s: string) => void } | null = null;
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      if (waiter) {
        const text = Buffer.concat(chunks).toString('utf8');
        if (waiter.re.test(text)) {
          const w = waiter;
          waiter = null;
          w.resolve(text);
        }
      }
      cb();
    },
  });
  return {
    stream,
    buffer: () => Buffer.concat(chunks),
    waitFor: (re: RegExp) =>
      new Promise<string>((resolve) => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (re.test(text)) {
          resolve(text);
          return;
        }
        waiter = { re, resolve };
      }),
  };
}

function pushable(): { stream: Readable; push: (b: Buffer) => void; end: () => void } {
  const stream = new Readable({ read() { /* no-op; data is pushed externally */ } });
  return {
    stream,
    push: (b: Buffer) => { stream.push(b); },
    end: () => { stream.push(null); },
  };
}

describe('runProxy — ndjson framing', () => {
  it('compresses tools/list response descriptions', async () => {
    const upstream = makeUpstream(`#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: {
        tools: [
          { name: 'a', description: 'This tool is used to do very robust things.' },
          { name: 'b', description: 'Use this tool in order to write files.' },
        ]
      }
    }) + '\\n');
  }
});
`);

    const stdin = pushable();
    const out = collectChunks();
    const err = collectChunks();

    const exitP = runProxy({
      command: process.execPath,
      args: [upstream],
      stdin: stdin.stream,
      stdout: out.stream,
      stderr: err.stream,
    });

    stdin.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n'));

    const text = await out.waitFor(/"id":1/);
    stdin.end();
    await exitP;

    const lines = text.split('\n').filter(Boolean);
    const resp = JSON.parse(lines[lines.length - 1]!);
    expect(resp.result.tools[0].description).not.toMatch(/very robust/i);
    expect(resp.result.tools[1].description).toMatch(/^Write files/i);
  });

  it('passes tools/call responses through byte-for-byte', async () => {
    const callResultText = 'This tool is used to NOT be compressed at all in order to win.';
    const upstream = makeUpstream(`#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: {
        content: [{ type: 'text', text: ${JSON.stringify(callResultText)} }],
        description: ${JSON.stringify(callResultText)}
      }
    }) + '\\n');
  }
});
`);

    const stdin = pushable();
    const out = collectChunks();
    const err = collectChunks();

    const exitP = runProxy({
      command: process.execPath,
      args: [upstream],
      stdin: stdin.stream,
      stdout: out.stream,
      stderr: err.stream,
    });

    stdin.push(
      Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x' } }) + '\n'),
    );
    const text = await out.waitFor(/"id":7/);
    stdin.end();
    await exitP;

    const lines = text.split('\n').filter(Boolean);
    const resp = JSON.parse(lines[lines.length - 1]!);
    // tools/call result is NOT in COMPRESSED_METHODS — description in result
    // must survive verbatim.
    expect(resp.result.description).toBe(callResultText);
    expect(resp.result.content[0].text).toBe(callResultText);
  });

  it('passthrough mode does not compress tools/list', async () => {
    const upstream = makeUpstream(`#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'a', description: 'This tool is used to do very robust things.' }] }
    }) + '\\n');
  }
});
`);

    const stdin = pushable();
    const out = collectChunks();
    const err = collectChunks();

    const exitP = runProxy({
      command: process.execPath,
      args: [upstream],
      passthrough: true,
      stdin: stdin.stream,
      stdout: out.stream,
      stderr: err.stream,
    });

    stdin.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n'));
    const text = await out.waitFor(/"id":1/);
    stdin.end();
    await exitP;

    const lines = text.split('\n').filter(Boolean);
    const resp = JSON.parse(lines[lines.length - 1]!);
    expect(resp.result.tools[0].description).toMatch(/very robust/i);
  });

  it('records onStats for compressed responses', async () => {
    const upstream = makeUpstream(`#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'a', description: 'This tool is used to do very robust things in order to win.' }] }
    }) + '\\n');
  }
});
`);

    const stdin = pushable();
    const out = collectChunks();
    const err = collectChunks();
    const stats: Array<{ method: string; bytesIn: number; bytesOut: number; fields: number }> = [];

    const exitP = runProxy({
      command: process.execPath,
      args: [upstream],
      stdin: stdin.stream,
      stdout: out.stream,
      stderr: err.stream,
      onStats: (s) => stats.push(s),
    });

    stdin.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n'));
    await out.waitFor(/"id":1/);
    stdin.end();
    await exitP;

    expect(stats).toHaveLength(1);
    expect(stats[0]?.method).toBe('tools/list');
    expect(stats[0]?.bytesOut).toBeLessThan(stats[0]!.bytesIn);
  });
});

describe('cli — direct invocation', () => {
  const cli = join(import.meta.dirname ?? __dirname, '..', '..', 'dist', 'cli.js');

  it('prints help with --help (when built)', () => {
    if (!existsSync(cli)) return; // build hasn't run yet — covered post-build
    const r = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/octerse-shrink/);
  });
});
