---
name: harness
description: Three things — reuse an existing worker instead of paying a fresh one's startup cost, route work to the right model tier so expensive models don't run cheap work, and an orchestrator mode (/harness agents) that dispatches in the background so the user keeps talking while workers run. Load when delegating to subagents, writing a Workflow script, running at high effort, or when asked about agents, fan-outs, worker reuse, or which model a worker should use. Handles /harness agents|off|status.
argument-hint: "[agents | off | status]"
---

# /harness

Three jobs. Nothing else.

1. **Reuse a worker before booting a new one** — the cheapest dispatch is the one that
   skips learning the project again.
2. **Route work to the right model tier** — so a fan-out of mechanical work doesn't run on
   your most expensive model.
3. **Keep you talking while workers run** — `/harness agents`.

## Reuse before you boot

Every fresh worker re-reads the project to learn it — tens of thousands of tokens before it
does a single useful thing. A worker you already dispatched has all of that in its context
already. Continuing it costs none of it again.

**Check first, every time.** `ListAgents` lists what exists; `SendMessage` continues one.
This works **even after a worker has finished** — a send resumes it from its transcript. A
finished worker is not a dead worker.

| Reuse it | Boot fresh |
|---|---|
| A follow-up on what it just did | The domain changed — different feature, different part of the codebase |
| A fix to its own output | Its last run failed, or it claimed success it didn't have |
| A question about its own findings | You need an *independent* read — a verifier or refuter must never be the worker that did the work |
| More of the same task on the same files | Its context is now long enough that it's slow or drifting |

**The trap:** a worker resumed onto unrelated work pattern-matches its last task and returns
confidently wrong output in the old shape. A poisoned worker costs more than a fresh boot.
Adjacent work reuses; a new domain boots.

**Batching is the same saving, paid up front.** Six related edits on one worker pays the
boot cost once. Six workers pays it six times. If the tasks touch the same files, they were
never parallel anyway.

## Routing: the model follows the task

**Set `model` explicitly on every dispatch.** Omitting it inherits the session model, which
is how a twelve-worker sweep silently becomes twelve expensive workers.

| Tier | Use for | Not for |
|---|---|---|
| **Top** — `fable`, `opus` | cross-file refactors, architecture, security analysis, subtle logic, shared primitives, adjudicating conflicting results | anything with a clear spec |
| **`sonnet`** | execution from a spec: implementing, migrating, testing, writing docs, transcribing, straightforward features | judgment calls with no spec |
| **`haiku`** | mechanical, pattern-identical edits with a grep-verifiable result | anything requiring a read of intent |
| **`Explore`** (agent type, not a model) | "where is X", "what exists here", read-only search | anything that writes |

**The test:** *would a wrong answer here cost a review-and-fix round?* Yes → top tier. No,
and the result is objectively checkable → cheap tier plus the check.

**Waste to avoid, in order of how much it costs:**

- **Top tier on spec execution.** The single biggest waste. If you've written what to build,
  `sonnet` builds it.
- **Top tier on search.** "Find every call site" is `Explore`. It reads excerpts and returns
  conclusions instead of dumping files.
- **A fan-out where every worker is top tier.** Fan-outs are usually parallel *execution* —
  the judgment already happened when you decided the split. Cheap tier is the default for
  the workers; the orchestrator holds the judgment.
- **`fable` on anything but the hardest single call.** It's the verifier of last resort and
  the main loop's model, not a fleet model.
- **Any tier on work smaller than its own boot cost.** A worker re-reads the project to
  learn it — tens of thousands of tokens before it does anything. Below that, do it inline.

Cheap tier plus an objective check (`npm test` exits 0, `tsc --noEmit` passes, a grep
returns nothing) beats an expensive tier with no check, and costs less.

## `/harness agents` — orchestrator mode

**On:** write `agents` to `~/.claude/harness/mode` (create the directory if needed). Confirm
in one line. The core hook swaps the injected posture from the next message.

**Off:** `/harness off` — delete the file. Report anything still running so nothing is
silently abandoned.

**While it's on:**

- **Background by default** (`run_in_background: true`) and **end the turn after
  dispatching.** Sitting and waiting defeats the mode.
- **Workers that write files or run commands go foreground**, get their paths pre-approved,
  or run in a worktree. A backgrounded worker stalled on a permission prompt is invisible —
  it looks identical to one that's still thinking, forever.
- **One status line per reply** while work is in flight: what's running, what it owes you.
- **Never invent a pending result.** Still running means still running.
- **Never poll.** Completion re-invokes you; sleeping to check burns tokens for nothing.
- **`ListAgents` shows who's alive. `SendMessage` continues one** with its context intact —
  free compared to booting a fresh worker, and it works after a worker has finished. Reuse
  for adjacent follow-ups; boot fresh when the domain changes or the last run went wrong.
- **You are the single writer of shared state** — routing files, barrels, `package.json`,
  memory files. Workers request changes there in their return value.

**`/harness status`** — read `~/.claude/harness/mode`, run `ListAgents`, and report the mode
plus what's actually running. One short paragraph.

## Briefing a worker

A worker cannot see this conversation. Everything it needs rides in the order:

- **Objective** — the outcome in one sentence, and why it matters.
- **Inputs** — exact paths. "The config" is a defect.
- **Constraints** — the files it owns, what not to touch, foreground if it writes.
- **Done when** — objectively checkable. `npx vitest run` exits 0, not "looks right." If you
  can't write one, the task is a judgment call and shouldn't be delegated.
- **Return** — raw data and `file:line` references. Never file contents, never narration.
- **Budget** — a scope ceiling: "if this needs more than N files, stop and report."
- **"You are not the orchestrator"** — stops a worker re-planning or spawning its own.

**Verification triggers are set before dispatch**, from the stakes — never from how confident
the worker sounded. Workers overclaim exactly when they're wrong. High-stakes findings
(security especially) get an independent worker prompted to **refute** them; a reviewer asked
to "check" confirms, one asked to break finds.

## What is enforced, mechanically

You route every worker yourself — pick the model per task, the way the tiers above describe.
Two hooks are the backstop, and they enforce **fan-out caps by count**, because that's the
mistake that nukes usage: a big fleet launched at once, usually by accident.

**A fan-out past these counts becomes a permission prompt for the user:**

| Tier | Cap (per burst) |
|---|---|
| fable | 3 |
| opus | 15 |
| sonnet | 30 |

- A **Workflow script** is counted as one fan-out — its `agent()` sites per tier. Sites with
  no `model` count as the session's own model, so an unannotated script on a fable session
  is correctly counted as fable and trips the low cap fast.
- **Individual dispatches** accumulate in a rolling window (`capWindowSeconds`, default 120)
  — the 16th opus worker in two minutes asks; a paced sequence never piles up.
- Under the caps, both hooks are **silent**. The prompt fires only on the fan-out that would
  actually cost real money, and the user decides — deny re-routes or splits it, approve
  means it was deliberate.

Neither hook can deny or allow on its own. Caps and the window live in `~/.claude/harness.json`
(`caps`, `capWindowSeconds`); the tier lists there decide which model name counts as what.

## Never delegate## Never delegate

Visual iteration (a worker can't see the preview, and panes freeze scroll-driven motion),
decisions the user owns, and anything smaller than its own boot cost.
