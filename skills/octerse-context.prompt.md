---
mode: ask
description: Context engineering quick-reference card.
---

Print exactly the following block, then stop:

```
OCTERSE — context engineering

Stack        copilot-instructions.md      re-sent EVERY turn — keep <= 80 lines
             AGENTS.md                    re-sent every turn (CLI + agents)
             *.instructions.md            scoped via applyTo glob — free when unmatched
             .prompt.md skills            loaded only when invoked
             history + tool output        the runaway cost; compact it

Audit        gh octerse context           per-turn token tax + findings
             gh octerse audit             bloat check, copilot-instructions.md only
             gh octerse compress <file>   shrink any instructions file in place

Attach       #file / @path/file:line      precise, cheap
             #codebase                    whole-workspace search — last resort
             !command (CLI)               shell direct, zero tokens

Delegate     /explore                     codebase Q&A — answer back, not file reads
             /task                        tests/builds — summary back, not logs
             /delegate                    cloud agent — returns a PR

Window       /context                     usage breakdown by category
             /compact                     summarize history, free the window
             /clear · /new                reset between unrelated tasks
             /usage                       end-of-session accounting

Rules        one task per prompt · @file:line not directories
             /compact before focus switch, not after the window is full
             scope instructions files with applyTo — unscoped == always-on

Install      bash install.sh --with-context     adds the context-discipline
                                                instructions file to this repo

Deep dive    docs/context-engineering.md in the octerse repo
```
