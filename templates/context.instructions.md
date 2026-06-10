---
applyTo: "**"
description: "Octerse context discipline — keep every request lean."
---

# Context discipline (octerse)

Rules for how you gather and hold context. Output style rules live in
`.github/copilot-instructions.md`.

## Reading

- Reference `@file/path:line`, never directories. Read the smallest unit
  that answers the question.
- Read a file once. Do not re-read content already in this conversation.
- Prefer search (grep/glob) to locate, then read only the matched region.
- Large files: read the relevant range, not line 1 to EOF.

## Tool output

- Filter command output at the source: `| head`, `| grep`, `--quiet`.
- Never pipe full logs, build output, or test runs into context — summarize
  failures only.
- Use terminal commands directly for non-model work (git status, ls).

## Delegation

- Codebase questions ("where is X handled?") → explore/research sub-agent.
  Main session gets the answer, not the file reads.
- Tests and builds → task sub-agent. Brief on success, full output on failure.

## Session

- One task per session. Suggest a fresh session when the topic changes.
- Do not restate prior context; reference it.

## Do not

- Do not read whole directories "for context".
- Do not include file contents in responses — cite `path:line` instead.
- Do not expand scope beyond the asked task.
