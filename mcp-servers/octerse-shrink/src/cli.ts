#!/usr/bin/env node
/**
 * octerse-shrink — MCP stdio middleware that compresses tool/prompt/resource
 * description fields. Usage:
 *
 *   octerse-shrink [--no-compress] -- <upstream-mcp-cmd> [args...]
 *
 * Examples:
 *   octerse-shrink -- npx -y @modelcontextprotocol/server-filesystem /repo
 *   octerse-shrink --no-compress -- python -m my_mcp_server
 *
 * Environment:
 *   OCTERSE_SHRINK=0           bypass (passthrough) without removing the wrapper.
 *   OCTERSE_SHRINK_BYPASS=...  comma-separated list of upstream argv[0] values
 *                              that should be passed through (e.g. server-x,server-y).
 *   OCTERSE_SHRINK_STATS=1     write compression stats to stderr at SIGINT/exit.
 */

import { runProxy } from './index.js';

const VERSION = '0.3.0';

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

const HELP = `octerse-shrink ${VERSION} — MCP stdio middleware (description-only compression)

Usage:
  octerse-shrink [flags] -- <upstream-cmd> [args...]
  octerse-shrink [flags] <upstream-cmd> [args...]

Flags:
  --no-compress         passthrough mode (still wraps stdio, but doesn't shrink)
  --stats               write compression stats to stderr at exit
  -h, --help            this help
  -v, --version         print version and exit

Environment:
  OCTERSE_SHRINK=0      same as --no-compress
  OCTERSE_SHRINK_BYPASS comma-separated upstream cmds to passthrough

Privacy:
  Reads only stdin; writes only stdout/stderr. No network, no telemetry.
  Tool calls (tools/call) and every other RPC are NEVER touched.
`;

async function main() {
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
