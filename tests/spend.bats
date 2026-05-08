#!/usr/bin/env bats
# Argument-parsing and pure-function tests for `gh octerse spend`.
# Network-touching paths are exercised in e2e (out of scope for CI).

setup() {
  CLI="$BATS_TEST_DIRNAME/../gh-octerse"
  [ -x "$CLI" ] || chmod +x "$CLI"
}

@test "spend --help exits 0 and prints usage" {
  run "$CLI" spend --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh octerse spend"* ]]
  [[ "$output" == *"--calculator"* ]]
}

@test "spend with no flags exits 2" {
  run "$CLI" spend
  [ "$status" -eq 2 ]
  [[ "$output" == *"--org"* ]]
}

@test "spend --org and --enterprise together exits 2" {
  run "$CLI" spend --org foo --enterprise bar
  [ "$status" -eq 2 ]
  [[ "$output" == *"pick one"* ]]
}

@test "spend --bogus exits 2 with usage" {
  run "$CLI" spend --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

@test "spend --since 7days fails with format hint at parse time" {
  run "$CLI" spend --org foo --since 7days
  [ "$status" -eq 2 ]
  [[ "$output" == *"--since must be like"* ]]
}

@test "spend --since=30d accepted by parser" {
  # Will fail at preflight (missing scope or no gh auth in CI), but parse-OK.
  run "$CLI" spend --org=foo --since=30d
  # Either preflight 1 or api 1 — never the parser's 2.
  [ "$status" -ne 2 ]
}

@test "spend --json + --calculator can both be set" {
  run "$CLI" spend --org foo --json --calculator
  [ "$status" -ne 2 ]
}

# --- spend_calculator_url is the deep-link contract; lock it down ---

@test "calculator URL has all 7 query params in fixed order" {
  source "$CLI" >/dev/null 2>&1 || true
  url="$(spend_calculator_url business 47 22 50 35 15 5)"
  [[ "$url" == "https://heisenberg-alt.github.io/usage-based-billing/#/calculator?p=business&n=47&d=22&promo=0&l=50&m=35&h=15&pw=5" ]]
}

@test "calculator URL escapes plan slug in fixed positions" {
  source "$CLI" >/dev/null 2>&1 || true
  url="$(spend_calculator_url enterprise 200 30 40 40 20 8)"
  [[ "$url" == *"p=enterprise"* ]]
  [[ "$url" == *"n=200"* ]]
  [[ "$url" == *"pw=8"* ]]
}

# --- format helpers ---

@test "human_dollars renders cents as dollars with comma" {
  source "$CLI" >/dev/null 2>&1 || true
  out="$(human_dollars 124730)"
  [[ "$out" == "\$1,247.30" ]]
}

@test "human_int adds thousands separator" {
  source "$CLI" >/dev/null 2>&1 || true
  out="$(human_int 18432)"
  [[ "$out" == "18,432" ]]
}

@test "progress_bar 50%% half filled" {
  source "$CLI" >/dev/null 2>&1 || true
  out="$(progress_bar 50 10)"
  [[ "$out" == "#####....." ]]
}

@test "progress_bar 0%% all empty" {
  source "$CLI" >/dev/null 2>&1 || true
  out="$(progress_bar 0 5)"
  [[ "$out" == "....." ]]
}

@test "progress_bar 100%% all filled" {
  source "$CLI" >/dev/null 2>&1 || true
  out="$(progress_bar 100 5)"
  [[ "$out" == "#####" ]]
}
