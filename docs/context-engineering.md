# Context engineering for Copilot

> Octerse compresses what the model *says*. Context engineering controls what
> the model *sees*. Under usage-based billing both sides meter — this guide
> covers the input side for **Copilot in VS Code** and **Copilot CLI**.

## What context engineering is

Every request to Copilot is assembled from layers you mostly don't see:
system prompt, tool schemas, instruction files, attached files, conversation
history, tool output. Context engineering is deciding **what goes into that
assembly, when, and at what cost** — instead of letting defaults dump
everything in.

The payoff compounds:

- Right context in → fewer wrong answers → fewer retry turns
- Smaller context → smaller re-send tax on *every* subsequent turn
- Persistent context (instructions files) → less re-explaining per session

> Rule of thumb: context you add once is cheap; context re-sent every turn
> is a subscription. Treat instruction files like recurring spend.

## The context stack

What actually gets sent, per turn, cheapest to control first:

| Layer | Set by | Re-sent every turn? |
|---|---|---|
| System prompt + tool schemas | Harness | Yes — fixed overhead |
| `copilot-instructions.md` / `AGENTS.md` | You, once | Yes |
| `*.instructions.md` (scoped) | You, once | Only when `applyTo` matches |
| #-mentions / `@file` attachments | You, per prompt | Yes, while in history |
| Conversation history + tool output | Accumulates | Yes, until compaction |
| Your prompt | You | Smallest piece |

Two consequences:

1. **Persistent files are a per-turn tax.** 300 lines of
   `copilot-instructions.md` is 300 lines on every request, forever.
2. **History is the runaway cost.** One careless "read the whole `src/`
   directory" stays in the window for the rest of the session.

---

## The four context levers

| # | Lever | Surface | Leverage |
|---|---|---|---|
| 1 | Persistent context | instruction files | Highest — pays every turn |
| 2 | Per-request context | #-mentions, `@file` | High |
| 3 | Reusable workflows | prompt files, skills, agents | Medium-high |
| 4 | Session management | compaction, new sessions | High over long sessions |

### Lever 1 — Persistent context (instruction files)

Files Copilot loads automatically, every request:

| File | Scope | Loaded by |
|---|---|---|
| `.github/copilot-instructions.md` | Whole repo | VS Code + CLI + coding agent |
| `AGENTS.md` | Whole repo, cross-tool | VS Code + CLI + most agents |
| `.github/instructions/*.instructions.md` | Files matching `applyTo` glob | VS Code + CLI |

Rules:

- **Write standards the model can't infer** — naming conventions, "do not
  touch" paths, tech-stack one-liners. Skip anything visible in the code.
- **Scope with `applyTo`** — a `*.sql` instructions file costs nothing on a
  TypeScript request. Prefer many small scoped files over one monolith.
- **Budget hard.** Octerse payloads are ≤80 lines by design (see
  `instructions/` in this repo). `gh octerse context` prints your per-turn
  token tax across all always-on files; `gh octerse audit` flags bloat;
  `gh octerse compress` shrinks existing files in place.
- **Install the discipline.** `bash install.sh --with-context` drops
  `.github/instructions/octerse-context.instructions.md` — context rules
  the agent itself follows (read `@file:line` not directories, delegate
  exploration, filter tool output).
- In VS Code, `/init` scaffolds a starter `copilot-instructions.md`; review
  and cut before committing — generated drafts run long.
- **Monorepos:** VS Code only discovers customization files inside the open
  workspace folder by default. Enable
  `chat.useCustomizationsInParentRepositories` to pick up repo-root files
  when you open a subfolder.

### Lever 2 — Per-request context

Explicit beats implicit. Workspace indexing guesses; you know.

**VS Code:**

| Syntax | Sends | Cost profile |
|---|---|---|
| `#file` / `#sym` mention | That file or symbol | Cheap, precise |
| Drag-and-drop / context picker | Same | Same |
| `#codebase` | Search over the whole workspace | Expensive — only when you genuinely don't know where the code lives |
| `#fetch <url>` | Page content | One-shot; cached briefly |
| `@workspace`, `@terminal`, `@vscode` | Domain participants | Scoped, efficient |

**Copilot CLI:**

| Syntax | Sends |
|---|---|
| `@path/to/file` | File contents into the prompt |
| `!command` | Runs shell directly — output never hits the model |
| `/add-dir`, `/cwd` | Widens or moves the working scope explicitly |

Habits:

- Reference `@file/path:line`, never directories
- Ask one task per prompt — multi-part asks pull multi-part context
- If a turn needs no model (checking git status, listing files), use
  `!command` in the CLI — zero tokens
