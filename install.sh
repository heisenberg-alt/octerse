#!/usr/bin/env bash
# octerse — install GitHub Copilot terse-mode into the current repo.
# https://github.com/heisenberg-alt/octerse · MIT
set -euo pipefail

VERSION="0.1.0"
REPO_RAW="${OCTERSE_RAW:-https://raw.githubusercontent.com/heisenberg-alt/octerse/main}"

# ---- args ------------------------------------------------------------------
MODE="full"
DRY_RUN=0
UNINSTALL=0
FORCE=0
WITH_AGENTS=0
SKIP_VSCODE=0

usage() {
  cat <<'EOF'
octerse — install GitHub Copilot terse-mode into the current repo.

Usage:
  install.sh [--mode lite|full|ultra|enterprise] [flags]
  install.sh --uninstall

Modes:
  lite          keep grammar, drop filler
  full          default brevity — fragments OK, no filler (default)
  ultra         telegraphic, symbols, senior devs
  enterprise    lite + GHE PII / policy guardrails

Flags:
  --mode <m>          set the active mode (default: full)
  --dry-run           preview file writes; touch nothing
  --force             overwrite existing files without prompting
  --with-agents       also drop AGENTS.md (for Copilot CLI / agent contexts)
  --skip-vscode       don't write .vscode/settings.json
  --uninstall         remove all octerse-managed files
  -h, --help          this help
  --version           print version and exit
EOF
}

while (( $# )); do
  case "$1" in
    --mode)         MODE="${2:?}"; shift 2 ;;
    --mode=*)       MODE="${1#--mode=}"; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --force)        FORCE=1; shift ;;
    --with-agents)  WITH_AGENTS=1; shift ;;
    --skip-vscode)  SKIP_VSCODE=1; shift ;;
    --uninstall)    UNINSTALL=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    --version)      echo "octerse $VERSION"; exit 0 ;;
    *)              echo "octerse: unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$MODE" in
  lite|full|ultra|enterprise) ;;
  *) echo "octerse: invalid --mode '$MODE' (lite|full|ultra|enterprise)" >&2; exit 2 ;;
esac

# ---- repo detection --------------------------------------------------------
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "octerse: not inside a git repo. Run from the repo root." >&2
  exit 1
fi
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ---- helpers ---------------------------------------------------------------
say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

run() {
  if (( DRY_RUN )); then
    say "[dry-run] $*"
  else
    eval "$@"
  fi
}

fetch() {
  # fetch <remote-path> <local-path>
  local src="$1" dst="$2"
  if [[ -f "$dst" && $FORCE -eq 0 && $UNINSTALL -eq 0 ]]; then
    warn "exists, keeping: $dst (use --force to overwrite)"
    return 0
  fi
  run "mkdir -p '$(dirname "$dst")'"
  if [[ -d "${OCTERSE_LOCAL_SRC:-}/$src" || -f "${OCTERSE_LOCAL_SRC:-}/$src" ]]; then
    run "cp '${OCTERSE_LOCAL_SRC}/$src' '$dst'"
  else
    run "curl -fsSL '$REPO_RAW/$src' -o '$dst'"
  fi
  ok "wrote $dst"
}

merge_vscode_settings() {
  local snippet_url="$REPO_RAW/templates/vscode-settings.json"
  local snippet_local="${OCTERSE_LOCAL_SRC:-}/templates/vscode-settings.json"
  local target=".vscode/settings.json"
  local snippet
  if [[ -f "$snippet_local" ]]; then
    snippet="$(cat "$snippet_local")"
  else
    snippet="$(curl -fsSL "$snippet_url")"
  fi

  if (( DRY_RUN )); then
    say "[dry-run] merge octerse keys into $target"
    return 0
  fi

  mkdir -p .vscode
  if [[ ! -f "$target" ]]; then
    printf '%s\n' "$snippet" > "$target"
    ok "wrote $target"
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    local tmp
    tmp="$(mktemp)"
    jq -s '.[0] * .[1]' "$target" <(printf '%s' "$snippet") > "$tmp"
    mv "$tmp" "$target"
    ok "merged octerse keys into $target (via jq)"
  else
    cp "$target" "$target.octerse.bak"
    printf '%s\n' "$snippet" > "$target"
    warn "no jq found — backed up your $target to $target.octerse.bak and replaced"
    warn "merge any prior keys back manually if needed"
  fi
}

# ---- uninstall -------------------------------------------------------------
if (( UNINSTALL )); then
  printf '\n  octerse uninstall\n\n'
  for path in .github/copilot-instructions.md .octerse AGENTS.md; do
    if [[ -e "$path" ]]; then
      run "rm -rf '$path'"
      ok "removed $path"
    fi
  done
  if [[ -f .vscode/settings.json.octerse.bak ]]; then
    run "mv .vscode/settings.json.octerse.bak .vscode/settings.json"
    ok "restored .vscode/settings.json from backup"
  else
    warn ".vscode/settings.json was not auto-restored — remove octerse keys manually if you don't want them"
  fi
  printf '\n  done.\n\n'
  exit 0
fi

# ---- install ---------------------------------------------------------------
printf '\n  octerse v%s — mode: %s%s\n\n' \
  "$VERSION" "$MODE" "$( (( DRY_RUN )) && printf ' (dry-run)' )"

# 1. Instructions
fetch "instructions/${MODE}.md" ".github/copilot-instructions.md"

# 2. Skills
for skill in octerse-commit octerse-review octerse-help; do
  fetch "skills/${skill}.prompt.md" ".octerse/skills/${skill}.prompt.md"
done

# 3. VS Code settings
if (( !SKIP_VSCODE )); then
  merge_vscode_settings
fi

# 4. AGENTS.md (optional)
if (( WITH_AGENTS )); then
  fetch "templates/AGENTS.md" "AGENTS.md"
fi

# 5. Mode marker (used by `gh octerse mode` / `gh octerse stats`)
if (( !DRY_RUN )); then
  mkdir -p .octerse
  printf '%s\n' "$MODE" > .octerse/mode
  printf '{"version":"%s","mode":"%s","installed_at":"%s"}\n' \
    "$VERSION" "$MODE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > .octerse/state.json
fi

# 6. .gitignore — keep state out of git, keep skills in
if (( !DRY_RUN )) && [[ -f .gitignore ]]; then
  if ! grep -q '^\.octerse/state\.json$' .gitignore 2>/dev/null; then
    printf '\n# octerse\n.octerse/state.json\n.octerse/stats.jsonl\n' >> .gitignore
    ok "appended octerse rules to .gitignore"
  fi
fi

cat <<EOF

  octerse installed.

    Mode:                 $MODE
    Instructions file:    .github/copilot-instructions.md
    Skills directory:     .octerse/skills/
    VS Code settings:     $( (( SKIP_VSCODE )) && echo 'skipped' || echo '.vscode/settings.json' )

  Next:
    1. Open this repo in VS Code (reload the window if it was already open).
    2. In Copilot Chat, try /octerse-help for a quick reference.
    3. Switch modes any time:  gh octerse mode lite

  ROI calculator:  https://heisenberg-alt.github.io/usage-based-billing/
  Uninstall:       bash install.sh --uninstall

EOF
