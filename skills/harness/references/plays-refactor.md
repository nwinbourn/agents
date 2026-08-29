# Plays: refactoring and migration

## cross-file refactor

**Route top tier.** A partial refactor is worse than none — the codebase is left in a
state nobody designed, half-migrated, and the next person can't tell which half is
correct.

1. **The main loop writes the change spec** before any dispatch: the exact before/after
   pattern, the rename map, what the new shape is, what stays. Ambiguity here multiplies
   by the number of workers.
2. **Inventory first, cheaply.** `Explore` or grep produces the complete list of call
   sites. Never let workers each discover the scope — they'll disagree about it.
3. **Partition by directory or module**, so file ownership is unambiguous.
4. **Use worktree isolation when workers must touch overlapping files.** It costs disk and
   setup time, and it's cheaper than a merge conflict resolved by a model.
5. **One merge pass, one build, in the main loop.**
6. **Verify T2** — refactors are exactly the "diff too large to review honestly" case.
7. **Exit:** the build passes, the full test suite is green, and a grep for the old
   pattern returns zero (name that grep in every order as the done-criterion).

**The characteristic failure:** workers "improve" adjacent code while they're in there.
Put `Do not change behavior. This refactor is mechanical — if a change alters what the
code does, stop and report it` in every order.

## migration

Sequential by nature — a pipeline, not a fan-out.

1. **Stages run in order** with a rollback point between each. Schema migrations
   *especially* never run in parallel.
2. **Each stage is independently reversible**, and the order says how.
3. **Verify at every stage boundary** before starting the next. A failure three stages
   deep with no checkpoints means re-running everything.
4. **Data migrations get a dry-run mode first**, on a copy, with row counts compared.
5. **Route:** top tier for the migration plan and any data transformation; `sonnet` for
   mechanical code changes each stage implies.
6. **Exit:** every stage verified, the old path removed (or explicitly kept behind a flag,
   recorded in the project's state file).

## mechanical sweep

The cheap case — a rename, a lint fix, an import rewrite, a dependency bump across many
files.

- **Route `haiku` or `sonnet`**, but only when the boot tax is small relative to the sweep.
  In a doc-heavy project the boot ingest can dwarf a haiku worker's entire savings — check
  the arithmetic before assuming cheap is cheap.
- **The done-criterion must be grep-verifiable:** "`rg 'oldName'` returns nothing" beats
  "all references updated".
- **Batch aggressively.** A sweep is the ideal batching case — one worker with fifty files
  pays boot once. Split only when the file count makes a single worker's context tight.
- **Verify T0/T1** — the grep *is* the verification.
- **Exit:** the grep is clean and the build passes.

## Deciding between them

| The change is… | Play |
|---|---|
| pattern-identical everywhere, no judgment per site | mechanical sweep, cheap tier |
| requires understanding each call site's context | cross-file refactor, top tier |
| stateful, ordered, or touches production data | migration, sequential pipeline |

**When unsure, treat it as a refactor.** A sweep that turns out to need judgment produces
fifty confidently-wrong edits; a refactor that turns out to be mechanical just costs a bit
more than it needed to.
