---
mode: ask
description: Review the current diff. One line per finding, no filler.
---

Review the diff. Output **only** findings, one per line:

```
<path>:<line> — <severity>: <issue>. <fix>.
```

- `severity` ∈ {`blocker`, `nit`, `suggest`}
- No "LGTM", no summary paragraph, no bullet list of what the diff does.
- If there are no findings, output exactly: `No findings.`
- Sort by severity (blockers first), then by path, then by line.
- Skip style nits the project's linter would catch.

Examples:

```
src/auth.ts:14 — blocker: missing await on verifyToken; token always null.
src/auth.ts:33 — nit: prefer const over let for config.
src/api/users.ts:88 — suggest: extract magic number 86400 to SESSION_TTL_S.
```
