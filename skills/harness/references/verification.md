# Verification

**The rule that governs everything here: the trigger is set before dispatch, from the
stakes and checkability of the work — never from how confident the worker sounded.**

Workers overclaim, and they overclaim *most* exactly where they're wrong: a worker that
misunderstood the task reports success, because by its own model of the task it
succeeded. Confidence is not signal. A verification policy that fires "when the worker
seems unsure" fires least when it's needed most.

## The four tiers

| Tier | What it is | Trigger |
|---|---|---|
| **T0 — none** | take the result | mechanical, reversible, and self-evident on read (a file inventory, a grep sweep) |
| **T1 — orchestrator reviews** | you read the diff/result yourself | the default. Small enough to review honestly in-loop |
| **T2 — independent verifier** | one fresh worker checks the work against the original order | shared primitives, hard-to-reverse changes, a diff too large to review honestly, or work you can't evaluate from the return value alone |
| **T3 — adversarial refuters** | N workers each try to *disprove* the finding | high-stakes claims: security findings, "this is a bug in production", anything going to a third party |

**T1 is the default and should stay the default.** Verification is not free — it's another
boot tax plus another run. Escalate on the trigger, not on principle.

**The verifier cost rule:** never spawn a verifier whose estimated cost exceeds roughly
half the work it's checking. Past that ratio, route the original work up a tier instead —
doing it right once is cheaper than doing it cheap and checking it expensively.

## T2 — the independent verifier

Give the verifier the **original work order** and the **result**, and nothing else. Do not
give it the worker's reasoning; you want an independent read, not a review of a
rationalization.

```markdown
## Work order — verify: <original name>

**Objective:** Determine whether the attached result satisfies the attached order.

**Inputs:** the original work order (below), the diff/result (below), the repo at <path>.

**Return:** `{ satisfies: true|false, gaps: [...], overreach: [...], evidence: [file:line] }`
- `gaps` — required things not done
- `overreach` — things done that the order didn't ask for

**Done when:** every requirement in the order is marked met or unmet, with evidence.

**Do not fix anything.** Report only.
```

The `overreach` field matters as much as `gaps`. Scope creep in a worker's output is how
unrequested changes reach a shared branch.

## T3 — adversarial refutation

Independent skeptics, each prompted to *refute*, not to "double-check". A reviewer asked
to check tends to confirm; a reviewer asked to break tends to find. Run them in parallel
and never let them see each other's verdicts — otherwise they converge on whichever
argument sounded most confident.

```markdown
## Work order — refute: <claim>

**Objective:** Find the reason this claim is WRONG. You are not evaluating fairly; you
are trying to break it. If it survives a genuine attempt, that is a meaningful result.

**The claim:** <the finding, verbatim, with its evidence>

**Inputs:** <repo path, the exact files cited>

**Look for:** an upstream check that makes it unreachable; a framework default that
already handles it; a sanitizer, guard, or type constraint the claim missed; a code path
that can't actually be triggered; a misread of the control flow.

**Return:** `{ refuted: true|false, reason: "...", evidence: ["file:line"] }`
When `refuted: false`, list specifically what you checked and ruled out.

**Default to `refuted: true` if you are uncertain** — a claim that can't survive scrutiny
shouldn't be reported.
```

**Verdict rule:** the claim survives only if a majority fail to refute it. Two of three is
a reasonable default; three of five for anything going outside the team.

**Perspective-diverse variant:** when a claim can be wrong in more than one way, give each
refuter a different lens (correctness / security / does-it-actually-reproduce /
performance) instead of running N identical skeptics. Diversity finds failure modes
redundancy can't.

## What makes a done-criterion objective

The work order's **Done when** field is the cheapest verification there is — it moves the
check into the worker's own context, where tokens are cheap.

| Weak | Objective |
|---|---|
| "tests pass" | `npx vitest run` exits 0 |
| "the endpoint works" | `curl -s localhost:3000/health` returns `{"ok":true}` |
| "no type errors" | `npx tsc --noEmit` exits 0 |
| "the bug is fixed" | the repro in `tests/bug-412.test.ts` goes green and no other test regresses |
| "looks right" | *not verifiable — this work shouldn't be delegated* |

That last row is the tell: if you can't write an objective done-criterion, the task is
probably a judgment call, and judgment calls stay inline.

## Verifying a fan-out

Verify **per item as it lands**, not after the whole fleet finishes. A pipeline where each
finding verifies while other finders are still running has the same wall-clock as the
slowest single chain; a barrier makes every fast worker wait for the slowest.

Barriers are correct only when the verification genuinely needs the whole set — deduping
across all findings, or an early exit when the count is zero.
