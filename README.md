# agents

A working Claude Code system — shipped as one plugin.

Not a prompt collection. This is the harness a small team actually runs on: project
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
  the harness holds it, not because anyone remembers to.
- **A delegation harness.** `/harness` does three things: reuse a worker you already
  booted instead of paying a fresh one's startup cost, route work to the right model tier
  so expensive models don't run cheap work, and an orchestrator mode that dispatches in
  the background so you keep talking while workers run.
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
| `hooks/harness-core.mjs` | Injects the compact delegation core each turn (only while `/harness` is on). |
| `hooks/harness-dispatch.mjs` + `harness-workflow.mjs` | Cost a dispatch or a workflow before it runs; one permission prompt per expensive burst, never a hard block. |
| `hooks/harness-settle.mjs` + `harness-stop.mjs` | Tally every dispatch and track which workers are still resumable. |
| `skills/wrap-up` | The end-of-session ritual: update memory, compact it, commit and push `dev`. |
| `skills/harness` | Delegation doctrine + plays library. Usable by hand with zero hooks. |
| `skills/voice` | Show or switch the active output style. |
| `templates/` | `AGENTS.md` (the shared protocol + git-flow law), project loader, memory file skeletons, starter output styles, harness config. |

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

## The delegation harness

Off until you turn it on. `/harness agents` starts orchestrator mode; `/harness off` stops it.

Subagents are cheap to spawn and expensive to spawn badly. A worker can't see your
conversation and re-reads the project to learn it — tens of thousands of tokens before it
does anything useful. Three rules follow from that:

- **Reuse before booting.** `ListAgents` shows workers that already exist; `SendMessage`
  continues one with its context intact — even after it has finished. That skips the
  startup cost entirely. Reuse for adjacent follow-ups; boot fresh when the domain changes.
- **Route by task, not by seniority.** Top tier for refactors, architecture, security
  analysis and subtle logic. Cheap tier for execution from a clear spec. `Explore` for
  read-only search. A fan-out's workers default cheap — the judgment happened when you
  chose the split.
- **Dispatch in the background and keep talking.** Workers run while you and Claude carry
  on; results integrate as they land. Anything that writes files goes foreground instead,
  because a backgrounded worker stuck on a permission prompt stalls invisibly.

The expensive-model waste is mechanically enforced rather than advised: a hook reads
every `agent()` call in a Workflow script *before it runs*, and the waste it can prove —
sites with no `model` set on an expensive session (they silently inherit it), a fan-out
where most workers are top tier, `fable` used as a fleet model, or any single worker
dispatched on `fable` — becomes a **permission prompt**. You approve if it's deliberate;
you deny and the work re-routes to the right tier. Correct routing never prompts.

## License

MIT
