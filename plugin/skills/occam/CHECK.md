# /occam check — find over-engineering and fix it

Loads only when `/occam check` is invoked. **Fix what you find. Do not write a report.**

## Scope

Default to the uncommitted diff plus any new files. If the user named a file or area, use
that instead. Say in one line what you looked at, then start editing.

## What to fix

1. **Already exists.** Something the repo already implements — use the existing one, delete
   the copy.
2. **Reinvented.** Custom code a standard-library call, framework primitive, or native
   element does — swap it.
3. **Unnecessary dependency.** Added for something already available, or barely used —
   remove it and use what's there.
4. **Premature abstraction.** Interface, base class, generic, plugin point or config option
   with exactly one caller — inline it.
5. **Excess structure.** Files, layers, wrappers, adapters or indirection the change does
   not need — collapse them.
6. **Disproportionate complexity.** Built for a bigger requirement than the one stated —
   cut it back to what was asked for.
7. **Over-trimmed.** The reverse failure: a simplification that dropped required security,
   validation, error handling or accessibility — put it back.

## The bar for touching anything

Only change what you can point at concretely: name the existing thing that does the job, or
the caller that never arrives. If you cannot, leave it alone. A hunch that something "feels
heavy" is not enough — guessing here means deleting working code.

**Fewer lines is not the goal.** Do not rewrite working code to shorten it. Do not
restructure something that is already proportional. If the diff is fine, change nothing and
say so in one line.

## Never touch

Security, input validation, necessary error handling, data-loss protection, accessibility,
and anything the user explicitly asked for — even when it looks redundant. These are not
over-engineering. Also leave debugging code and bug fixes alone.

## Before you finish

Run whatever the project already has — tests, typecheck, build, lint. If something fails
because of an edit you made, fix it or revert that edit. **Never leave the project in a
worse state than you found it.** If the project has no checks, say so.

Existing analyzers (`jscpd`, `knip`, `deptry`) may be run if already installed, as leads to
verify before acting. Never install anything to run this.

## What to say afterwards

A short list of what changed — one line each, no rationale:

```
- swapped the custom date formatter for Intl.DateTimeFormat
- deleted the SettingsProvider wrapper, one caller now reads config directly
- removed date-fns, nothing imports it any more
```

Then: whether the project's checks passed, and anything you deliberately left alone and why
(one line). Nothing else. No summary of the codebase, no explanation of why each thing was
over-built.
