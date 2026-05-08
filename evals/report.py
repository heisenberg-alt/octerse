#!/usr/bin/env python3
"""evals/report.py — render results.json into the README marker block.

Usage:
    python3 evals/report.py            # writes README in place
    python3 evals/report.py --check    # diff-only; non-zero exit if stale
    python3 evals/report.py --print    # print the table to stdout, no write
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
README = HERE.parent / "README.md"
RESULTS = HERE / "results.json"
START = "<!-- BENCHMARK-TABLE-START -->"
END = "<!-- BENCHMARK-TABLE-END -->"


def render_table(results: dict) -> str:
    rows = results.get("table", [])
    if not rows:
        return f"{START}\n_No benchmark data yet. Run `bash evals/run.sh && python3 evals/measure.py`._\n{END}\n"

    headers = ["Mode", "Tokens out (10 prompts)", "Median per prompt", "Savings vs control"]
    lines = [
        START,
        "",
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    label = {
        "control": "control (no instructions)",
        "generic-terse": '"be terse" baseline',
        "lite": "octerse — lite",
        "full": "octerse — full",
        "ultra": "octerse — ultra",
    }
    for row in rows:
        savings = row["savings_pct_vs_control"]
        savings_cell = f"{savings:+.1f}%" if row["mode"] != "control" else "—"
        lines.append(
            "| "
            + " | ".join(
                [
                    label.get(row["mode"], row["mode"]),
                    str(row["tokens_out"]),
                    str(row["median_tokens_out"]),
                    savings_cell,
                ]
            )
            + " |"
        )
    lines.append("")
    lines.append(
        f"_{results.get('notes', '')}_  \n"
        f"_Run: `{results.get('run', '')}` · {len(results.get('rows', []))} pairs._"
    )
    lines.append(END)
    lines.append("")
    return "\n".join(lines)


def splice(readme: str, block: str) -> str:
    if START not in readme or END not in readme:
        # Insert after `## Benchmarks` heading if present, otherwise prepend
        # the heading + block before `## Privacy`.
        if "## Benchmarks" in readme:
            return readme.replace(
                "## Benchmarks\n",
                "## Benchmarks\n\n" + block + "\n",
                1,
            )
        if "## Privacy" in readme:
            return readme.replace(
                "## Privacy",
                "## Benchmarks\n\n" + block + "\n## Privacy",
                1,
            )
        return readme.rstrip() + "\n\n## Benchmarks\n\n" + block + "\n"

    pre, _, rest = readme.partition(START)
    _, _, post = rest.partition(END)
    return pre + block.rstrip() + "\n" + post


def main(argv: list[str]) -> int:
    if not RESULTS.exists():
        print(
            f"evals/report.py: {RESULTS.relative_to(HERE.parent)} not found. "
            f"Run `python3 evals/measure.py` first.",
            file=sys.stderr,
        )
        return 1

    results = json.loads(RESULTS.read_text())
    block = render_table(results).rstrip() + "\n"

    if "--print" in argv:
        sys.stdout.write(block)
        return 0

    readme = README.read_text()
    new_readme = splice(readme, block)

    if "--check" in argv:
        if new_readme != readme:
            print("evals/report.py: README is stale; re-run without --check.", file=sys.stderr)
            return 1
        print("evals/report.py: README is up to date.")
        return 0

    if new_readme == readme:
        print("evals/report.py: README already up to date.")
        return 0

    README.write_text(new_readme)
    print(f"evals/report.py: updated {README.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
