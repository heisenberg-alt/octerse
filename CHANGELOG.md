# Changelog

All notable changes to **octerse** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/heisenberg-alt/octerse/releases/tag/v0.2.0
[0.1.0]: https://github.com/heisenberg-alt/octerse/releases/tag/v0.1.0
