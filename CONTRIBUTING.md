# Contributing to Octerse

Thanks for considering a contribution. Octerse is intentionally small — a few
Markdown files, two installers, and a `gh` CLI extension. Keep PRs focused.

## Ground rules

- Open an issue before a substantial PR so we can align on scope.
- One concern per PR. Refactors and feature work in separate PRs.
- Markdown payloads (`instructions/`, `skills/`) are the product. Treat changes
  to them as tone changes, not just text edits — show before/after Copilot
  responses in the PR description when you can.
- No telemetry. No network calls from any installer or extension subcommand.
- The `stats` subcommand is best-effort and local-only by design.

## Local testing

```sh
# Dry-run the installer in a scratch repo
mkdir /tmp/scratch && cd /tmp/scratch && git init -q
bash ~/path/to/octerse/install.sh --dry-run --mode lite

# Install for real
bash ~/path/to/octerse/install.sh --mode full

# Test the gh extension locally
gh extension install ~/path/to/octerse
gh octerse mode lite
```

## Style

- Shell: `set -euo pipefail`, `shellcheck` clean.
- Markdown: GitHub-Flavored. No trailing whitespace. One H1 per file.
- Tone in instruction payloads: terse, code-first, no throat-clearing.

## Releasing

Maintainers tag `vX.Y.Z` on `main`. The release workflow attaches `install.sh`
and `install.ps1` with checksums.

## License

By contributing you agree your work is licensed under the MIT License (see
[LICENSE](./LICENSE)).
