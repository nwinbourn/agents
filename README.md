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

For projects that already have `origin/dev`, the shared protocol requires agents
to work on `dev` and reserve `main` for deliberate releases. At session start,
the sync hook fetches and fast-forwards a clean, strictly-behind `dev` checkout.
Dirty work, divergence, or another branch calls for a decision; the hook preserves
local work and never switches branches automatically.

Projects without `origin/dev` keep their existing simple workflow on `main`.
The plugin never creates `dev` on its own.

**Enforcement boundary:** branch discipline is an agent instruction, supported by
session-start checks. This plugin does not intercept every write or prevent every
commit on `main`. Use repository branch protection when production needs a hard
server-side restriction.

### 3. Wrap up with a usable handoff

`/wrap-up` reviews actual changes, refreshes and compacts memory, and leaves a
three-line pickup pointer:

```markdown
**Do this first:** review the checkout error handling in src/checkout.ts
**Waiting on you:** confirm the retry wording
**Mid-flight:** validation pending for the checkout fix
```

On shared projects, wrap-up includes committing the agreed scope, reconciling remote
changes and pushing with user approval. An independent verifier checks the branch,
conflicts, unfinished Git operations,
commits, clean checkout, handoff fields and (on shared projects) live remote equality.
It reports passed, incomplete or unknown; an unavailable remote cannot pass.
The agent still reviews the accuracy of the memory and agreed commit scope.
See [verifier usage](plugin/docs/WRAP-UP-VERIFIER.md).

The hooks support this ritual: one notices potentially stale STATE files, and another
checks excessive length or growth after wrap-up. These are heuristics; they cannot
prove that the prose is accurate or that an agent followed every instruction.

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
scripted handoffs, harness behavior, and an isolated copy of the plugin payload.
See [what is tested and what needs live evaluation](docs/TESTING.md).

## Optional helpers

- [Harness](plugin/skills/harness/SKILL.md): reusable background workers, model routing,
  ownership and verification rules, with best-effort burst checks. Off until enabled.
- [Voice](plugin/skills/voice/SKILL.md): switchable output styles.
- [Occam](plugin/skills/occam/SKILL.md): an over-engineering check.
- `/pause` and `/continue`: interruption handling.

The memory → dev workflow → wrap-up loop works without enabling the harness.

## License

MIT
