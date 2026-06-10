# octerse

> *less prose, more PRs.* — a token-saver for GitHub Copilot.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](./CONTRIBUTING.md)

[Install](#install) · [Modes](#modes) · [What you get](#what-you-get) · [Playbook](./docs/playbook.md) · [Context Engineering](./docs/context-engineering.md) · [Deck](https://heisenberg-alt.github.io/octerse/) · [ROI](#roi)

Octerse is a one-line installer that drops a tightly-scoped
`.github/copilot-instructions.md`, VS Code Copilot Chat settings, and a `gh`
CLI extension into any repo. Copilot starts answering like an engineer who's
been on call for 36 hours: code first, words last.

It targets:

- **GitHub Copilot in VS Code** (Copilot Chat, code generation, commit
  messages, PR review)
- **GitHub Copilot CLI**
- **GitHub Enterprise** (with optional `enterprise` mode for policy-aware
  guardrails)
- **The `gh` CLI** via the bundled `gh octerse` extension

## Why

GitHub Copilot is moving to **usage-based billing** on June 1, 2026. Every
input + output token meters. Octerse is the **output lever** of a five-lever
framework — see [the playbook](./docs/playbook.md) — that routinely cuts
60–70% of token spend without changing what developers ship.

| Without octerse | With octerse |
|---|---|
| "Certainly! I'd be happy to help you with that. Let me take a look at the code…" | `src/auth.ts:14 — blocker: missing await on verifyToken; token always null.` |
| 200 words then 6 lines of code | 6 lines of code, no preamble |

**Same accuracy. ~65% fewer output tokens.**

Estimate the dollar impact for your team in the
**[Copilot UBB Estimator →](https://heisenberg-alt.github.io/usage-based-billing/)**.

## Install

```sh
# macOS / Linux / WSL / Git Bash
curl -fsSL https://raw.githubusercontent.com/heisenberg-alt/octerse/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/heisenberg-alt/octerse/main/install.ps1 | iex
```



The installer detects your repo, writes `.github/copilot-instructions.md`,
merges `.vscode/settings.json`, and (optionally) drops `AGENTS.md`. Pass
`--mode lite|full|ultra|enterprise`, `--with-context` for context-discipline
rules, `--dry-run` to preview, or `--uninstall` to remove.
`bash install.sh --help` for the full flag matrix.

### Or via the `gh` CLI

```sh
gh extension install heisenberg-alt/octerse
gh octerse install --mode full
```

### Manual

```sh
# In any git repo
curl -o .github/copilot-instructions.md \
  https://raw.githubusercontent.com/heisenberg-alt/octerse/main/instructions/full.md
```

## Modes

| Mode | When | Vibe |
|---|---|---|
| `lite` | New teams, mixed audiences | Keep grammar. Drop filler. Code-first. |
| `full` *(default)* | Most engineers | Fragments OK. No articles. Maximum brevity. |
| `ultra` | Senior devs only | Telegraphic. Symbols. `→` `∴` `==`. |
| `enterprise` | GitHub Enterprise | `lite` + PII / secrets / policy guardrails. |

Switch any time:

```sh
gh octerse mode lite
```

## What you get

| Surface | Effect |
|---|---|
| Copilot Chat in VS Code | Terse answers, code-first, no preamble |
| Copilot inline suggestions | Unchanged — completions stay free under UBB |
| Copilot commit messages | Conventional Commits, ≤50 char subject |
| Copilot PR review | One-line findings: `path:line — sev: issue. fix.` |
| `/octerse-commit`, `/octerse-review`, `/octerse-context`, `/octerse-help` | Custom prompts, accessed via `chat.promptFiles` |
| `gh octerse audit` | Flags bloat in your existing `copilot-instructions.md` |
| `gh octerse context` | Audits the full context stack — per-turn token tax + findings |
| `gh octerse spend` | Org Copilot $ this billing period; opens the UBB calculator pre-filled |
| `gh octerse tips` | Eight-habit Monday-morning checklist |

### Files written

```
.github/copilot-instructions.md     ← active mode
.github/instructions/octerse-context.instructions.md  ← optional, with --with-context
.vscode/settings.json               ← merged, not overwritten
.octerse/skills/                    ← /octerse-* prompt files
AGENTS.md                           ← optional, with --with-agents
.octerse/                           ← state dir for mode + stats
```

Nothing outside these paths is touched. `--uninstall` removes them all.

## Context

The [context engineering guide](./docs/context-engineering.md) is wired into
the tool as a working stack:

```sh
gh octerse context                       # audit the per-turn context tax
gh octerse context --json                # machine-readable
bash install.sh --with-context           # install context-discipline rules
```

- **`gh octerse context`** scans every always-on file
  (`copilot-instructions.md`, `AGENTS.md`, `.github/instructions/*.instructions.md`),
  prints lines / bytes / ~tokens per turn, and flags: files over budget,
  unscoped `applyTo` globs, and unshrunk MCP configs.
- **`--with-context`** drops `.github/instructions/octerse-context.instructions.md`
  — ≤40 lines of context-discipline rules (`@file:line` refs, sub-agent
  delegation, tool-output filtering) loaded by VS Code and Copilot CLI.
- **`/octerse-context`** in Copilot Chat prints the context engineering
  quick-reference card.

## octerse-shrink (MCP middleware)

Most MCP servers ship verbose tool descriptions ("This tool is used to allow
you to perform comprehensive filesystem operations…"). Every Copilot Chat
session re-pays for that fluff on every turn.

`octerse-shrink` is a tiny stdio proxy that wraps any MCP server and compresses
`tools/list` / `prompts/list` / `resources/list` `description` fields through a
deterministic rule pipeline. **`tools/call` payloads are never touched** —
pass-through is byte-for-byte.

```jsonc
// .vscode/mcp.json
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

Typical savings on a real `tools/list` response are 60–80% of the description
bytes. No LLM, no telemetry, no persistence — see
[`mcp-servers/octerse-shrink/`](./mcp-servers/octerse-shrink/) for the engine,
the CLI, and the rule list.

```sh
bash install.sh --with-shrink   # appends a commented example to .vscode/mcp.json
OCTERSE_SHRINK=0 …              # bypass at runtime, no config edit
```

## The five levers

Octerse is the **output** lever. The other four cover the input side:

1. **Context hygiene** — `/clear`, `/compact`, `/context`, `/usage` — see the
   [context engineering guide](./docs/context-engineering.md)
2. **Prompt discipline** — `@file/path:line` refs, one task per prompt, `/plan` first
3. **Octerse — output compression** *(this tool)*
4. **Model selection** — cheapest tier that finishes the task; `/model` mid-session
5. **Scope & tool control** — `/cwd`, content exclusion, tool allow/deny

Stacked, they cut ~70% of token spend.
**Read the [full playbook →](./docs/playbook.md)** for commands, patterns,
and admin governance.

## ROI

| Lever | Saves | Notes |
|---|---|---|
| Octerse alone | ~65% output | This tool. Output tokens only. |
| + Prompt discipline | +20% input | `@file:line` refs, one task per prompt |
| + Right-sized models | +30% $ | Mid-tier instead of Opus for routine work |
| + Context hygiene | +25% input | `/clear`, `/compact`, `/resume` |

For a 50-developer team on Business, that's the difference between hitting
the included pool and overage. Plug your team's profile into the
**[Copilot UBB Estimator](https://heisenberg-alt.github.io/usage-based-billing/)** to see the dollar number.

## Spend

`gh octerse spend` turns your org's actual Copilot usage into a printed
dollar number — no dashboard, no spreadsheet, no telemetry.

```sh
gh octerse spend --org acme                # this billing period in $
gh octerse spend --org acme --since 7d     # last 7 days
gh octerse spend --enterprise acme-ent     # enterprise rollup
gh octerse spend --org acme --json         # pipe to jq, dashboards, etc.
gh octerse spend --org acme --calculator   # open the UBB Estimator pre-filled
```

Reads only `api.github.com` via your existing `gh` token. Writes nothing to
disk. Required token scopes: `manage_billing:copilot`, `read:org`
(`gh auth refresh -s manage_billing:copilot,read:org` once is enough). Add
`manage_billing:enterprise` for `--enterprise`.

`--calculator` builds a deep-link into the
[UBB Estimator](https://heisenberg-alt.github.io/usage-based-billing/) with
your active-user count, working-days, and prompts-per-user-day pre-filled —
useful for "what would this cost on a different plan?" what-ifs you can
share with finance.

## Compress

Octerse can shrink your existing `AGENTS.md` / `instructions/*.md` /
`copilot-instructions.md` files in place — same compression engine
`octerse-shrink` uses for MCP descriptions, but markdown-aware so it
preserves fenced code blocks, links, `@file/path:line` refs, and list
structure.

```sh
gh octerse compress AGENTS.md           # rewrite in place, backs up to AGENTS.original.md
gh octerse compress --dry-run AGENTS.md # preview, write nothing
gh octerse compress --restore AGENTS.md # undo, restores from .original.md
gh octerse compress --check AGENTS.md   # exit 0 if already compressed, 1 otherwise
```

It writes a single `<!-- octerse-compressed: true -->` marker at the top so
running it twice is a safe no-op (pass `--force` to re-run anyway).

Sections you want untouched are marked with the comment span:

```markdown
<!-- octerse:keep -->
This block is preserved byte-for-byte —    spaces    and    all.
<!-- octerse:end -->
```

Refusals (each prints a single line and exits 1):
- file is **untracked by git** — `git add` it first so revert is one command
- `<file>.original.md` already exists — pass `--force` to overwrite, or
  `--restore` to undo the prior compress
- file is a **symlink** — refuses to follow (resolves ambiguity about which
  file gets the backup)
- a `<!-- octerse:keep -->` span covers the entire file — nothing to do

Under the hood: `gh octerse compress` shells out to `node
mcp-servers/octerse-shrink/dist/cli.js compress --stdin` if you're inside
the octerse source tree, or `npx --yes octerse-shrink@latest compress`
otherwise. Same deterministic pipeline, no LLM, no network.

## Benchmarks

10 prompts × 5 modes ([`evals/`](./evals/)). Lower is better.
The honest comparison is **octerse vs `"be terse"`** — anyone can tell a model
to be brief; the question is whether mode-specific instructions buy you
anything beyond that. Numbers below come from stub fixtures so the table is
deterministic and reproducible in CI; run `bash evals/run.sh --live` to
generate real numbers for your model.

<!-- BENCHMARK-TABLE-START -->

| Mode | Tokens out (10 prompts) | Median per prompt | Savings vs control |
|---|---|---|---|
| control (no instructions) | 1834 | 170 | — |
| "be terse" baseline | 395 | 35 | +78.5% |
| octerse — lite | 298 | 25 | +83.8% |
| octerse — full | 231 | 19 | +87.4% |
| octerse — ultra | 141 | 12 | +92.3% |

_Token counts are char/4 estimates; treat as ratios across modes, not as exact API token billing._  
_Run: `.runs/20260508T204432Z` · 50 pairs._
<!-- BENCHMARK-TABLE-END -->


## Privacy

- **No telemetry.** Octerse never phones home.
- **`gh octerse spend`** is the only subcommand that calls a network. It hits
  `api.github.com` exclusively, via your existing `gh` token. Nothing is
  cached or written to disk.
- **All other subcommands are offline.** `install`, `audit`, `tips`, `stats`,
  `mode`, `status` make zero network calls.
- **`gh octerse stats`** reads only your git log + a local counter file.
- See [SECURITY.md](./SECURITY.md) for our vulnerability-disclosure policy.

## Compatibility

| Surface | Status |
|---|---|
| VS Code + Copilot Chat | ✅ |
| GitHub Copilot CLI | ✅ |
| GitHub Copilot in JetBrains | ✅ (instructions file honored) |
| GitHub Copilot in Visual Studio | ✅ (instructions file honored) |
| GitHub Copilot Enterprise | ✅ when "custom instructions" is enabled at the org policy level |
| Other AI assistants (Cursor, Continue, Claude Code) | ⚠️  AGENTS.md is honored; native install not yet provided |

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Tone changes to the
instruction payloads must include a Copilot-Chat before/after in the PR
description.

## License

MIT. See [LICENSE](./LICENSE).
