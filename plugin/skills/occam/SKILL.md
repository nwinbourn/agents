---
name: occam
description: Guards against over-engineering while coding. Before adding code, check what the repo, the standard library, the platform, and installed dependencies already provide, and keep the solution proportional to the request. This is guidance, not a gate — it never blocks work. Applies when building or extending functionality; not when debugging. Run "/occam check" to strip over-engineering out of the current changes — it edits the code, it does not report.
user-invocable: true
argument-hint: "[check | optional: a file or area to focus on]"
---

# Occam

Keep the work proportional to the request. This is guidance and never blocks —
complete what was asked. Rationale, history and honest limits live in `NOTES.md`,
deliberately not here, so only the working content loads when this fires.

## Occam Lite — while coding

- **Check the repo first.** Grep before writing. Something close may already exist.
- **Prefer what's already there** — the standard library, a platform or framework
  primitive, a native element, an installed dependency — over custom code.
- **Skip speculative flexibility.** No abstraction, config option, wrapper, layer or
  extra file that the caller which exists *right now* does not need.
- **Keep the solution proportional to the request.** A button is not a subsystem.
- **Scale the investigation to the change.** Risk of over-building rises with size and
  complexity, so the bigger or riskier the change, the more you read the existing system
  and pin down the actual requirement before writing. Small change, quick look. Large
  change, look properly.

## Never trimmed

Security, input validation, necessary error handling, data-loss protection,
accessibility, and anything the user explicitly asked for. Also debugging — correctness
outranks minimalism, so don't run a proportionality check over a two-line bug fix.

## On correction

If the user is correcting a previous attempt: say in a line or two what the target now
is and what changes versus stays, then make the smallest edit that gets there. Ask one
tight question if it's ambiguous. Unless a rebuild is what they explicitly asked for,
don't rebuild.

## /occam check

Invoked as `/occam check` — read `CHECK.md` and follow it. It finds over-engineering in
the current changes and **fixes it directly**, then reports only what it changed.