- Don't re-attach what's already in history; the model still sees it

### Lever 3 — Reusable workflows

A workflow you run weekly should not be re-prompted weekly. Package it once:

| Mechanism | File | Invoked |
|---|---|---|
| Prompt files | `.github/prompts/*.prompt.md` | `/name` slash command |
| Skills | `SKILL.md` folders with scripts/resources | Auto-loaded when task matches |
| Custom agents | `.github/agents/*.agent.md` (CLI: also `~/.copilot/agents`) | `/agent`, `--agent=name`, or inferred |

Why this is a *context* lever: a good prompt file carries its own context
contract — output format, constraints, examples — so the request needs no
warm-up turns. Octerse's `/octerse-commit`, `/octerse-review`, and
`/octerse-help` (see `skills/`) are working examples: frontmatter + strict
format + zero filler.

Sub-agents isolate context entirely. The CLI's built-ins (`Explore`, `Task`,
`General purpose`, `Code review`, `Research`) run in a **separate window** —
your main session receives the summary, not the file reads. Delegating a
codebase question to `/explore` instead of reading ten files inline is the
single cheapest research pattern available.

### Lever 4 — Session management

History is context. Manage it like a budget:

| Action | VS Code | CLI |
|---|---|---|
| See usage | Context-window control in chat input (hover for breakdown) | `/context`, `/usage` |
| Compact | `/compact` (optionally with focus hints) | `/compact` |
| Reset | New chat session | `/clear` or `/new` |
| Resume with summary | Session history | `/resume`, `copilot --continue` |

Both surfaces auto-compact near the limit (CLI at ~95%). Don't wait for it:

- `/compact` *before* switching focus, while the summary is still coherent
- New session per unrelated task — compaction summarizes; it doesn't erase
- `/compact focus on the schema decisions` steers what survives (VS Code)
- Resume a session instead of re-explaining context you already paid for

---

## Anti-patterns

| Anti-pattern | Why it costs | Instead |
|---|---|---|
| Context dumping ("here's the whole repo") | Indexed search + giant history | `#file` / `@file:line` the relevant unit |
| `#codebase` by default | Workspace search on every turn | Only when location is genuinely unknown |
| Instruction-file essays | Re-sent every turn, forever | ≤80 lines; `gh octerse audit` |
| One eternal session | Re-send tax grows linearly | `/clear` between tasks |
| Re-attaching files mid-conversation | Duplicate copies in history | It's already there |
| Reading files to answer "where is X?" | File contents pollute main window | Delegate to `/explore` sub-agent |
| Unscoped `*.instructions.md` | Pays on every file type | `applyTo` globs |
| Verbose MCP tool descriptions | Schema overhead every turn | `octerse-shrink` proxy |

## Adoption checklist

1. Run `gh octerse context` — see your per-turn token tax and findings
2. Run `/init` (VS Code) or write `copilot-instructions.md` by hand — then
   cut it to ≤80 lines with `gh octerse audit` / `gh octerse compress`
3. Install agent-side context rules: `bash install.sh --with-context`
4. Split language- or path-specific rules into `*.instructions.md` with
   `applyTo` globs
5. Turn your two most repeated prompts into `.prompt.md` files
6. Switch directory-wide asks to `@file:line` references
7. Delegate codebase questions to the `Explore` sub-agent
8. `/compact` before focus switches; new session per task
9. Watch the context-window control (VS Code) or `/context` (CLI) for a week
   — you'll find your personal bloat source fast

## Resources

**Official docs:**

- [Customize AI in VS Code](https://code.visualstudio.com/docs/copilot/copilot-customization) — instructions, prompt files, skills, agents, MCP, hooks
- [Manage context for AI in VS Code](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context) — #-mentions, compaction, context-window monitoring
- [Using GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli) — `@file`, custom instructions, agents, `/context` / `/usage` / `/compact`
- [Copilot CLI best practices](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices)

**Community:**

- [github/awesome-copilot](https://github.com/github/awesome-copilot) — community instructions, agents, skills, plugins; installable via `copilot plugin install <name>@awesome-copilot`
- [How to write better prompts for GitHub Copilot](https://github.blog/developer-skills/github/how-to-write-better-prompts-for-github-copilot/) — high-level goal, specific asks, examples

**This repo:**

- [The Octerse playbook](./playbook.md) — the full five-lever framework this guide plugs into
- `instructions/` — ≤80-line instruction payloads, live examples of Lever 1
- `skills/` — strict-format prompt files, live examples of Lever 3
- `mcp-servers/octerse-shrink/` — MCP description compression
