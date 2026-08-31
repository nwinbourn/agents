# agents

A working Claude Code system — shipped as one plugin.

Not a prompt collection. This is the system a small team actually runs on: project
memory that lives in git, a shared-branch flow that syncs it between people
automatically, switchable output styles, and a session ritual that closes the loop.

## What it does

- **Project memory in plain files.** Every project carries `CONTEXT.md` (what it is),
  `STATE.md` (where it stands), `PITFALLS.md` (what bites). Agents read them at session
  start and are held to strict rules about writing them — no changelogs, no stale
  entries, one home per fact. No vault, no app, no sync service. Files in a repo.
- **Cross-person, cross-session memory via git.** On shared projects, everyone works on
  a `dev` branch. A session-start hook pulls it (fast-forward only — it can't lose your
  work); `/wrap-up` ends every session with `dev` committed and pushed. Your
  collaborator's Claude reads what your Claude learned, and vice versa. That's the whole
  sync mechanism — git is the pipe.
- **Enforcement hooks, not good intentions.** A stop hook nags when `STATE.md` goes
  stale. A wrap-up check catches changelog drift. The memory protocol holds because
  the hooks hold it, not because anyone remembers to.
- **An autonomous agent harness.** `/harness` maintains a reusable background worker
  pool, routes each task to an appropriately priced model on its own, and only
  interrupts for unusually large parallel fan-outs. You control whether it's active —
  never the individual model assignments.
- **Output styles.** `core` communication rules always apply; one active style
  (`default` / `technical` / `learning` / `terse`) layers on top, switched with
  `/voice`. Each person keeps their own tuned copy.

## Install

```
/plugin marketplace add nwinbourn/agents
/plugin install agents@agents
```

Approve the plugin's hooks when prompted, then see [docs/SETUP.md](docs/SETUP.md).

**Working with someone non-technical?** Have them open Claude Code and say:
*"Read docs/SETUP-COLLABORATOR.md from the agents plugin and set me up."* Their Claude
does the rest — [docs/SETUP-COLLABORATOR.md](docs/SETUP-COLLABORATOR.md) is written to
be executed by the agent, not read by the human.

## The three layers

```
PERSON    ~/.claude/CLAUDE.md      who you are, how Claude talks to you     never shared
SYSTEM    this plugin              skills, hooks, templates, the law        install once, updates flow
PROJECT   each project repo        AGENTS.md + CONTEXT/STATE/PITFALLS       travels with git clone
```

The plugin never touches your personal layer. Projects adopt the protocol by copying
the templates; the hooks detect adoption (a `STATE.md`, an `origin/dev`) and stay
silent everywhere else.

## What's inside

| Piece | What it is |
|---|---|
| `hooks/git-sync.mjs` | Session start: fetch and fast-forward `dev` when safe; report and wait when not. Never switches branches, merges, or rebases on its own. |
| `hooks/comms-style.mjs` | Injects `core` + your active output style into every turn. |
| `hooks/state-reminder.mjs` | Stop hook: flags when project files changed but `STATE.md` didn't. |
| `hooks/wrap-up-arm.mjs` + `wrap-up-bloat-check.mjs` | Catches `STATE.md` bloat right after a wrap-up. |
| `hooks/harness-core.mjs` | Injects the harness's standing orders each turn — only while `/harness` is on. |
| `hooks/harness-dispatch.mjs` + `harness-workflow.mjs` | Enforce the fan-out caps: one permission prompt past 3 fable / 15 opus / 30 sonnet in parallel, total silence under them. |
| `skills/harness` | The `/harness on \| off \| agents` switch and the conduct that goes with it. |
| `skills/occam` | An over-engineering brake: guidance while building, and `/occam check` to strip over-built code out of the current changes. Its optional correction hook ships un-wired — the JSON to enable it is in `skills/occam/NOTES.md`. |
| `skills/wrap-up` | The end-of-session ritual: update memory, compact it, commit and push `dev`. |
| `skills/voice` | Show or switch the active output style. |
| `commands/pause` + `commands/continue` | Interrupt handling: `/pause` folds a mid-task addition in without restarting; `/continue` resumes cleanly after an accidental ESC. |
| `templates/` | `AGENTS.md` (the shared protocol + git-flow law), project loader, memory file skeletons, starter output styles, harness core blocks. |

## The git flow (live projects only)

Most repos should just work on `main`. The flow below is for a **live** project — real
users, `main` auto-deploys, more than one person committing. Nothing here activates
unless the repo already has an `origin/dev` branch, and no agent will ever create one for
you.

```
main   ────────────────●──────────────────────●────   production (auto-deploys)
                      ↑                      ↑
                    merge                  merge      ← rare, deliberate
                      │                      │
dev    ──●──●──●──●───●──●──●──●──●──●──●────●────    shared working branch
          everyone commits here, constantly
```

Full rules live in [templates/AGENTS.md](templates/AGENTS.md) — copied into each
project so every agent (not just Claude) reads the same law.

## The harness

`/harness` is an autonomous agent manager with three jobs:

1. **Reuse agents.** New work goes to an existing suitable agent whenever possible,
   preserving its context and avoiding repeated codebase reads. A new agent is spawned
   only when existing ones are unsuitable or occupied.
2. **Route models autonomously.** The harness judges task difficulty and picks the
   model itself — simple/mechanical work gets a smaller, cheaper model; normal
   implementation and research get the mid tier; hard architecture, debugging, and
   synthesis get a larger model. Fan-outs default to the mid tier. You never choose
   models; missing or unsafe routing is corrected internally.
3. **Work while you chat.** Delegated agents run asynchronously while the main agent
   stays available for conversation, reporting progress and folding results in as they
   arrive.

The switch is yours, three positions:

- `/harness on` — autonomous background delegation is enabled.
- `/harness off` — no new delegation; work already in flight finishes.
- `/harness agents` — interactive orchestration: you chat, plan, review, and audit with
  the main agent while workers do the implementation and research in the background. It
  never blocks a reply waiting on them.

The **only** interruption is mechanical, enforced by hooks: a parallel workload of more
than **3 fable, 15 opus, or 30 sonnet** agents becomes one permission prompt before
anything launches. Under those caps the harness is completely silent. Tune the numbers
in `~/.claude/harness.json` if you want different ones.

## License

MIT
