---
name: wrap-up
description: End-of-session handoff. Updates the project's STATE.md, graduates settled decisions to CONTEXT.md and repeating traps to PITFALLS.md, writes the "Start here" pointer, and — on shared projects — leaves the dev branch committed and pushed so collaborators (and their agents) receive the session's work and memory. Use when the user says wrap up, we're done, end the session, save this, or asks where to pick up next time — and before /clear or a context switch to unrelated work. Also use when a task finishes and the project docs no longer match reality.
user-invocable: true
argument-hint: "[optional: what to focus on]"
---

Close the session so the next one opens correctly. The deliverable is a `STATE.md` that
answers **"what do I need to do?"** with the right answer, not a plausible one — and, on
shared projects, a `dev` branch that carries the session's work and memory to everyone else.

## The failure this exists to prevent

`STATE.md` slides into being a changelog. It happens every time, and it turns the one file
that should answer *"where are we"* into one that answers *"what happened"* — which git
already does, better.

**Record where things STAND, not what occurred.** A finished thing shows up as a ✅ status
on a phase, or as a plain fact in `CONTEXT.md`. Never as a log line, never with a date
attached, never under a `Done ✅` heading.

## Procedure

### 1. Find what actually changed — don't work from memory

```bash
git status --short && git diff --stat
```

Read that alongside the session. Memory alone will miss edits and invent others.

If `CONTEXT.md` / `STATE.md` / `PITFALLS.md` are already in context from the session's
`@import`, you can skip re-reading for steps 2–5. **Step 6 (compact and cross-check)
requires reading all three files** even if they're in context — the compaction pass needs
the full current text, not a stale in-context copy that predates this session's edits.

### 2. Classify every item before writing anything

For each thing that changed or got decided, apply this test:

> **Would this sentence still be true in three months if nobody did anything?**

| Answer | Goes to | Shape |
|---|---|---|
| Yes — it's a fact about what the project *is* | `CONTEXT.md` | Stated flatly, present tense, no date |
| No — it's about what remains | `STATE.md` | A status, or a next action |
| It's a trap that already cost debugging time **twice** | `PITFALLS.md` | The failure, its tell, and what to do instead |
| It's a visual/brand decision (palette, font, spacing, reference) | `DESIGN.md` (if it exists) | The decision and the why, no dates |
| It's "on <date> we did X" | **Nowhere.** Delete it | git already has it |

Two rules that catch most mistakes:

- **A decision graduates.** Once something is settled it stops being work-in-progress and
  becomes part of what the project is — move it to `CONTEXT.md` and delete it from
  `STATE.md`. Leaving it in both means they will disagree later.
- **Every value lives in one file.** State it once, point at it from the other.

### 3. Update `STATE.md`

Work through it in this order and **delete as much as you add**:

1. **Statuses** — move anything that changed (⬜ → 🔶 → ✅). Adjust the "what's left" cell.
2. **What's next** — reorder if priorities moved. Remove what got done.
3. **Newly discovered** — work that surfaced this session and isn't recorded anywhere.
4. **No longer true** — delete it. Stale entries are worse than missing ones, because
   they get trusted.
5. **Open questions** — add decisions now waiting on the user; remove ones they answered.

### 4. Write the "Start here" block at the top of `STATE.md`

This is the pickup pointer — for whoever opens the project next, on whichever machine.
Keep it to three lines and keep it **forward-looking** — the moment it starts describing
what happened, it has become the changelog again.

```markdown
## Start here

**Do this first:** <one concrete action, specific enough to begin without asking a question>
**Waiting on you:** <decisions blocking work, or "nothing">
**Mid-flight:** <anything left running, wedged, half-built or uncommitted, or "nothing">
```

`Do this first` must name the file, route or command. "Continue the redesign" is a failure;
"open `sandbox/foo.html` and say whether it lands" is not.

### 5. Save durable preferences to memory

If the user corrected how you work, or confirmed an approach, write it to your memory
directory and index it. Preferences belong in memory; project status belongs in `STATE.md`.
Never put project state in global memory — projects are at different stages and it will be
wrong everywhere else.

### 6. Compact and cross-check all three files

The goal: the next session loads these files and gets **accurate, lean context** — no
bloat to wade through, no contradictions to stumble over, no stale info to act on wrongly.
A cold session trusts these files completely — and on shared projects the next session may
be a different person's. Wrong or bloated docs waste the humans' time re-explaining things
and cause agents to get lost.

**Read all project memory files** (STATE.md, CONTEXT.md, PITFALLS.md, DESIGN.md — whichever
exist) and apply these passes:

