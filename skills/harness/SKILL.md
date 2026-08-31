---
name: harness
description: Delegation commands and doctrine. Run a play by name — /harness build, debug, audit, security, refactor, loop — or enter orchestrator mode with /harness agents to dispatch background workers while staying in conversation. Also /harness on|off|status for the cost-tracking hooks. Invoke on any /harness command, or when the user asks about delegating, fan-outs, parallel agents, worker reuse, or what a fleet will cost.
argument-hint: "[agents | build | debug | audit | security | refactor | loop | on | off | status]"
---

# /harness

Subagents are cheap to spawn and expensive to spawn *badly*. This skill makes delegation a
decision rather than a reflex: cost it, route it, brief it, verify it.

**The thesis:** a worker cannot see this conversation and re-pays a boot tax to learn the
project. Delegation wins when the work is bigger than that tax and separable from the chat.
It loses on everything else, and it loses silently.

## Command table

| Command | Kind | What it does |
|---|---|---|
| `/harness agents` | **mode** — persists | Orchestrator mode: dispatch in the background, stay conversational, integrate as results land |
| `/harness build <what>` | one-shot | Run the build play — design, front end, back end, or general |
| `/harness debug <what>` | one-shot | Reproduce, then fan out one hypothesis per worker |
| `/harness audit <what>` | one-shot | Research or review: fan out by question, every finding cited |
| `/harness security <scope>` | one-shot | Authorized review by attack surface, findings refuted before reporting |
| `/harness refactor <what>` | one-shot | Cross-file refactor, migration, or mechanical sweep |
| `/harness loop <goal>` | one-shot | Iterate until an objective exit fires |
| `/harness on` / `off` | toggle | Start/stop the cost-tracking hooks |
| `/harness status` | report | Live fleet, spend, reuse rate, whether this is paying off |
| `/harness` (bare) | report | Print this table and the current state |

**`/harness loop` is not `/loop`.** The built-in `/loop` re-runs something on a clock. This
one iterates until a *condition* is met — tests green, two rounds finding nothing new, a
budget floor. Different job.

---

## Running a play

Every one-shot follows the same four steps. Don't skip step 1 — it's what stops a fan-out
that costs more than doing the work inline.

**1. Decide whether to delegate at all.** Read `references/deciding.md` if the answer isn't
obvious. Inline wins when the task is smaller than the boot tax, coupled to this
conversation, latency-sensitive (visual iteration), or not parallelizable. **Say so and do
it inline** — running a play because the user typed a command is not a reason to delegate.

**2. Load the play.** Read only the file you need:

| Command | File |
|---|---|
| `build` | `references/plays-build.md` |
| `debug` | `references/plays-investigate.md` |
| `audit` | `references/plays-investigate.md` |
| `security` | `references/plays-security.md` |
| `refactor` | `references/plays-refactor.md` |
| `loop` | `references/topologies.md` (loop-until-dry) |

Also load `references/work-order.md` before writing the first dispatch, and
`references/verification.md` when the play calls for a verifier or refuters.

**3. State the shape before dispatching.** One short message to the user: how you're
splitting the work, which tier each slice goes to, roughly what it will cost, and the exit
condition. Then go — don't wait for approval unless the plan changed materially from what
they asked for.

**4. Write slices into `STATE.md` before a fan-out.** The phases table is the build ledger;
it's what makes a multi-session build resumable. Worker ids and token counts stay out of it.

If the user gave no argument (`/harness build` with nothing after it), ask what to build in
one line. Don't guess at scope.

---

## `/harness agents` — orchestrator mode

The one command that changes the session's posture until turned off.

**Turning it on:** write `agents` to `~/.claude/harness/mode` (create the directory if
needed). Confirm in one line, listing what's already in flight if anything is. From the next
message the core hook injects the orchestrator posture instead of the standard one.

**Turning it off:** `/harness agents off` — delete the file. Report anything still running
so nothing is silently abandoned.

**While it's on:**

- **Background is the default.** `run_in_background: true` unless the worker writes files or
  runs commands — those stall invisibly on permission prompts, so they go foreground, get
  pre-approved paths, or run in a worktree.
- **End the turn after dispatching.** Don't sit and wait; that's the entire point. The user
  keeps working with you while workers run.
- **Track what's outstanding.** Every reply while work is in flight ends with a one-line
  status: what's running and what it owes you. Not a paragraph — one line.
