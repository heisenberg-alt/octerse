---
mode: ask
description: Write a terse Conventional Commit message for the staged changes.
---

Inspect the staged diff. Produce **one** Conventional Commit message:

```
<type>(<scope>): <subject>
```

Constraints:

- `type` ∈ {feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert}
- `scope` is the module or directory most affected (lowercase, optional)
- `subject` is imperative mood, ≤50 characters, no trailing period
- Body only if *why* is non-obvious. Wrap at 72. Skip otherwise.
- No emoji. No throat-clearing. Output the message and nothing else.

Examples of good output:

```
fix(auth): guard against missing JWT
```

```
perf(db): index orders.created_at

Cuts dashboard p95 from 1.2s to 90ms.
```
