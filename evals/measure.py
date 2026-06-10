#!/usr/bin/env python3
"""evals/measure.py — turn a run directory into results.json.

Usage:
    python3 evals/measure.py [run-dir]   # default: evals/.runs/latest

Token estimation: we use char/4 (the industry rule of thumb for English
prose) plus a word count, and surface both in the report. We deliberately
don't pull tiktoken so the harness has zero pip dependencies.
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
DEFAULT_RUN = HERE / ".runs" / "latest"


@lru_cache(maxsize=None)
def _read_text(path: Path) -> str:
    """Cached read — mode/prompt files are re-used across every row."""
    return path.read_text()


def estimate_tokens(text: str) -> int:
    """char/4 rule of thumb. Good to ~10% on English prose; close enough
    for ratio-based comparisons across modes."""
    return max(1, math.ceil(len(text) / 4))


def measure_pair(meta_path: Path) -> dict[str, Any]:
    meta = json.loads(meta_path.read_text())
    out_path = meta_path.with_suffix("").with_suffix(".out")
    output = out_path.read_text(errors="replace")
    return {
        "mode": meta["mode"],
        "prompt": meta["prompt"],
        "instructions_bytes": meta["instructions_bytes"],
        "prompt_bytes": meta["prompt_bytes"],
        "output_bytes": len(output.encode("utf-8")),
        "output_words": len(output.split()),
        "output_lines": output.count("\n") + (1 if output and not output.endswith("\n") else 0),
        "tokens_in": estimate_tokens(
            _read_text(HERE / "modes" / f"{meta['mode']}.md")
            + "\n\n"
            + _read_text(HERE / "prompts" / f"{meta['prompt']}.txt")
        ),
        "tokens_out": estimate_tokens(output),
        "wall_seconds": round(meta["ended_at"] - meta["started_at"], 4),
        "live": meta.get("live", 0),
        "backend": meta.get("backend", "stub"),
    }


def aggregate(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    by_mode: dict[str, dict[str, float]] = {}
    for mode in {r["mode"] for r in rows}:
        in_mode = [r for r in rows if r["mode"] == mode]
        by_mode[mode] = {
            "prompts": len(in_mode),
            "tokens_in_total": sum(r["tokens_in"] for r in in_mode),
            "tokens_out_total": sum(r["tokens_out"] for r in in_mode),
            "tokens_out_median": statistics.median(r["tokens_out"] for r in in_mode),
            "output_bytes_total": sum(r["output_bytes"] for r in in_mode),
            "output_words_total": sum(r["output_words"] for r in in_mode),
        }
    return by_mode


def savings_table(agg: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """Compute % savings vs the control arm on output tokens."""
    if "control" not in agg:
        return []
    control_out = agg["control"]["tokens_out_total"]
    if control_out == 0:
        return []
    out: list[dict[str, Any]] = []
    order = ["control", "generic-terse", "lite", "full", "ultra"]
    for mode in order:
        if mode not in agg:
            continue
        m = agg[mode]
        savings = (control_out - m["tokens_out_total"]) / control_out * 100
        out.append(
            {
                "mode": mode,
                "tokens_in": int(m["tokens_in_total"]),
                "tokens_out": int(m["tokens_out_total"]),
                "savings_pct_vs_control": round(savings, 1),
                "median_tokens_out": int(m["tokens_out_median"]),
            }
        )
    return out


def main(argv: list[str]) -> int:
    run_dir = Path(argv[1]) if len(argv) > 1 else DEFAULT_RUN
    if not run_dir.is_dir():
        print(f"evals/measure.py: not a directory: {run_dir}", file=sys.stderr)
        return 2

    rows: list[dict[str, Any]] = []
    for meta_path in sorted(run_dir.rglob("*.meta.json")):
        rows.append(measure_pair(meta_path))

    if not rows:
        print(f"evals/measure.py: no .meta.json files under {run_dir}", file=sys.stderr)
        return 1

    agg = aggregate(rows)
    table = savings_table(agg)

    out = {
        "run": str(run_dir.resolve().relative_to(HERE.resolve()) if run_dir.is_relative_to(HERE) else run_dir),
        "rows": rows,
        "aggregate": agg,
        "table": table,
        "notes": "Token counts are char/4 estimates; treat as ratios across modes, not as exact API token billing.",
    }
    target = HERE / "results.json"
    target.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(f"evals/measure.py: wrote {target.relative_to(HERE.parent)} ({len(rows)} rows, {len(agg)} modes)")
    for row in table:
        print(f"  {row['mode']:<14} tokens_out={row['tokens_out']:>6}  savings={row['savings_pct_vs_control']:>+6.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
