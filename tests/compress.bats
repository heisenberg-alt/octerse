#!/usr/bin/env bats
# Tests for `gh octerse compress` — the markdown-shrinking subcommand.
#
# These use the locally built mcp-servers/octerse-shrink/dist binary (the
# `compress_resolve_runner` helper picks it up automatically when running
# from the source tree). If dist isn't built, the runner falls back to npx,
# which we don't want in CI — so the suite skips when dist is absent.

setup() {
  CLI="$BATS_TEST_DIRNAME/../gh-octerse"
  DIST="$BATS_TEST_DIRNAME/../mcp-servers/octerse-shrink/dist/cli.js"
  [ -x "$CLI" ] || chmod +x "$CLI"
  if [ ! -f "$DIST" ]; then
    skip "octerse-shrink dist not built (run: cd mcp-servers/octerse-shrink && npm run build)"
  fi

  # Per-test scratch repo (so `git ls-files` answers reflect the test's state).
  WORK=$(mktemp -d)
  cd "$WORK"
  git init -q -b main
  git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
}

teardown() {
  cd /
  rm -rf "$WORK"
}

write_doc() {
  cat > "$1" <<'MD'
# Project Doc

This tool is a very comprehensive utility. In order to use it, you simply run
the script. Additionally, it is very robust and very thorough at handling
every kind of edge case that you might encounter.

## Setup

```bash
# preserve  this  spacing
npm install
```

- This is a very comprehensive bullet point.
- See [the docs](https://example.com) for more.
- Files: @src/foo.ts:42 — please be very thorough.

<!-- octerse:keep -->
KEEP THIS    EXACTLY    AS-IS
<!-- octerse:end -->
MD
}

@test "compress --help exits 0 and prints usage" {
  run "$CLI" compress --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh octerse compress"* ]]
  [[ "$output" == *"--dry-run"* ]]
  [[ "$output" == *"--restore"* ]]
}

@test "compress with no file exits 2" {
  run "$CLI" compress
  [ "$status" -eq 2 ]
  [[ "$output" == *"provide a file"* ]]
}

@test "compress refuses non-existent file" {
  run "$CLI" compress no-such-file.md
  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* ]]
}

@test "compress refuses untracked file" {
  write_doc UNTRACKED.md
  run "$CLI" compress UNTRACKED.md
  [ "$status" -eq 1 ]
  [[ "$output" == *"untracked"* ]]
}

@test "compress refuses a symlink" {
  write_doc REAL.md
  ln -s REAL.md LINK.md
  git add REAL.md LINK.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress LINK.md
  [ "$status" -eq 1 ]
  [[ "$output" == *"symlink"* ]]
}

@test "compress writes a backup and shrinks the original" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  before_size=$(wc -c < DOC.md | tr -d ' ')

  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  [ -f DOC.original.md ]
  [ -f DOC.md ]

  after_size=$(wc -c < DOC.md | tr -d ' ')
  # Backup = original bytes
  backup_size=$(wc -c < DOC.original.md | tr -d ' ')
  [ "$backup_size" -eq "$before_size" ]
  # Compressed should be smaller (real prose, has fluff).
  [ "$after_size" -lt "$before_size" ]
  # Marker present.
  grep -q '<!-- octerse-compressed: true -->' DOC.md
}

@test "compress is idempotent — second run is a no-op without --force" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]

  # Second compress: backup already exists → refuse.
  run "$CLI" compress DOC.md
  [ "$status" -eq 1 ]
  [[ "$output" == *"already exists"* ]]
}

@test "compress --restore round-trips back to the original" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  before=$(shasum -a 256 DOC.md | awk '{print $1}')

  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  run "$CLI" compress --restore DOC.md
  [ "$status" -eq 0 ]
  [ ! -f DOC.original.md ]
  after=$(shasum -a 256 DOC.md | awk '{print $1}')
  [ "$before" = "$after" ]
}

@test "compress preserves <!-- octerse:keep --> spans exactly" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  grep -q 'KEEP THIS    EXACTLY    AS-IS' DOC.md
}

@test "compress preserves fenced code block whitespace" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  grep -q '# preserve  this  spacing' DOC.md
}

@test "compress preserves @file/path:line refs" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  grep -q '@src/foo.ts:42' DOC.md
}

@test "compress --dry-run does not write" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  before=$(shasum -a 256 DOC.md | awk '{print $1}')
  run "$CLI" compress --dry-run DOC.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"<!-- octerse-compressed: true -->"* ]]
  after=$(shasum -a 256 DOC.md | awk '{print $1}')
  [ "$before" = "$after" ]
  [ ! -f DOC.original.md ]
}

@test "compress --check returns 1 for fresh file, 0 after compress" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  run "$CLI" compress --check DOC.md
  [ "$status" -eq 1 ]

  run "$CLI" compress DOC.md
  [ "$status" -eq 0 ]
  run "$CLI" compress --check DOC.md
  [ "$status" -eq 0 ]
}

@test "compress --force overwrites an existing backup" {
  write_doc DOC.md
  git add DOC.md
  git -c user.email=t@t -c user.name=t commit -q -m add
  echo "stale backup" > DOC.original.md
  run "$CLI" compress --force DOC.md
  [ "$status" -eq 0 ]
  # backup should now be the actual original, not the stale string.
  ! grep -q "^stale backup$" DOC.original.md
}
