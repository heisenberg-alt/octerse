#!/usr/bin/env bats
# Tests for `gh octerse context` — the full context-stack audit.
# All filesystem-only; no network.

setup() {
  CLI="$BATS_TEST_DIRNAME/../gh-octerse"
  [ -x "$CLI" ] || chmod +x "$CLI"

  # Throwaway git repo per test.
  TMP_REPO="$(mktemp -d -t octerse-ctx.XXXXXX)"
  git -C "$TMP_REPO" init -q
  cd "$TMP_REPO"
}

teardown() {
  rm -rf "$TMP_REPO"
}

@test "context --help exits 0 and prints usage" {
  run "$CLI" context --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh octerse context"* ]]
  [[ "$output" == *"--json"* ]]
}

@test "context --bogus exits 2 with usage" {
  run "$CLI" context --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

@test "context outside a git repo exits 1" {
  cd /tmp
  run "$CLI" context
  [ "$status" -eq 1 ]
  [[ "$output" == *"not inside a git repo"* ]]
}

@test "empty repo: reports nothing always-on and missing-install finding" {
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing"* ]]
  [[ "$output" == *"gh octerse install"* ]]
}

@test "counts copilot-instructions.md in the per-turn tax" {
  mkdir -p .github
  printf 'a\nb\nc\n' > .github/copilot-instructions.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" == *".github/copilot-instructions.md"* ]]
  [[ "$output" == *"per-turn tax"* ]]
}

@test "flags copilot-instructions.md over 80 lines" {
  mkdir -p .github
  for i in $(seq 1 90); do echo "line $i"; done > .github/copilot-instructions.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" == *"90 lines"* ]]
  [[ "$output" == *"<=80"* ]]
}

@test "flags unscoped instructions file (applyTo: \"**\")" {
  mkdir -p .github/instructions
  printf -- '---\napplyTo: "**"\n---\nrule\n' > .github/instructions/style.instructions.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" == *"no scoping applyTo"* ]]
}

@test "scoped instructions file is not flagged" {
  mkdir -p .github/instructions
  printf -- '---\napplyTo: "**/*.sql"\n---\nrule\n' > .github/instructions/sql.instructions.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" != *"no scoping applyTo"* ]]
}

@test "octerse context instructions silence the with-context finding" {
  mkdir -p .github/instructions
  printf -- '---\napplyTo: "**"\ndescription: "x"\n---\nrule\n' \
    > .github/instructions/octerse-context.instructions.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" != *"--with-context"* ]]
}

@test "counts prompt files as on-demand" {
  mkdir -p .octerse/skills
  printf 'x\n' > .octerse/skills/a.prompt.md
  printf 'x\n' > .octerse/skills/b.prompt.md
  run "$CLI" context
  [ "$status" -eq 0 ]
  [[ "$output" == *"prompt files (skills):  2"* ]]
}

@test "--json emits parsable shape with totals" {
  mkdir -p .github
  printf 'a\nb\n' > .github/copilot-instructions.md
  run "$CLI" context --json
  [ "$status" -eq 0 ]
  if command -v jq >/dev/null 2>&1; then
    echo "$output" | jq -e '.totals.bytes >= 0 and (.always_on | length) == 1' >/dev/null
  else
    [[ "$output" == *'"always_on"'* ]]
    [[ "$output" == *'"est_tokens_per_turn"'* ]]
  fi
}

@test "install --with-context writes the instructions file (local src, dry-run off)" {
  OCTERSE_LOCAL_SRC="$BATS_TEST_DIRNAME/.." \
    run bash "$BATS_TEST_DIRNAME/../install.sh" --with-context --skip-vscode --force
  [ "$status" -eq 0 ]
  [ -f .github/instructions/octerse-context.instructions.md ]
  [ -f .octerse/skills/octerse-context.prompt.md ]
}

@test "uninstall removes the context instructions file" {
  mkdir -p .github/instructions
  printf 'x\n' > .github/instructions/octerse-context.instructions.md
  run bash "$BATS_TEST_DIRNAME/../install.sh" --uninstall
  [ "$status" -eq 0 ]
  [ ! -e .github/instructions/octerse-context.instructions.md ]
}