#### Pass 1: Trim

For each line or block in every file, ask: **does a cold session need this to do its job?**

- **STATE.md** — delete resolved items, completed phases that have no remaining sub-work,
  narrative about how something was built, anything that reads as "what happened" rather
  than "what's left." If a phase is ✅ done with nothing pending under it, collapse it to
  one line with the status.
- **CONTEXT.md** — delete detail that duplicates what the code already says (exact file
  paths that could be grepped, implementation specifics that live in the source). Keep
  decisions, constraints, brand facts, and anything a session couldn't derive by reading
  the codebase. Tighten wordy explanations — if a paragraph can be a sentence, make it one.
- **PITFALLS.md** — delete entries for traps that no longer apply (the code was
  restructured, the dependency was removed, the pattern was eliminated). Keep anything
  that could still bite. Tighten verbose entries to: the trap, its tell, the fix.
- **DESIGN.md** (if it exists) — delete entries for design choices that were reversed
  or superseded. Keep the current visual identity, not the history of how it got there.
  Verify key claims (palette, fonts, spacing) still match the codebase — flag anything
  that's drifted rather than silently trusting it.

#### Pass 2: Deduplicate

If the same fact appears in more than one file, keep it in the one it belongs to (use the
classification test from step 2) and delete it from the others. Two copies will drift —
one will be wrong eventually.

#### Pass 3: Contradictions

Compare claims across files and against the current code. For each contradiction found:
- **Stop and ask the user** — present both versions, say which file each is in, and ask
  them to decide, verify, or clarify. Do not silently pick one.
- Wait for their answer before writing the fix.

#### Pass 4: Verify

- **The cold-open test:** if someone opens a session tomorrow and asks "what do we need to
  do?", does `STATE.md` alone answer correctly? If not, it isn't finished.
- **The changelog check:** scan for lines starting with a date, or containing "we
  added/fixed/changed/did". Every one is a log line. Rewrite as status, or delete.
- **The size check:** `STATE.md` over 400 lines is almost always bloated — look harder.
  `CONTEXT.md` over 300 lines means detail is creeping in that belongs in the code, not
  the docs. These aren't hard limits, but they're where to push back.

### 7. Sync the shared branch

Check whether this project uses the shared-branch flow:

```bash
git rev-parse --verify --quiet refs/remotes/origin/dev
```

**No `origin/dev`** → solo flow: show what would be committed and ask. Pushing is the
user's call. Never sweep in files the user was working on themselves — check `git status`
for anything you didn't touch and exclude it explicitly. Done.

**`origin/dev` exists** → `dev` must end the session committed and pushed, because
unpushed work (including the memory updates from steps 3–6) is invisible to every other
person and their agents:

1. **Commit** — confirm you are on `dev` (if not: stop and ask; never switch branches
   silently). Show what changed in plain words, confirm the scope with the user, exclude
   anything they were editing themselves, commit.
2. **Fetch before pushing** — `git fetch origin dev`. If `origin/dev` moved during the
   session, say so, then merge it in (`git merge origin/dev` — never rebase shared
   history). Conflicts in memory files are prose: merge both truths yourself, keep every
   open item from both sides, and re-read the result. Conflicts in code the user can't
   resolve: `git merge --abort`, push the session's commits to `wip/<name>-<topic>`
   instead, record in `STATE.md` who needs to finish the merge, and tell the user plainly.
3. **Push with the user's go-ahead** — show what's going up first. If the push is
   rejected because the remote moved again: fetch, merge, retry once, then report
   honestly.
4. **Verify** — `git status` clean and `git rev-list --count origin/dev..dev` returns 0.
   Only then is the session actually closed.

## If the project has no `STATE.md`

It hasn't adopted the protocol. Offer to create the three files in the standard shape
before doing anything else — `CONTEXT.md` (the WHAT), `STATE.md` (the progress tracker),
`PITFALLS.md` (the repeating traps), loaded via `@import` from the project loader. The
plugin's `templates/` directory has skeletons for all of them.

If it has them in the **old shape** — a `Done ✅` log inside `STATE.md`, or a separate
dated history file — say so and offer to convert: lift settled decisions into `CONTEXT.md`,
rebuild `STATE.md` as a status tracker, drop the log. Don't keep feeding a changelog just
because one is already there.

## Report back in the chat

Close with, briefly:

- **Where to pick up** — repeat the `Do this first` line.
- **What moved** — statuses that changed, in one line.
- **Sync state** — on shared projects: "dev is committed and pushed" or exactly what isn't
  and why.
- **What's waiting on them** — decisions only they can make.
- **Anything you left out and why.**
