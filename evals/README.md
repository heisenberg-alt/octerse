# evals

A reproducible eval harness for the five Copilot-instruction modes Octerse
ships:

- `control` — no instructions (baseline)
- `generic-terse` — "be terse" baseline (the honest control for the savings
  claim — without it, "lite/full/ultra are good" could just mean "telling the
  model to be brief is good")
- `lite` / `full` / `ultra` — the three octerse modes (symlinks into
  `instructions/`)

10 prompts × 5 modes × your favourite model = a numbers-on-the-table view of
how much each mode actually saves.

## Layout

```
evals/
├── prompts/               # 10 short, realistic dev prompts
├── modes/                 # the 5 mode files (3 are symlinks into ../instructions/)
├── fixtures/<mode>/<prompt>.out   # pre-recorded outputs for stub mode
├── run.sh                 # drive the matrix
├── measure.py             # tabulate run logs into results.json
├── report.py              # render the README marker block
├── results.json           # latest tabulated run (committed)
└── .runs/<ts>/            # per-run outputs (gitignored)
```

## Quick start

```sh
bash evals/run.sh                   # stub mode — uses fixtures, no LLM needed
python3 evals/measure.py            # writes evals/results.json
python3 evals/report.py             # updates the README marker block

bash evals/run.sh --live --backend copilot   # real `gh copilot suggest`
bash evals/run.sh --live --backend claude    # real `claude -p`
```

## Stub mode

By default `run.sh` reads pre-recorded fixtures from `fixtures/<mode>/<prompt>.out`.
This makes the harness reproducible without invoking a real LLM, and is what
runs in CI.

The fixtures are **plausible illustrative examples** — they show a realistic
ordering (`control > generic-terse > lite > full > ultra` in token count) but
the absolute savings are not a guarantee about any specific model. **Run
`--live` to get real numbers for your model and your prompts.**

## Live mode

`--live --backend copilot` invokes `gh copilot suggest` per pair. `--backend
claude` invokes `claude -p`. Both are best-effort: if the CLI is missing or
unauthenticated the pair gets a placeholder marker so the rest of the matrix
still completes.

Per-pair output lands in `evals/.runs/<timestamp>/<mode>/<prompt>.out`. A
companion `<prompt>.meta.json` records the input/output byte counts and wall
time.

## Token estimation

`measure.py` uses the char/4 rule of thumb for tokens. It's accurate to ~10%
on English prose — which is far more than enough for the **ratio** comparison
across modes. We deliberately don't pull `tiktoken` so the harness has zero
pip dependencies and runs anywhere `python3` does.

## Adding a prompt or a mode

- New prompt: drop a `prompts/NN-name.txt` and a fixture for each of the 5
  modes under `fixtures/<mode>/NN-name.out`. Live mode doesn't need fixtures.
- New mode: drop a `modes/<name>.md` and edit the `modes=(...)` list at the
  top of `run.sh`. The fixture directory `fixtures/<name>/` becomes optional
  in live mode.

## CI

`.github/workflows/evals.yml` runs the harness on every release tag (`v*`).
It uses stub mode by default — Copilot CLI in GitHub Actions runners isn't
reliable enough to be the source of truth for a published table.

When you want to refresh the table from real LLM output, run `--live`
locally, commit `results.json`, and push. The README marker block updates
in the same commit.
