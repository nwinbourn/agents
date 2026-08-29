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
- **A delegation harness.** `/harness` turns subagent work into a decision: cost a
  fan-out *before* it runs, route by task complexity, reuse workers instead of re-paying
  their boot cost, and verify high-stakes findings adversarially. No agent-count caps —
  it estimates tokens and only interrupts when a fleet is genuinely expensive. Ships with
  a plays library for implementing designs, debugging, back/front ends, security reviews,
  refactors, and research.
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

Off by default. `/harness on` writes `~/.claude/harness.json` and starts the hooks.

The problem it solves: subagents are cheap to spawn and expensive to spawn *badly*. A
worker can't see your conversation and re-pays a "boot tax" to learn the project, so a
six-worker fan-out for six small edits costs several times what doing it inline would.
The harness makes that arithmetic visible at the moment you can still restructure it.

```
one worker  = boot tax + typical run
a fan-out   = N × (boot tax + typical run)     ← said out loud, before dispatching
```

- **Costs bursts, not calls.** Five 250k workers are each under any sane per-call limit;
  together they're 1.2M. The harness sums a session's recent dispatches and asks **once**.
- **Learns your numbers.** Estimates start from shipped defaults and switch to the median
  of your own measured runs once there's enough data.
- **Never blocks.** It advises by default and asks above a threshold you set. It never
  denies a dispatch and never silently grants permissions.
- **Routes by task.** Top tier for refactors, architecture, and security analysis; cheap
  tier for execution from a spec; `Explore` for read-only search.

Run `/harness status` for live workers, today's spend, reuse rate, estimate-vs-actual, and
an honest recommendation to turn it off if the tally says it isn't paying for itself.

## License

MIT