- **Integrate as results land.** A completion notification is a prompt to place that result,
  not to dump it. Summarize what changed and what it unblocks.
- **Never invent a pending result.** If asked before it lands, say it's still running.
- **Never poll.** Completion re-invokes you. Sleeping to check burns tokens for nothing.

Full rails and failure handling: `references/operations.md`.

---

## The four decisions

### 1. Delegate at all?

| Signal | Inline | Delegate |
|---|---|---|
| Size vs boot tax | smaller than the boot cost | several times larger |
| Coupling to this chat | needs history, taste, or judgment | fully specifiable in writing |
| Latency | change-and-look iteration | user is free to do something else |
| Parallelism | one thread of work | independent pieces |

**Never delegate:** visual iteration (a worker can't see the pane, and panes freeze
animation), decisions the user should make, anything smaller than its own boot tax.

### 2. Route to which tier?

- **Top tier** (`opus`/`fable`) — cross-file refactors, security analysis, architecture,
  shared primitives, subtle logic. Anything where a miss costs a review-and-fix round.
- **`sonnet`** — execution from a clear spec: implementation, migrations, tests, docs.
- **`haiku` / `Explore`** — mechanical lookup, read-only search, grep-verifiable sweeps.

**Always set `model` explicitly.** Omitting it inherits the session model — that's how a
ten-worker sweep becomes expensive by accident.

### 3. Brief it

A worker starts blind. Minimum: **objective · why it matters · exact input paths ·
constraints · done-when (objectively checkable) · return shape (raw data, not prose) ·
verify-before-returning command · budget ceiling.** Template in `references/work-order.md`.

### 4. Verify

Set the trigger *before* dispatch, from stakes and checkability — never from a worker's
confidence. Workers overclaim exactly when they're wrong. Tiers in
`references/verification.md`.

## Cost arithmetic

```
one worker  = boot tax + typical run
a fan-out   = N × (boot tax + typical run)      ← do this multiplication out loud
```

Batching related tasks onto one worker pays boot once. Reusing a worker (`SendMessage`)
pays it zero times. `ListAgents` is the truth about who's alive; the ledger is a hint.

## Reference index

Load on demand — don't read them all.

| File | When |
|---|---|
| `references/deciding.md` | delegate-at-all test, routing, cost worked examples |
| `references/work-order.md` | writing the dispatch prompt |
| `references/verification.md` | verification tiers, refuter prompts |
| `references/topologies.md` | fan-out, pipeline, judge panel, adversarial verify, loop-until-dry |
| `references/plays-build.md` | implementing a design, front end, back end, general build |
| `references/plays-investigate.md` | debugging, research, audits |
| `references/plays-security.md` | authorized security review |
| `references/plays-refactor.md` | cross-file refactor, migration, mechanical sweep |
| `references/operations.md` | browser rails, parallel writers, failure handling, reuse |

---

## `on` / `off` / `status`

**`/harness on` or `off`:**

1. Read `~/.claude/harness.json`. Missing → create it from the plugin's
   `templates/harness.json`.
2. Set `enabled` to `true`/`false`. Change nothing else.
3. Confirm in one line. The injected core starts (or stops) on the next message; other open
   sessions pick it up on their next turn.

**`/harness status`** — read `~/.claude/harness.json` and `~/.claude/harness/{fleet.json,tally.md,mode}`, then report:

- **Effective state** — `enabled`, plus the active mode if any. If the main session model is
  a cheap tier, say **"on, but rarely worth it — the main loop is already cheap"**: there's
  no expensive brain to protect.
- **Live fleet** — pending/live/idle entries with tiers and ages. Say plainly this is the
  ledger's guess; `ListAgents` is authoritative.
- **Today** — dispatch count and estimated tokens, and how many rows are unmeasured.
- **Estimate vs actual** per tier, so the user can see whether to trust the estimator and
  tune `bytesPerToken` / `defaultEstimates` from evidence.
- **Boot-tax share** — what fraction of delegated tokens was boot cost. High means batch
  harder or delegate less.
- **Reuse rate** (SendMessage continuations ÷ dispatches) and **rework count** (`rework`
  rows in the tally).
- **The kill switch:** if the harness has been injecting for 7+ days with no dispatches, or
  rework is eating the savings, say so and recommend `/harness off`. Recommend — never flip
  it yourself.

The tally is written automatically by hooks. The one manual duty: when delegated work had to
be redone, append a `rework` line. Savings minus rework is the number that decides whether
this mode deserves to stay on.
