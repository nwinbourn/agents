# Deciding: delegate, route, and cost it

## The delegate-at-all test

Run all four. Any single "inline" answer usually settles it.

**1. Is it bigger than the boot tax?**
Every worker re-pays a fixed cost to learn the project: system prompt and tool schemas
(unmeasurable, call it ~12k) plus the project's `CLAUDE.md` and its `@import` chain
(measurable — the dispatch hook reports it). In a doc-heavy project that's 40–60k before
the worker does anything useful. A task that would take you 15k inline costs 60k
delegated. Delegate when the work is *several times* the tax, not merely larger.

**2. Can it be fully specified in writing?**
The worker cannot see this conversation. If the task depends on something the user said
three messages ago, on your read of their taste, or on a decision that hasn't been made
yet, writing the order costs more than doing the work.

**3. Is the user free while it runs?**
Delegation trades latency for context. That's a win when they're doing something else, a
loss when they're waiting on a change-and-look loop.

**4. Are the pieces independent?**
Parallel work must touch disjoint files, or it needs worktree isolation and a merge pass,
which often costs more than running in sequence.

### The disqualifiers

Never delegate, regardless of size:

- **Visual iteration.** Workers can't see the preview pane, and panes freeze scroll- and
  animation-driven motion — a delegated inspector reports confidently on a frozen frame.
- **Decisions the user owns.** Taste, scope, priorities, anything irreversible.
- **Live debugging with the user.** The value is the tight loop.
- **Anything smaller than its own boot tax.** This is the most common mistake.

## Routing: the model follows the task

| Tier | Route here when | Examples |
|---|---|---|
| **Top** (`opus` / `fable`) | a miss costs a review-and-fix round; the work is long-horizon or judgment-heavy | cross-file refactor, security analysis, architecture, shared primitives, subtle algorithmic logic, adjudicating conflicting findings |
| **`sonnet`** | there's a clear spec and the result is checkable | implementing from a spec, migrations, tests, docs, transcription, straightforward features |
| **`haiku` / `Explore`** | mechanical, read-only, or grep-verifiable | finding call sites, inventorying files, mapping a codebase, simple sweeps |

**`Explore` is a subagent type, not a model** — a read-only search agent that returns
conclusions instead of file dumps. Reach for it whenever the question is "where is X" or
"what does this codebase do", and skip the model question entirely.

### Escalation economics

Two directions, both valid:

- **Escalate up front** when a mistake is expensive to detect. Security findings,
  refactors, and shared primitives go top-tier the first time; a cheap worker plus a
  verifier costs more than doing it right once.
- **Cheap-first with verification** when the result is objectively checkable. Tests pass
  or they don't. A sonnet implementation verified by a build is cheaper than an opus
  implementation, and the build is a better check than either model's confidence.

**The verifier cost rule:** never spawn a verifier whose estimated cost exceeds roughly
half the work it checks. Past that, route the original work up a tier instead.

**Always set `model` explicitly.** Omitting it inherits the session model. On an expensive
main loop, an unannotated ten-worker sweep is an expensive ten-worker sweep, and nothing
in the dispatch says so.

## The arithmetic, out loud

```
one worker  = boot tax + typical run
a fan-out   = N × (boot tax + typical run)
```

Say the multiplication before dispatching a fan-out. It's the whole discipline.

### Worked example — the batching decision

Six small doc updates, project boot tax ~45k, typical sonnet run ~200k.

- **Six workers:** 6 × (45k + 200k) ≈ **1.5M**
- **One worker, six tasks in the order:** 45k + ~350k ≈ **400k**
- **Inline:** ~120k, and no merge risk

Inline wins. If the six tasks were six *features* rather than six edits, the per-worker
run dominates and the fan-out is worth it — the boot tax stops being the deciding term
once the work per worker is large.

### Worked example — when the fan-out is right

Audit twelve modules for a specific class of bug. Each needs a real read of unfamiliar
code (~150k of work), and they're fully independent.

- **Twelve `Explore`/sonnet workers:** 12 × (45k + 150k) ≈ 2.3M, wall-clock ≈ one worker
- **Inline:** ~1.8M *of main-context tokens*, and the context is now full of file dumps

The token totals are comparable; the difference is *where* the tokens land. Delegation's
real win is context isolation — the main loop gets twelve summaries instead of twelve
codebases, and stays useful for the rest of the session.

## Reuse before boot

A worker you've already dispatched still has its context. `SendMessage` continues it —
zero boot tax — and this works even after it has finished, because a send resumes it from
its transcript.

- **Reuse** when the follow-up is adjacent: same files, same feature, a fix to what it
  just built, a clarifying question about its own findings.
- **Boot fresh** when the domain changes, or when the previous run failed or overclaimed.
  A worker primed on the wrong task pattern-matches its last one, and a poisoned worker
  costs more than a boot tax.

`ListAgents` is the truth about who exists. The ledger in `~/.claude/harness/fleet.json`
is a hint — it can't see everything, so verify before relying on it.

## Context economics

The reason delegation pays isn't tokens, it's *where* they land. Protect that:

- Workers return **raw data and file:line references**, never file contents.
- No narration in return values — the orchestrator doesn't need a story.
- Batch related tasks onto one worker to pay boot once.
- Prefer `Explore` for search: it reads excerpts and returns conclusions.
