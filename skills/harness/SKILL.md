---
name: harness
description: Delegation doctrine and toggle — decide when to hand work to subagents, which model tier to route it to, how to write a work order a worker can execute blind, and how to verify what comes back. Invoke on "/harness", "/harness on|off|status", or when the user asks about delegating, fan-outs, parallel agents, worker reuse, or what a fleet will cost. Also load it before running any multi-agent play (implementing a design, debugging, a security review, a cross-file refactor, a research sweep).
argument-hint: "[on | off | status]"
---

# /harness — delegation doctrine

Subagents are cheap to spawn and expensive to spawn *badly*. This skill exists to make
delegation a decision rather than a reflex: cost it, route it, brief it, verify it.

**The one-line thesis:** a worker cannot see this conversation and re-pays a boot tax to
learn the project. Delegation wins when the work is bigger than that tax and separable
from the chat. It loses on everything else, and it loses silently.

**Toggle state lives in `~/.claude/harness.json`.** When `enabled`, hooks inject a compact
core into every turn, cost each dispatch, and keep the tally. When off, everything below
is still valid doctrine — you can run all of it by hand.

## The four decisions, in order

### 1. Delegate at all?

| Signal | Inline | Delegate |
|---|---|---|
| Size vs boot tax | smaller than the boot cost | several times larger |
| Coupling to this chat | needs conversation history, taste, or your judgment | fully specifiable in writing |
| Latency | change-and-look iteration, live debugging with the user | user is free to do something else |
| Parallelism | one thread of work | independent pieces |

**Never delegate:** visual iteration (a worker can't see the pane, and panes freeze
animation), decisions the user should make, anything smaller than its own boot tax.

### 2. Route to which tier?

Model follows task, not seniority.

- **Top tier** (`opus`/`fable`) — cross-file refactors, security analysis, architecture,
  shared primitives, subtle logic. Anything where a miss costs a review-and-fix round.
- **`sonnet`** — execution from a clear spec: implementation, migrations, tests, docs.
- **`haiku` / `Explore`** — mechanical lookup, read-only search, grep-verifiable sweeps.
  Only when boot tax is small relative to the work; in doc-heavy projects the boot
  ingest erases haiku's advantage entirely.

**Always set `model` explicitly.** Omitting it inherits the session model — on an
expensive main loop that turns a ten-worker sweep into a ten-worker expensive sweep by
accident.

### 3. Brief it — the work order

A worker starts blind. Everything it needs rides in the order, or the work comes back
wrong. Full template and a good/bad pair: `references/work-order.md`.

Minimum viable order: **objective · why it matters · exact input paths · constraints ·
done-when (objectively checkable) · return shape (raw data, not prose) · verify-before-
returning command · budget ceiling.**

### 4. Verify — set the trigger *before* dispatch

Never from a worker's own confidence; workers overclaim exactly when they're wrong.
Four tiers and their objective triggers: `references/verification.md`.

## Cost arithmetic

```
one worker  = boot tax + typical run
a fan-out   = N × (boot tax + typical run)      ← do this multiplication out loud
```

Batching related tasks onto one worker pays the boot tax once. Reusing a worker
(`SendMessage`) pays it zero times — the context is still there. `ListAgents` is the
truth about who's alive; the ledger is a hint.

Worked examples and the escalation economics: `references/deciding.md`.

## Non-blocking orchestration

Default to `run_in_background: true` and keep talking to the user. Completion arrives as
a notification; integrate then. The exception is permission-risky work — a backgrounded
worker stalled on a permission prompt is invisible, so writers either go foreground, get
their paths pre-approved, or run in worktree isolation.

## Reference index

Load on demand — don't read them all.

| File | When |
|---|---|
| `references/deciding.md` | delegate-at-all test, routing table, cost worked examples |
| `references/work-order.md` | writing the dispatch prompt |
| `references/verification.md` | choosing a verification tier, refuter prompts |
| `references/topologies.md` | fan-out, pipeline, judge panel, adversarial verify, loop-until-dry |
| `references/plays-build.md` | implementing a design, front end, back end, general build |
| `references/plays-investigate.md` | debugging, research, audits |
| `references/plays-security.md` | authorized security review |
| `references/plays-refactor.md` | cross-file refactor, migration, mechanical sweep |
| `references/operations.md` | browser rails, parallel writers, failure handling, reuse hygiene |

## Toggle procedure

**`/harness on` / `off`:**

1. Read `~/.claude/harness.json`. Missing → create it from the plugin's
   `templates/harness.json` (defaults suit everyone; the user tunes later).
2. Set `enabled` to `true`/`false`. Change nothing else.
3. Confirm in one line. Note that the injected core starts (or stops) on the next
   message, and other open sessions pick it up on their next turn.

**`/harness` or `/harness status`:**

Read `~/.claude/harness.json` and `~/.claude/harness/{fleet.json,tally.md}`, then report:

- **Effective state** — `enabled`, plus the self-assessed gate: if the main session model
  is a cheap tier, say **"ON but rarely worth it — the main loop is already cheap"**.
  There's no expensive brain to protect.
- **Live fleet** — pending/live/idle entries with tiers and ages. Say plainly that this is
  the ledger's guess; `ListAgents` is authoritative.
- **Today** — dispatch count and estimated tokens, and how many rows are unmeasured.
- **Estimate vs actual** per tier, so the user can see whether to trust the estimator and
  tune `bytesPerToken` / `defaultEstimates` from evidence.
- **Boot-tax share** — what fraction of delegated tokens was boot cost. High share means
  batch harder or delegate less.
- **Reuse rate** (SendMessage continuations ÷ total dispatches) and **rework count**
  (`rework` lines in the tally).
- **The kill switch:** if the harness has been injecting for 7+ days with no dispatches,
  or rework is eating the savings, say so and recommend `/harness off`. Recommend —
  never flip it yourself.

The tally is written automatically by hooks. The one manual duty: when delegated work had
to be redone, append a `rework` line. Savings minus rework is the number that decides
whether this mode deserves to stay on.
