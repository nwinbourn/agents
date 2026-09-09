# agents

Project memory and a reliable handoff between people and AI sessions — one Claude Code plugin.

Open a project, ask **"what's next?"**, do the work, then say **"wrap up."** The next
session starts with current context, clear next actions, and work shared through git.

## The core workflow

### 1. Keep useful project memory

- **CONTEXT.md** describes what the project is and its settled decisions.
- **STATE.md** describes where work stands, what's next, and anything still in flight.
- **PITFALLS.md** records recurring traps and their fixes when needed.

One home per fact. No dated activity logs. Settled decisions graduate out of STATE;
stale information gets removed. The files travel with the project rather than living
in a separate service or one person's chat history.

At session start, the plugin syncs first and then loads the current memory files into
the agent's context—even when the session starts in a subfolder. Missing required
files and oversized excerpts are explicit. [How startup memory works](plugin/docs/SESSION-MEMORY.md).

### 2. Keep shared work on dev

Most projects work directly on `main`, and that is fine. The dev flow is for a
**live** project: real users, `main` auto-deploys, more than one person committing.
Nothing activates until the repo has an `origin/dev` branch, and no agent ever
creates one on its own.

```text
main   ────────────────●──────────────────────●────   production (auto-deploys)
                      ↑                      ↑
                    merge                  merge      ← rare, deliberate
                      │                      │
dev    ──●──●──●──●───●──●──●──●──●──●──●────●────    shared working branch
          everyone commits here, constantly
```

At session start, the sync hook fetches and fast-forwards a clean, strictly-behind
`dev` checkout. Dirty work, divergence, or another branch calls for a decision; the
hook preserves local work and never switches branches automatically.

While the agent works, a branch guard enforces the flow at the command line. In any
project with memory files it refuses task branches and worktrees, the usual source of
a repo full of stray branches. Where `origin/dev` exists it also refuses commits off
`dev`, and anything that touches `main` (switching to it, merging into it, pushing it)
becomes a permission prompt, because that is a release. Refusals go to the model with
the reason; you only see the release prompts. [What it checks](plugin/docs/BRANCH-GUARD.md).

**Enforcement boundary:** the guard sees git run through the agent's shell tools.
Other tools, other agents, and your own terminal are not covered. Use repository
branch protection when production needs a hard server-side restriction.

### 3. Wrap up with a usable handoff

`/wrap-up` reviews actual changes, refreshes and compacts memory, and leaves a
three-line pickup pointer:

```markdown
**Do this first:** review the checkout error handling in src/checkout.ts
**Waiting on you:** confirm the retry wording
**Mid-flight:** validation pending for the checkout fix
```

On shared projects, wrap-up includes committing the agreed scope, reconciling remote
changes and pushing with user approval. An independent, read-only verifier checks the
branch, conflicts, unfinished Git operations, commits, clean checkout, the handoff
fields and (on shared projects) whether `dev` matches origin. It reports passed,
incomplete or unknown; an unavailable remote cannot pass.
See [verifier usage](plugin/docs/WRAP-UP-VERIFIER.md).

The checks run whether or not the agent remembers to run them:

- **When wrap-up ends**, a hook checks that STATE.md has a real Start here block
  (three fields, and a first step that names a file, route or command, so "continue
  the redesign" is rejected), and flags changelog creep: dated lines, "we added" and
  "we fixed" narration, log sections, and facts copied word-for-word from CONTEXT.md.
- **At the next session start**, the verifier runs again against the synced checkout
  and the agent opens with one line: the previous handoff passed, or it left
  uncommitted work, an unfinished merge, unpushed commits, or no usable Start here block.
- **On every turn**, a stop hook notices when project files changed but STATE.md did not.

These checks are mechanical: they prove the handoff's shape and the repository's
state, not that the prose is accurate. The agent still reviews the memory and the
agreed commit scope.

## Install

```text
/plugin marketplace add nwinbourn/agents
/plugin install agents@agents
```

Approve the hooks, then follow [setup](plugin/docs/SETUP.md). For a non-technical
teammate, the [collaborator guide](plugin/docs/SETUP-COLLABORATOR.md) walks their agent
through setup and the first handoff.

## Public evidence, small plugin

```text
plugin/       Installable skills, hooks, templates and setup guides
tests/        Public regression tests, with fixtures created in temporary directories
docs/         Testing guidance and live evaluation scenarios
.github/      Automated test workflow
```

The marketplace installs `./plugin`, so tests are outside the installed plugin
payload. A Git-based marketplace may still download the full repository into its
marketplace checkout. This layout avoids copying tests into each installed plugin
version; it does not promise a test-free repository download.

Run the evidence yourself with Node 22+ and Git; no dependency installation:

```sh
node tests/run.mjs
```

The suite checks memory reminders, wrap-up markers and bloat, safe Git syncing,
scripted handoffs, the branch guard, harness behavior, and an isolated copy of the plugin payload.
See [what is tested and what needs live evaluation](docs/TESTING.md).

## Extras, separate from the core

These ship in the same plugin but are not part of the memory → dev → wrap-up loop,
and the loop does not depend on them. They are off, or inert, until you use them.

- [Harness](plugin/skills/harness/SKILL.md), experimental: reusable background workers,
  model routing, ownership and verification rules, with best-effort burst checks.
  Off until `/harness on`.
- [Voice](plugin/skills/voice/SKILL.md): switchable output styles.
- [Occam](plugin/skills/occam/SKILL.md): an over-engineering check; its optional hook
  ships unwired.
- `/pause` and `/continue`: interruption handling.

## License

MIT
