#!/usr/bin/env bash
# evals/run.sh — drive the eval matrix (10 prompts × 5 modes).
#
# By default this runs in STUB mode: it reads pre-recorded fixture outputs
# from evals/fixtures/<mode>/<prompt>.out so the harness is reproducible
# without invoking a real LLM. Stub mode is what runs in CI.
#
# Pass --live to invoke a real Copilot-style CLI:
#   --live --backend copilot     uses `gh copilot suggest` per prompt
#   --live --backend claude      uses `claude -p "$instructions\n\n$prompt"`
#
# Run logs land in evals/.runs/<timestamp>/<mode>/<prompt>.{out,meta.json}
# and are gitignored. measure.py + report.py read them.
set -euo pipefail

EVAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$EVAL_ROOT"

MODE_LIVE=0
BACKEND="copilot"
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
DRY_RUN=0
ONLY_MODE=""
ONLY_PROMPT=""

usage() {
  cat <<'EOF'
evals/run.sh — drive the prompt × mode evaluation matrix.

Usage:
  ./run.sh [--live] [--backend copilot|claude] [--mode <m>] [--prompt <n>] [--dry-run]

Flags:
  --live              invoke a real LLM CLI (default: stub from fixtures)
  --backend <b>       copilot (default) or claude
  --mode <m>          run only one mode (control|generic-terse|lite|full|ultra)
  --prompt <n>        run only one prompt (the file basename, e.g. 02-write-fn)
  --dry-run           list pairs without running them
  -h, --help          this help
EOF
}

while (( $# )); do
  case "$1" in
    --live)            MODE_LIVE=1; shift ;;
    --backend)         BACKEND="${2:?}"; shift 2 ;;
    --mode)            ONLY_MODE="${2:?}"; shift 2 ;;
    --prompt)          ONLY_PROMPT="${2:?}"; shift 2 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *)                 echo "evals/run.sh: unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

OUT_DIR=".runs/$RUN_TS"
mkdir -p "$OUT_DIR"

modes=(control generic-terse lite full ultra)
prompts=()
while IFS= read -r f; do prompts+=("$f"); done < <(ls prompts/*.txt | sort)

run_pair() {
  local mode="$1" prompt_file="$2"
  local prompt_name="$(basename "${prompt_file%.txt}")"
  local mode_file="modes/${mode}.md"
  local instructions=""
  [[ -f "$mode_file" ]] && instructions="$(cat "$mode_file")"
  local prompt="$(cat "$prompt_file")"

  local pair_dir="$OUT_DIR/$mode"
  mkdir -p "$pair_dir"
  local out_path="$pair_dir/$prompt_name.out"
  local meta_path="$pair_dir/$prompt_name.meta.json"

  if (( DRY_RUN )); then
    printf '  [dry-run] %s × %s\n' "$mode" "$prompt_name"
    return 0
  fi

  local started_at ended_at
  started_at=$(python3 -c 'import time;print(time.time())')

  if (( MODE_LIVE )); then
    case "$BACKEND" in
      copilot)
        # gh copilot suggest reads stdin; we prepend the mode instructions.
        # Falls back to gh copilot if `suggest` isn't a subcommand.
        printf '%s\n\n%s\n' "$instructions" "$prompt" \
          | gh copilot suggest 2>/dev/null > "$out_path" \
          || printf 'EVAL_LIVE_BACKEND_UNAVAILABLE\n' > "$out_path"
        ;;
      claude)
        printf '%s\n\n%s\n' "$instructions" "$prompt" \
          | claude -p 2>/dev/null > "$out_path" \
          || printf 'EVAL_LIVE_BACKEND_UNAVAILABLE\n' > "$out_path"
        ;;
      *)
        echo "evals/run.sh: unknown backend: $BACKEND" >&2; exit 2 ;;
    esac
  else
    local fixture="fixtures/$mode/$prompt_name.out"
    if [[ -f "$fixture" ]]; then
      cp "$fixture" "$out_path"
    else
      echo "evals/run.sh: missing fixture: $fixture" >&2
      printf 'EVAL_FIXTURE_MISSING\n' > "$out_path"
    fi
  fi

  ended_at=$(python3 -c 'import time;print(time.time())')

  python3 - <<PY
import json, os
data = {
  "mode": "$mode",
  "prompt": "$prompt_name",
  "instructions_bytes": $(wc -c < "$mode_file" 2>/dev/null || echo 0),
  "prompt_bytes": $(wc -c < "$prompt_file"),
  "output_bytes": os.path.getsize("$out_path"),
  "started_at": $started_at,
  "ended_at": $ended_at,
  "live": $MODE_LIVE,
  "backend": "$BACKEND" if $MODE_LIVE else "stub",
}
with open("$meta_path", "w") as f:
    json.dump(data, f, indent=2)
PY
  printf '  ok  %-14s × %s\n' "$mode" "$prompt_name"
}

printf '\n  evals/run.sh — %s mode\n' "$( (( MODE_LIVE )) && echo "live ($BACKEND)" || echo stub )"
printf '  output: %s\n\n' "$OUT_DIR"

for mode in "${modes[@]}"; do
  [[ -n "$ONLY_MODE" && "$ONLY_MODE" != "$mode" ]] && continue
  for p in "${prompts[@]}"; do
    pn="$(basename "${p%.txt}")"
    [[ -n "$ONLY_PROMPT" && "$ONLY_PROMPT" != "$pn" ]] && continue
    run_pair "$mode" "$p"
  done
done

if (( !DRY_RUN )); then
  ln -sfn "$RUN_TS" .runs/latest
  printf '\n  done. measure with: python3 evals/measure.py %s\n\n' "$OUT_DIR"
fi
