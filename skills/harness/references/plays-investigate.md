# Plays: investigating

## debug

1. **Reproduce inline first.** Delegating an unreproduced bug is delegating a guess —
   you'll get three confident, different, unverifiable answers. If you can't reproduce it,
   that's the task: make a repro, inline.
2. **Fan out hypotheses, not files.** 3–4 workers, each given the *same* repro plus *one*
   hypothesis to test. Each returns evidence for or against with `file:line`.
   **Tell them explicitly that "disconfirmed, here's why" is a successful result** —
   otherwise workers stretch to find support for their assigned theory.
3. **Route cheap.** This work is checkable — the repro either flips or it doesn't.
   `sonnet`, or `Explore` when the hypothesis is "where does X get set".
4. **Exit:** one hypothesis has a change that flips the repro. Not "the worker sounded
   sure."
5. **The fix goes to exactly one worker, or inline.** Parallel fixers on one bug guarantee
   a conflict.
6. **Verify:** T1 normally; T2 when the fix touches shared primitives. The regression test
   *is* the done-criterion.

**The anti-pattern, named:** N workers all told "find the bug". They read the same files,
pay boot tax N times, and return contradictory findings the orchestrator can't adjudicate
without redoing the work. Hypotheses partition the search space; "find the bug" doesn't.

### Variant: fix N failing tests (loop-until-dry)

Exit when the test command exits 0, **or** a round fixes zero failures, **or** a hard round
cap. That middle condition is what stops the infinite-polish loop. Batch related failures
onto one worker — failures in the same module usually share one cause.

## research / audit

1. **Fan out by question, not by document.** "What does the auth module do" partitions
   badly; "does any endpoint skip the auth middleware" partitions well. One question per
   worker, each with the same return schema.
2. **Every finding carries a citation** — `file:line` or a URL — **or it doesn't exist.**
   Put this in the order verbatim. An uncited finding is a guess with formatting.
3. **Route:** `Explore` for "where is X" and "what exists". `sonnet` for reading and
   summarizing a known area. Top tier only for the verdict — the judgment about what the
   findings *mean*.
4. **Synthesis is a main-loop job.** Workers return findings; the orchestrator decides
   what's true, resolves contradictions, and writes the conclusion. A worker asked to
   synthesize other workers' findings will smooth over exactly the disagreements that
   matter.
5. **Use a judge panel when the answer is a judgment call** (which approach, which tool,
   is this codebase healthy) rather than a fact-finding sweep.
6. **Exit:** every question answered with evidence, or explicitly marked unanswerable and
   why.

### Codebase audit — the standard shape

```
Explore agents (cheap)     → the map: what exists, where, how it's wired
     ↓ (main loop reads the map, picks what matters)
sonnet workers             → read the areas that matter, return findings + citations
     ↓ (main loop dedups — plain code, not an agent)
one top-tier worker        → the verdict on the deduped findings
     ↓
adversarial verify         → only for high-stakes claims (see plays-security.md)
```

**Completeness critic:** for a thorough audit, close with one worker asked *"what's
missing — which area wasn't searched, which claim is unverified, which file wasn't read?"*
What it finds becomes the next round. That's how a sweep that felt done gets honest.

## Reporting findings

- **Rank by severity, not by discovery order.**
- **Dedup before reporting**, in plain code — the same issue found by three workers is one
  issue.
- **Separate confirmed from unverified**, explicitly. Never present a plausible finding as
  a confirmed one.
- **Say what wasn't covered.** If the sweep sampled, or skipped a directory, or ran out of
  budget, that belongs in the report. Silent truncation reads as "covered everything".
