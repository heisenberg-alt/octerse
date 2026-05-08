# octerse-shrink

[![npm](https://img.shields.io/npm/v/octerse-shrink.svg)](https://www.npmjs.com/package/octerse-shrink)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/heisenberg-alt/octerse/blob/main/LICENSE)

> Deterministic stdio middleware that compresses MCP tool / prompt / resource
> `description` fields. Tool calls are never touched. No LLM, no telemetry, no
> persistence.

Part of the [octerse](https://github.com/heisenberg-alt/octerse) project — the
**output** lever for GitHub Copilot UBB.

## Why

MCP servers love verbose tool descriptions ("This tool is used to allow you to
perform comprehensive filesystem operations in order to read, write, as well as
delete files…"). Every Copilot Chat session ships those descriptions on every
turn. With 6–10 servers loaded, you can easily pay for 4–8 KB of fluff per turn
that adds zero signal.

`octerse-shrink` is a tiny stdio proxy you put in front of any MCP server. It
walks the JSON-RPC stream, finds `tools/list`, `prompts/list`, `resources/list`,
and `resources/templates/list` responses, and compresses every nested
`description` field through a deterministic rule pipeline.

`tools/call` — the actual tool I/O — is **never** rewritten. Pass-through is
byte-for-byte.

## Install

```sh
# Run on demand (no install)
npx -y octerse-shrink -- <upstream-mcp-cmd>

# Or install globally
npm i -g octerse-shrink
octerse-shrink -- <upstream-mcp-cmd>
```

## Use it in `.vscode/mcp.json`

Wrap any stdio server. The `--` separator distinguishes shrink's own flags from
the upstream command.

```jsonc
{
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", "octerse-shrink", "--",
        "npx", "-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"
      ]
    }
  }
}
```

The `gh octerse install --with-shrink` flag (in the parent repo) appends the
above as a **commented** example to your `.vscode/mcp.json` so you can copy and
enable per-server.

## CLI

```text
octerse-shrink [flags] -- <upstream-cmd> [args...]

Flags:
  --no-compress         passthrough mode (still wraps stdio, but doesn't shrink)
  --stats               write compression stats to stderr at exit
  -h, --help            this help
  -v, --version         print version and exit

Environment:
  OCTERSE_SHRINK=0      same as --no-compress
  OCTERSE_SHRINK_BYPASS=server-x,server-y   passthrough only those upstream argv[0]
  OCTERSE_SHRINK_STATS=1                    same as --stats
```

## Compression rules

Pure functions. No randomness. No LLM. Applied in this order to each
`description` string:

1. **Preserve backtick spans.** `` `tools/list` `` is never rewritten.
2. **Drop filler prefixes.** "This tool is used to …", "Use this tool when …",
   "The purpose of this tool is to …" → gone.
3. **Strip adjective stacks.** "very", "extremely", "comprehensive",
   "powerful", "robust", "advanced", "seamless", "user-friendly", … → gone.
4. **Phrase collapse.** "in order to" → "to", "as well as" → "and", "due to
   the fact that" → "because", and a dozen more.
5. **Whitespace normalisation.** Runs of spaces, padding before punctuation,
   blank-line collapse.
6. **240-byte hard cap**, sliced on a word boundary, no ellipsis.

The trailing period is preserved if (and only if) the input had one.

## What is *not* touched

- `tools/call` — request payloads and responses pass through byte-for-byte.
- `initialize` / `ping` / capability negotiation — unchanged.
- Schema fields (`inputSchema`, `outputSchema`, etc.) — unchanged.
- Any non-string `description` value — unchanged.
- The framing mode of the upstream stream (LSP-style `Content-Length` headers
  vs newline-delimited JSON) — auto-detected and preserved.

## Privacy

- Reads only stdin. Writes only stdout (to the parent / client) and stderr (for
  diagnostics).
- **Zero network calls.** Nothing dialed home. Nothing cached on disk.
- Stats are off by default; when `--stats` is enabled, only byte counts go to
  stderr — never the descriptions themselves.

## Programmatic API

```ts
import { compressDescription, compressListPayload, runProxy } from 'octerse-shrink';

// Single string
const r = compressDescription('This tool is used to do very robust things.');
console.log(r.compressed);   // "Do things."
console.log(r.bytesIn, r.bytesOut, r.ruleHits);

// Whole tools/list payload
const { payload, stats } = compressListPayload({
  tools: [{ description: '…' }, { description: '…' }],
});

// Or run as a proxy in your own process
await runProxy({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
});
```

## Build and test

```sh
npm install
npm test          # vitest, 44 tests
npm run build     # tsc → dist/
```

## License

MIT — see [../../LICENSE](../../LICENSE).
