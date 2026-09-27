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
project with memory files it refuses stray branches and worktrees, the usual source of
a repo full of half-merged work. Where `origin/dev` exists, parallel work gets a
`feature/<task>` or `fix/<task>` branch made off `dev` in its own folder (opening one is
a permission prompt), and wrap-up merges it back into `dev`. Commits stay on `dev` or
that branch, and anything that touches `main` (switching to it, merging into it, pushing
it) becomes a permission prompt, because that is a release. Refusals go to the model with
the reason; you only see the release prompts. For the rare genuine hotfix that must land
on `main` while `dev` holds unfinished work, `/override` relaxes that one project's
refusals into approve-prompts for a single, self-clearing window.
[What it checks](plugin/docs/BRANCH-GUARD.md).

Leftovers from before the guard, or from other tools, are listed at every session start
with whether they are merged and whether STATE.md knows about them. Say "clean up the
branches" and the agent walks through them: merged ones deleted after your yes, unmerged
ones shown so you pick merge, keep or delete. Nothing is deleted on its own.

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
  (three fields and nothing else, with a first step that names a file, route or
  command, so "continue the redesign" is rejected), flags changelog creep (dated lines,
  "we added" and "we fixed" narration, log sections, facts copied word-for-word from
  CONTEXT.md), and checks that the trim pass happened: a memory file over its guidance
  size that left wrap-up no shorter than it entered stops the agent once, and PITFALLS
  entries without the Trap / Tell / Fix shape get named. Not a cap: the agent trims, or
  says why the size is needed.
- **At the next session start**, the verifier runs again against the synced checkout
  and the agent opens with one line: the previous handoff passed, or it left
  uncommitted work, an unfinished merge, unpushed commits, a stray branch with
  unrecorded commits, or no usable Start here block. Two more lines list open task
  branches and leftover branches and worktrees, and the size of the memory files with
  what is over guidance.
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
- [Clean branches](plugin/skills/clean-branches/SKILL.md): the "clean up the branches"
  walk-through. Part of the loop's housekeeping rather than an extra, but it only runs
  when you ask.
- [Voice](plugin/skills/voice/SKILL.md): switchable output styles.
- [Occam](plugin/skills/occam/SKILL.md): an over-engineering check; its optional hook
  ships unwired.
- [Override](plugin/docs/BRANCH-GUARD.md#one-time-override): `/override` — a one-time,
  project-scoped bypass of the branch guard for a genuine hotfix straight to `main`. It
  turns that repo's hard refusals into approve-prompts for one short window, then clears
  itself. Nothing goes silent.
- `/pause` and `/continue`: interruption handling.

## License

MIT
