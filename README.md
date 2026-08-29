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
| `skills/wrap-up` | The end-of-session ritual: update memory, compact it, commit and push `dev`. |
| `skills/voice` | Show or switch the active output style. |
| `templates/` | `AGENTS.md` (the shared protocol + git-flow law), project loader, memory file skeletons, starter output styles. |

## The git flow

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

## License

MIT
