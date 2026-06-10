# Changelog

All notable changes to **octerse** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-06-11

### Added

- **No-savings refusal.** `compressMarkdown` now returns a `no-savings`
  refusal when the `<!-- octerse-compressed: true -->` marker overhead
  would equal or exceed rule savings (already-terse files). The CLI exits
  0 with a message and leaves the file unchanged; `gh octerse compress`
  skips the backup. Found by end-to-end testing against a real
  repository's AGENTS.md, where compress previously *grew* the file
  15,195 → 15,229 bytes and reported it as success.
- **`gh octerse context`** — audit of the full context stack. Scans the
  always-on layer (`.github/copilot-instructions.md`, `AGENTS.md`,
  `.github/instructions/*.instructions.md`), prints lines / bytes /
  estimated tokens per turn, counts on-demand prompt files and MCP
  servers, and flags: files over the 80-line budget, `*.instructions.md`
  without a scoping `applyTo` glob, missing context-discipline rules, and
  unshrunk `mcp.json` configs. `--json` for machine-readable output.
- **`--with-context` / `-WithContext`** installer flag — writes
  `.github/instructions/octerse-context.instructions.md`, a ≤40-line
  context-discipline payload (read `@file:line` not directories, delegate
  exploration to sub-agents, filter tool output at the source). Removed by
  `--uninstall`.
- **`/octerse-context`** skill — context engineering quick-reference card,
  installed alongside the existing `/octerse-*` prompt files.
- **`docs/context-engineering.md`** — the context stack, four levers
  (persistent instructions, per-request attachments, reusable workflows,
  session management), anti-patterns, and adoption checklist for Copilot
  in VS Code + Copilot CLI. Cross-linked from README and the playbook.
- **Pitch deck** — self-contained HTML deck in [`deck/`](./deck/)
  (Apple-style typography × GitHub Primer dark palette, zero dependencies;
  keyboard / swipe / scroll navigation). Deployed to GitHub Pages via
  [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).
- 13 bats cases in [`tests/context.bats`](./tests/context.bats).

### Fixed

- **octerse-shrink proxy:** only responses settle the pending-request map —
  server-initiated requests share the `id` field but not the id namespace;
  deleting on them could let `tools/list` responses escape compression.
  Also fixed a framing stall when garbage preceded a buffered frame, and
  falsy-but-valid JSON frames (`null`/`0`/`false`) being dropped.
- **compress:** the 240-byte hard cap can no longer leave an unbalanced
  backtick when it lands inside an inline code span.
- **install.sh:** `run()` executes argv directly instead of `eval` —
  quote-safe paths, removes an injection surface in a curl-piped script.
- **gh octerse spend:** error temp file via `mktemp` instead of a
  predictable `/tmp` path; **gh octerse context --json** escapes file
  paths in JSON output.

## [0.5.0] - 2025-01

### Added

- **`gh octerse compress`** — markdown-aware, in-place compressor for
  `AGENTS.md`, `instructions/*.md`, `copilot-instructions.md`, and any
  other markdown file in your repo. Reuses the deterministic pipeline
  from `octerse-shrink` (no LLM) but is structure-preserving:
  - Fenced code blocks, inline backticks, `[text](url)` links, and
    `@file/path:line` refs are untouched.
  - Headings, list bullets (`-`, `*`, `+`, `1.`), and blockquote prefixes
    keep their structure; only the prose inside gets shrunk.
  - `<!-- octerse:keep -->` ... `<!-- octerse:end -->` spans pass through
    byte-for-byte.
  - First line of the output is a `<!-- octerse-compressed: true -->`
    marker so re-runs are a safe no-op (`--force` to redo).
- **Backup + restore.** Every in-place rewrite writes the pristine
  original to `<file>.original.md` first. `gh octerse compress --restore`
  rolls back. Round-trip sha256 match is covered by
  [`tests/compress.bats`](./tests/compress.bats).
- **Refusals.** `gh octerse compress` declines (exit 1, single-line
  message) on:
  - untracked files ("`git add` it first so revert is a one-liner")
  - existing `<file>.original.md` without `--force`
  - symlinks
  - files where `<!-- octerse:keep -->` covers everything
- **Markdown engine** in `mcp-servers/octerse-shrink/src/markdown.ts`,
  exposed as `octerse-shrink compress [--stdin] [<file>]`. 17 vitest
  cases in [`__tests__/markdown.test.ts`](./mcp-servers/octerse-shrink/src/__tests__/markdown.test.ts).
- 14 bats round-trip / refusal cases in
  [`tests/compress.bats`](./tests/compress.bats), wired into the existing
  `test.yml` matrix.
- README `## Compress` section between `## Spend` and `## Benchmarks`.

### Changed

- `octerse-shrink` (npm) bumped to **0.5.0** — same proxy behaviour as
  0.3.0, plus the new `compress` subcommand. Tag `v0.5.0` will trigger
  the npm-publish job (the package.json + tag versions match).

### Notes

- Compress is fully offline. The only command in octerse that touches a
  network is still `gh octerse spend`. No telemetry.
- The markdown engine is intentionally conservative — it only edits prose
  paragraphs, never structure. That's why a 70-line AGENTS.md typically
  shrinks ~30%, not 80%: the structural lines are left alone.

## [0.4.0] - 2025-01

### Added

