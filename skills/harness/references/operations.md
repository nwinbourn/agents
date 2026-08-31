# Operations: rails, failures, and hygiene

## Non-blocking orchestration

**Default `run_in_background: true`.** The user keeps working with the main loop while
workers run; completion arrives as a notification and you integrate then.

What this requires of you:

- **Never fabricate a pending worker's result.** If the user asks before the notification
  arrives, say it's still running.
- **Don't poll.** Harness-tracked work re-invokes you on completion. Sleeping or looping
  to check is pure waste.
- **Keep a mental ledger** of what's in flight and what each one owes you, so an arriving
  result can be placed without re-reading its order.

### The permission stall

A backgrounded worker that hits a permission prompt stalls **invisibly** — no error, no
completion, just silence. Anything that writes files or runs commands must therefore do
one of:

1. **Run foreground** (`run_in_background: false`) — simplest, costs the parallelism.
2. **Have its paths pre-approved** in the project's `.claude/settings.json` before
   dispatch.
3. **Run in worktree isolation**, which also solves parallel-writer conflicts.

Read-only workers (`Explore`, analysis, research) background freely — they don't prompt.

## Browser and preview: single-occupancy

There is **one preview pane per session**. Two workers driving it produce interleaved
nonsense.

- Fan-outs **build first**, then **one** inspector checks everything in a single pass,
  setting up its own page and window state.
- **Never delegate scroll- or animation-timing checks.** Preview panes freeze
  scroll-driven motion; a delegated inspector reports confidently on a frozen frame. Those
  checks go to the human's own browser.
- Visual comparison against a design is a main-loop job, always.

## Parallel writers

- **Disjoint files is the default.** State ownership explicitly in every order.
- **Worktree isolation** (`isolation: "worktree"`) when overlap is unavoidable. It costs
  ~200–500ms setup and disk per worker — real, and cheaper than a bad merge.
- **The orchestrator is the single writer of shared state:** routing files, barrels,
  `package.json`, lockfiles, config, and the project's memory files. Workers request
  changes there in their return value.
- **One merge pass, one build**, in the main loop.

## When workers fail

| Symptom | Response |
|---|---|
| **Hung** — no return well past its expected run | `TaskStop` it. Re-dispatch with a tighter budget and narrower scope; an unbounded worker explores forever. |
| **Crashed / returned null** | Re-dispatch once. Twice failing means the order is wrong, not the worker — rewrite the order. |
| **Returned prose instead of the schema** | The order's Return field was weak. Reuse the worker with a corrective message rather than booting a fresh one. |
| **Overclaimed** — says done, isn't | This is why verification triggers are objective. Route the work up a tier, not to the same tier again. |
| **Scope creep** — did more than asked | Review the extra work before keeping it. Add explicit `Do not touch` constraints on re-dispatch. |
| **Refused / hit a permission wall** | It was backgrounded and shouldn't have been. Re-dispatch foreground or pre-approve the paths. |

**Escalation ladder for repeated failure:** retry once → re-route up a tier → pull the work
inline. If it fails inline too, the task was never well-specified.

**Log rework.** When delegated work had to be redone, append a `rework` line to the tally.
Savings minus rework is the number that decides whether the harness is worth running —
without it, "this saves tokens" is a belief, not a measurement.

## Reuse hygiene

`SendMessage` continues a worker with its context intact — zero boot tax, and it works
even after the worker has finished (a send resumes it from its transcript).

- **Reuse for adjacent work:** same files, same feature, a fix to what it just built, a
  question about its own findings.
- **Boot fresh when:** the domain changes, the previous run failed, or the previous run
  overclaimed. A worker primed on one task pattern-matches it onto the next, and a poisoned
  worker costs more than a boot tax.
- **`ListAgents` is the truth; the ledger is a hint.** The ledger can't see everything —
  it doesn't know which worker a completion belonged to, and two sessions share one file.
  Verify before relying on it.

## Instrumentation

Hooks write these automatically when the harness is enabled:

- `~/.claude/harness/tally.md` — one row per dispatch: date, project, tier, agent type,
  tokens, description. The estimator learns from it; `/harness status` reports from it.
- `~/.claude/harness/fleet.json` — the live/idle ledger backing burst costing and reuse
  hints.

Your one manual duty is the `rework` line. Everything else is measured, not remembered.

**These files are the transient layer only.** They answer "what is running and what did it
cost", and they die with the session. The durable answer — which slices exist, what landed,
what's blocked — belongs in the project's `STATE.md`, written as statuses at wrap-up.
Never copy worker ids or token counts into `STATE.md`: that is what happened, not where
things stand.
