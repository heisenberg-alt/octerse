# The Octerse playbook

> Octerse is the *output* lever — terse Copilot responses cut the bytes the
> model emits. The five-lever framework below covers the **input** side:
> context, prompts, model choice, scope, and measurement. Together they
> compound to ~70% lower token spend.
>
> Adapted from Joshua Davis (Microsoft Professional Services), *Token
> Optimization — Getting more from every token in GitHub Copilot CLI*,
> April 2026. Used with attribution.

## Why it matters now

GitHub Copilot is moving from premium-request units to **usage-based
billing**. Under UBB:

- You pay for **input + output tokens**, not prompts
- Long conversations cost more than short ones
- **Context size, tool output, and history all meter**
- Per-model rate — cheap models get cheaper

Every token is billable, including the harness itself. Vendor and user
incentives align around **leaner harnesses, more sub-agent hand-offs, real
cost visibility**.

Estimate the dollar impact for your team in the
**[Copilot UBB Estimator →](https://sameerankalgi.github.io/usage-based-billing/)**.

## What actually counts as tokens

Every turn, Copilot CLI re-sends the entire context window:

| Layer | Notes |
|---|---|
| System instructions | Fixed overhead |
| Tool definitions | All available tool schemas |
| Conversation history | Grows every turn |
| Tool call results | Large file reads, command output |
| Your prompt | Usually the smallest piece |
| Model response | Output tokens |

The **re-send effect** is the killer: a 50k-token, 40-turn session
re-sends ~2M input tokens even if your last prompt was 20 words.

> **Context bloat is the single biggest source of wasted tokens.**

## Where tokens get burned

- **Reading whole files** — "look at `src/`" when one function matters
- **Long-running sessions** — no `/clear` between unrelated tasks
- **Oversized instructions** — `.github/copilot-instructions.md` injected
  every turn
- **Verbose tool output** — piping logs / build / test runs into context
- **Wrong model for the job** — Opus for routine edits
- **Re-discovery loops** — re-reading the same file after compaction

> Rule of thumb: if you can't explain *why* Copilot needs a piece of context,
> it's probably costing you.

---

## The five levers

| # | Lever | Leverage |
|---|---|---|
| 1 | Context hygiene | Highest |
| 2 | Prompt discipline | High |
| 3 | Model selection | High |
| 4 | Scope & tool control | Medium-high |
| 5 | Measurement | Closes the loop |

### Lever 1 — Context hygiene

Copilot CLI auto-compacts at ~80–95% of the window. Don't wait for it.

| Command | Use |
|---|---|
| `/clear` | Reset the timeline. Between unrelated tasks. |
| `/compact` | Summarize and free most of the window. Mid-task. |
| `/context` | Breakdown of current usage by category. |
| `/usage` | Per-model totals, duration, files touched. |
| `/resume` | Reopen a prior session with its summary. |
| `/new` | Start a fresh session. |

Habits:

- Run `/context` *before* `/compact` — under 40%, keep going
- `/compact` before switching focus, not after the window is full
- Resume rather than re-explain
- End every task with `/usage`

### Lever 2 — Prompt discipline

| Expensive | Efficient |
|---|---|
| "Look at my repo and figure out why users are getting 500s on login. Check auth, db, middleware, logs. Fix it." | `/plan` "In `@src/auth/login.ts`, `handleLogin` returns 500 when email has unicode chars. Propose a fix." |

Tactics:

- **`/plan` (Shift+Tab) before coding** — cheap, drives the rest
- `@file/path:line` references, not directories
- One task per prompt
- Break big asks into steps

### Lever 3 — Keep custom instructions lean

`.github/copilot-instructions.md` is re-sent on every turn. Every line is a
recurring tax.

**Keep:**

- Standards the model can't infer from code
- Explicit "do not" rules for files / patterns
- One-line tech-stack context

**Cut:**

- Onboarding essays and team history
- Architecture diagrams as ASCII art
- Full style guides — link instead
- Anything redundant with the code itself

> Octerse instruction payloads are **<= 80 lines each** by design — see
> `instructions/` in this repo. The lite/full/ultra/enterprise files are
> deliberately terse for the same reason they tell Copilot to be terse.

### Lever 4 — Match the model to the task

| Tier | Best for | Switch... |
|---|---|---|
| **Included / small** (GPT-5 mini, 4.1) | Autocomplete, syntax help, boilerplate, simple refactors | Default for routine work |
| **Mid-tier reasoning** (Sonnet 4.5, GPT-5) | Most everyday coding | Up only when stuck |
| **Heavy reasoning** (Opus 4.5, o-series) | System design, subtle bugs, deep refactors | Down as soon as the hard part is done |
| **Code-specialist** (Codex) | High-volume generation, second-opinion review | Pair with Sonnet |

Pro move: `/model` mid-session. Plan with Opus → implement with Sonnet →
review with Codex. Each task on the cheapest tier that finishes it.

### Lever 5 — Narrow the blast radius

- **`/cwd` and `/add-dir`** — explicit working directory
- **Content exclusion** — org-level, applies to every developer
- **`.gitignore` hygiene** — reduce what Copilot indexes
- **`--allow-tool` / `--deny-tool`** — stop unnecessary shell calls

Sub-agents save tokens because the main session only sees the *summary*,
not the file reads:

| Sub-agent | What it does |
|---|---|
| `/explore` | Codebase Q&A. Answer flows back, not file contents. |
| `/task` | Run tests/builds. Brief on success, full output on failure. |
| `/plan` | Structured plan before code. Cheap, high-impact. |
| `/review` | Code review with tight signal-to-noise. |
| `/delegate` | Hand off to Copilot cloud agent. Returns a PR. |

---

## Make spend visible

| Layer | What it shows |
|---|---|
| `/context` | Real-time window breakdown. `/compact` when buffer climbs. |
| `/usage` | Session-level: tokens / model / duration / files. End-of-task habit. |
| OTel traces | `invoke_agent`, `chat`, `execute_tool` spans with token counts. Pipe into Azure Monitor / Grafana. |

## Monday-morning checklist

1. Start a new session per task — `/clear` or `/new` between unrelated work
2. Open with `/plan` for anything beyond a one-line change
3. Reference files with `@path/to/file`, not whole directories
4. `/compact` proactively before you switch focus
5. Default to mid-tier models; escalate with `/model` only when needed
6. Trim `.github/copilot-instructions.md` to standards and "do-not" rules
7. End every session with `/usage`
8. Delegate long-running work to cloud agent with `/delegate`

**Three-command starter kit:** `/clear`, `/model`, `/usage` — context
control, cost control, cost visibility.

## Governance — what admins set once

- **Content exclusion** — org-level. Largest one-time reduction available.
- **Budgets & alerts** — 75% / 90% / 100% thresholds before UBB goes live
- **Model access policies** — premium models gated to teams that need them
- **Usage telemetry** — `totals_by_feature` / `totals_by_model_feature` now
  cover CLI

## What savings look like

Illustrative monthly token spend, 20-developer team:

```
Unoptimized           480
+ Context hygiene     360
+ Prompt discipline   280
+ Right-sized models  190
Full playbook         145
```

≈ **70% reduction** vs. unoptimized baseline. No single lever is dramatic;
the combination is.

## Takeaways

1. **Tokens are the new unit of care.** Context bloat → invoice line items.
2. **The levers compound.** Stack them.
3. **Measurement before optimization.** Without `/usage`, every change is guesswork.
4. **Admins move the biggest levers.** Content exclusion + policies +
   budgets shape every developer's defaults.

> **Next step:** run `/usage` at the end of your next three Copilot CLI
> sessions. You'll know your baseline and where to start.