- **`evals/`** — reproducible eval harness for the five Copilot-instruction
  modes Octerse ships (`control`, `generic-terse`, `lite`, `full`, `ultra`).
  - 10 prompts × 5 modes runner in [`evals/run.sh`](./evals/run.sh).
    Default is **stub mode** — reads pre-recorded fixtures so CI is
    deterministic. `--live --backend copilot|claude` invokes a real LLM
    per pair.
  - [`evals/measure.py`](./evals/measure.py) tabulates run logs into
    `evals/results.json` using char/4 token estimates (no `tiktoken` dep).
  - [`evals/report.py`](./evals/report.py) renders the table into a
    marker block (`<!-- BENCHMARK-TABLE-START/END -->`) in the root
    README. Idempotent. `--check` flag for CI.
  - The honest comparison the table foregrounds is **octerse vs `"be
    terse"`** — anyone can ask a model to be brief; the question is
    whether mode-specific instructions buy anything beyond that.
- **`.github/workflows/evals.yml`** — runs the matrix on every release
  tag and opens a PR with the refreshed table + `results.json`.
  Stub-mode by default (Copilot CLI in GitHub runners is too flaky to be
  the source of truth for a published number).
- **Root README `## Benchmarks`** section with auto-generated table.

### Notes

- `octerse-shrink` (the MCP middleware shipped in v0.3.0) is **not**
  re-released. Its `package.json` stays at `0.3.0`; the
  `npm-publish` job only fires when `tag === package.json.version`, so
  pushing `v0.4.0` is a gh-extension/repo release only.
- Stub fixtures in `evals/fixtures/` are illustrative — they show the
  expected ordering but not a guarantee about any specific model. Run
  `--live` to get real numbers for your model.
- No telemetry, no network calls in the harness or the reporter.

## [0.3.0] - 2025-01

### Added

- **`octerse-shrink`** — MCP stdio middleware that compresses
  `tools/list` / `prompts/list` / `resources/list` `description` fields
  through a deterministic, no-LLM rule pipeline. Tool calls are
  pass-through byte-for-byte. Published to npm as `octerse-shrink`.
  - Source under `mcp-servers/octerse-shrink/` (TypeScript, ESM,
    Node ≥ 18).
  - 6 compression rules: backtick preservation, filler-prefix removal,
    adjective-stack stripping, phrase collapse, whitespace
    normalisation, 240-byte hard cap on a word boundary.
  - Auto-detects LSP-style (`Content-Length:` headers) and
    newline-delimited JSON framing; preserves the framing of the
    upstream client.
  - `--no-compress` / `OCTERSE_SHRINK=0` for runtime bypass.
  - `OCTERSE_SHRINK_BYPASS=server-x,server-y` to passthrough specific
    upstream commands.
  - `--stats` prints byte-savings to stderr at exit (no descriptions
    leak — only counts).
  - Programmatic exports: `compressDescription`, `compressListPayload`,
    `runProxy`.
- **`bash install.sh --with-shrink`** (and `-WithShrink` in
  `install.ps1`) — appends a *commented* `octerse-shrink` example to
  `.vscode/mcp.json`. Default OFF. Never auto-rewrites existing entries.
- **44 vitest cases** under `mcp-servers/octerse-shrink/src/__tests__/`
  covering every rule, the proxy passthrough contract, and the CLI
  surface. Wired into `.github/workflows/test.yml` (Node 18 / 20 / 22).
- **`.github/workflows/release.yml`** gains an `npm-publish` job that
  publishes `octerse-shrink` with provenance when the tag's package
  version matches `mcp-servers/octerse-shrink/package.json`.

### Privacy

- `octerse-shrink` reads only stdin, writes only stdout/stderr. Zero
  network calls, zero persistence, zero telemetry.

## [0.2.0] - 2025-01

### Added

- **`gh octerse spend`** — print this billing period's Copilot dollar
  amount for an org or enterprise. Reads only `api.github.com` via the
  user's existing `gh` token. Writes nothing to disk.
  - `--org <name>` / `--enterprise <name>` to pick the scope.
  - `--since 7d` / `--since 30d` to override the billing-period default.
  - `--json` for piping into dashboards.
  - `--calculator` (alias `--project`) opens the
    [UBB Estimator](https://heisenberg-alt.github.io/usage-based-billing/)
    pre-filled with the active-user count, working-days, and prompts /
    user / day from the metrics API.
  - Required scopes: `manage_billing:copilot`, `read:org`
    (`+ manage_billing:enterprise` for `--enterprise`). Preflight checks
    `gh auth status` and prints the exact `gh auth refresh -s …` command
    when a scope is missing.
- **Tests** under `tests/spend.bats` (14 cases, runs on every PR via
  `.github/workflows/test.yml` — bats on Linux + macOS, shellcheck at
  `warning+` severity).
- **Docs** — new `## Spend` section in `README.md` and a rewritten
  `## Make spend visible` in `docs/playbook.md` that leads with the new
  command and demotes `/context` / `/usage` to session-level
  supplements.

### Changed

- Format helpers (`human_int`, `human_dollars`) rewritten in pure bash to
  drop the BSD-vs-GNU awk locale dependency. Output now renders the same
  on Linux and macOS without `gawk`.
- Script is source-friendly — the dispatcher at the bottom is guarded by
  `(return 0 2>/dev/null) && return 0` so tests can pull individual
  helpers without executing `usage`.

### Privacy

- `spend` is the **only** subcommand that touches the network. It hits
  `api.github.com` exclusively, pins `X-GitHub-Api-Version: 2022-11-28`,
  uses the user's existing `gh` token, and persists nothing to disk.

## [0.1.0] - 2025-01

Initial release.

[0.3.0]: https://github.com/heisenberg-alt/octerse/releases/tag/v0.3.0
[0.2.0]: https://github.com/heisenberg-alt/octerse/releases/tag/v0.2.0
[0.1.0]: https://github.com/heisenberg-alt/octerse/releases/tag/v0.1.0
