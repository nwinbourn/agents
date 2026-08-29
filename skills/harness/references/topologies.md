# Topologies

Six shapes. Each has an **objective exit condition** and a **characteristic failure** —
the way that shape specifically goes wrong. Pick by the structure of the work, not by
which one sounds impressive.

## 1. Fan-out / fan-in

N independent workers on disjoint slices, results merged at the end.

- **Use when:** the pieces don't touch each other's files and don't need each other's
  output.
- **Exit:** every slice returned, and the merged result builds/passes.
- **Characteristic failure:** the merge doesn't build. Each worker was locally correct;
  together they duplicated a helper or disagreed on an interface.
- **Prevent it:** the orchestrator pins shared interfaces *before* the fan-out, and owns
  the integration points (routing, barrels, `package.json`, shared types). Workers request
  changes there in their return value instead of making them.

## 2. Pipeline

Each item flows through stage 1 → 2 → 3 independently. Item A can be in stage 3 while item
B is still in stage 1.

- **Use when:** multi-stage work over many items. **This is the default for staged work** —
  wall-clock is the slowest single chain, not the sum of slowest-per-stage.
- **Exit:** every item reached the final stage or was dropped with a reason.
- **Characteristic failure:** using a barrier out of habit. If you find yourself writing
  "collect all, transform, dispatch again" and the transform has no cross-item dependency,
  that's a pipeline wearing a barrier's clothes.
- **A barrier is genuinely needed only for:** dedup across the full set, an early exit on
  zero results, or a stage whose prompt references "the other findings".

## 3. Judge panel / best-of-N

Generate N independent attempts from different angles, score them with independent judges,
synthesize from the winner while grafting the best ideas from runners-up.

- **Use when:** the solution space is wide and the first plausible answer is rarely the
  best — architecture, naming, API shape, design direction, strategy.
- **Exit:** all attempts scored on a stated rubric, one selected with reasons.
- **Characteristic failure:** judges converge on the most confidently-written attempt.
- **Prevent it:** judges must not see each other's votes, and must score against a rubric
  fixed *before* they read the attempts. Give the generators genuinely different angles
  (risk-first, simplest-thing-that-works, user-first), not the same prompt N times.
- **Cost note:** N is a straight multiplier. Cap at 3 unless the decision is expensive.

## 4. Adversarial verify

Spawn skeptics prompted to refute a claim; keep only what survives. Full prompts in
`verification.md`.

- **Use when:** a wrong answer is expensive — security findings, production bug claims,
  anything leaving the team.
- **Exit:** every high-stakes claim is refuted, or has survived a majority of refuters.
- **Characteristic failure:** asking refuters to "double-check". A reviewer asked to check
  confirms; a reviewer asked to break finds.
- **Prevent it:** the word *refute* in the prompt, independence between refuters, and
  `refuted: true` as the default under uncertainty.

## 5. Loop-until-dry

Keep running discovery rounds until K consecutive rounds surface nothing new.

- **Use when:** the size of the result set is unknown — bug hunts, edge cases, audit
  findings.
- **Exit (all three, always):**
  1. K consecutive rounds add nothing new (K=2 is a sane default), **and**
  2. a hard round cap, **and**
  3. a budget floor.
- **Characteristic failure:** never converging, because dedup runs against *confirmed*
  results instead of *everything seen*. Rejected findings then reappear every round.
- **Prevent it:** keep a `seen` set of everything surfaced, verified or not, and dedup
  against that. Also terminate immediately on a round that makes zero progress — that's
  what stops the infinite-polish loop.

**Every loop needs an objective exit.** A loop that exits on "looks good enough" polishes
noise forever. This is the single most common way agent systems burn tokens.

## 6. Reuse chain

Continue one worker across a sequence of related tasks instead of booting a new one each
time (`SendMessage`).

- **Use when:** follow-ups are adjacent — same files, same feature, a fix to what it just
  built, a question about its own findings.
- **Exit:** the task sequence completes, or the domain shifts (then boot fresh).
- **Characteristic failure:** context poisoning. A worker resumed onto an unrelated task
  pattern-matches its previous one and produces confidently wrong work in the old shape.
- **Prevent it:** reuse only for adjacent work; boot fresh when the domain changes or when
  the previous run failed or overclaimed. A poisoned worker costs more than a boot tax.

## Composing them

Real work usually stacks two or three. A thorough audit:

```
loop-until-dry
  └─ round: fan-out finders (different lenses)
       └─ dedup against `seen`          ← plain code, not an agent
            └─ pipeline: each fresh finding → adversarial verify
                 └─ confirmed findings accumulate
```

Two rules when composing:

- **Dedup and merge in plain code, not in an agent.** Set membership and sorting don't
  need a model, and a model will do it inconsistently.
- **The orchestrator is the single writer of shared state.** Workers return data; the main
  loop decides what's true and what gets written.
