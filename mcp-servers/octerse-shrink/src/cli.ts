#!/usr/bin/env node
/**
 * octerse-shrink — MCP stdio middleware + markdown compressor.
 *
 * Two modes:
 *
 *   octerse-shrink [flags] -- <upstream-mcp-cmd> [args...]   (proxy mode)
 *   octerse-shrink compress [flags] [<file> | --stdin]        (markdown mode)
 *
 * Examples:
 *   octerse-shrink -- npx -y @modelcontextprotocol/server-filesystem /repo
 *   octerse-shrink compress AGENTS.md
 *   octerse-shrink compress --stdin < AGENTS.md > AGENTS.compressed.md
 *
 * Environment:
 *   OCTERSE_SHRINK=0           bypass (passthrough) without removing the wrapper.
 *   OCTERSE_SHRINK_BYPASS=...  comma-separated list of upstream argv[0] values
 *                              that should be passed through (e.g. server-x,server-y).
 *   OCTERSE_SHRINK_STATS=1     write compression stats to stderr at SIGINT/exit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { runProxy } from './index.js';
import { compressMarkdown } from './markdown.js';

const VERSION = '0.6.0';

interface CliArgs {
  passthrough: boolean;
  showHelp: boolean;
  showVersion: boolean;
  command: string | null;
  args: string[];
  stats: boolean;
}

function parse(argv: string[]): CliArgs {
  const out: CliArgs = {
    passthrough: false,
    showHelp: false,
    showVersion: false,
    command: null,
    args: [],
    stats: process.env.OCTERSE_SHRINK_STATS === '1',
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--') {
      i++;
      out.command = argv[i] ?? null;
      out.args = argv.slice(i + 1);
      break;
    }
    if (a === '--no-compress') { out.passthrough = true; i++; continue; }
    if (a === '--help' || a === '-h') { out.showHelp = true; i++; continue; }
    if (a === '--version' || a === '-v') { out.showVersion = true; i++; continue; }
    if (a === '--stats') { out.stats = true; i++; continue; }
    // Anything else BEFORE -- is an unknown flag.
    if (a.startsWith('-')) {
      throw new CliError(`unknown flag: ${a}`);
    }
    // Bare command form: `octerse-shrink npx -y …` (without `--`).
    out.command = a;
    out.args = argv.slice(i + 1);
    break;
  }

  return out;
}

class CliError extends Error {}

const HELP = `octerse-shrink ${VERSION} — MCP stdio middleware + markdown compressor

Usage:
  octerse-shrink [flags] -- <upstream-cmd> [args...]   (proxy mode)
  octerse-shrink [flags] <upstream-cmd> [args...]
  octerse-shrink compress [flags] [<file> | --stdin]   (markdown mode)

Proxy flags:
  --no-compress         passthrough mode (still wraps stdio, but doesn't shrink)
  --stats               write compression stats to stderr at exit

Compress flags:
  --stdin               read from stdin and write to stdout
  --force               re-compress an already-compressed file
  --check               exit 0 if input is already compressed, else 1

General:
  -h, --help            this help
  -v, --version         print version and exit

Environment:
  OCTERSE_SHRINK=0      same as --no-compress (proxy mode only)
  OCTERSE_SHRINK_BYPASS comma-separated upstream cmds to passthrough

Privacy:
  Reads only stdin/the file you name; writes only stdout/stderr/that file.
  No network, no telemetry. Tool calls (tools/call) are NEVER touched.
`;

async function compressMain(rest: string[]): Promise<number> {
  let stdin = false;
  let force = false;
  let check = false;
  let file: string | null = null;

  for (const a of rest) {
    if (a === '--stdin') stdin = true;
    else if (a === '--force') force = true;
    else if (a === '--check') check = true;
    else if (a.startsWith('-')) {
      process.stderr.write(`octerse-shrink compress: unknown flag: ${a}\n`);
      return 2;
    } else if (file === null) file = a;
    else {
      process.stderr.write(`octerse-shrink compress: too many arguments\n`);
      return 2;
    }
  }

  if (stdin && file !== null) {
    process.stderr.write(`octerse-shrink compress: --stdin and <file> are mutually exclusive\n`);
    return 2;
  }
  if (!stdin && file === null) {
    process.stderr.write(`octerse-shrink compress: provide a file or --stdin\n`);
    return 2;
  }

  const input = stdin
    ? await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
      })
    : readFileSync(file!, 'utf8');

  const r = compressMarkdown(input, { force });

  if (check) {
    return r.refusal === 'already-compressed' ? 0 : 1;
  }

  if (r.refusal === 'already-compressed') {
    process.stderr.write(
      `octerse-shrink compress: ${stdin ? '(stdin)' : file} already compressed (use --force to redo)\n`,
    );
    if (stdin) process.stdout.write(input);
    return 0;
  }
  if (r.refusal === 'keep-span-covers-all') {
    process.stderr.write(
      `octerse-shrink compress: <!-- octerse:keep --> covers entire file; nothing to do\n`,
    );
    return 1;
  }
  if (r.refusal === 'no-savings') {
    process.stderr.write(
      `octerse-shrink compress: ${stdin ? '(stdin)' : file} is already terse — marker overhead would exceed savings; leaving unchanged\n`,
    );
    if (stdin) process.stdout.write(input);
    return 0;
  }

  if (stdin) {
    process.stdout.write(r.body);
  } else {
    writeFileSync(file!, r.body);
  }
  process.stderr.write(
    `octerse-shrink compress: ${r.bytesIn} → ${r.bytesOut} bytes (-${
      r.bytesIn > 0 ? Math.round(((r.bytesIn - r.bytesOut) / r.bytesIn) * 100) : 0
    }%)\n`,
  );
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);

  // Subcommand dispatch — must come before generic flag parsing so that
  // `octerse-shrink compress --help` is recognised.
  if (argv[0] === 'compress') {
    const rest = argv.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(HELP);
      process.exit(0);
    }
    process.exit(await compressMain(rest));
  }

  let args: CliArgs;
  try {
    args = parse(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`octerse-shrink: ${err.message}\n${HELP}`);
      process.exit(2);
    }
    throw err;
  }

  if (args.showHelp) { process.stdout.write(HELP); process.exit(0); }
  if (args.showVersion) { process.stdout.write(`octerse-shrink ${VERSION}\n`); process.exit(0); }

  if (!args.command) {
    process.stderr.write('octerse-shrink: missing upstream command. Try --help.\n');
    process.exit(2);
  }

  // Env-driven passthrough.
  let passthrough = args.passthrough;
  if (process.env.OCTERSE_SHRINK === '0') passthrough = true;
  const bypass = (process.env.OCTERSE_SHRINK_BYPASS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (bypass.includes(args.command)) passthrough = true;

  const totals = { fields: 0, bytesIn: 0, bytesOut: 0 };
  const code = await runProxy({
    command: args.command,
    args: args.args,
    passthrough,
    onStats: args.stats
      ? (s) => {
          totals.fields += s.fields;
          totals.bytesIn += s.bytesIn;
          totals.bytesOut += s.bytesOut;
        }
      : undefined,
  });

  if (args.stats && totals.fields > 0) {
    const saved = totals.bytesIn - totals.bytesOut;
    const pct = totals.bytesIn > 0 ? Math.round((saved / totals.bytesIn) * 100) : 0;
    process.stderr.write(
      `octerse-shrink: ${totals.fields} fields · ${totals.bytesIn} → ${totals.bytesOut} bytes (-${pct}%)\n`,
    );
  }

  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`octerse-shrink: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
