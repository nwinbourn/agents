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
CLAUDE.md imports, you can skip re-reading for steps 2–5. **Step 6 (trim) requires reading every
memory file** even if they're in context — the trim pass needs the full current text, not
a stale in-context copy that predates this session's edits.

### 2. Classify every item before writing anything

For each thing that changed or got decided, apply this test:

> **Would this sentence still be true in three months if nobody did anything?**

| Answer | Goes to | Shape |
|---|---|---|
| Yes — it's a fact about what the project *is* | `CONTEXT.md` | Stated flatly, present tense, no date |
| No — it's about what remains | `STATE.md` | A status, or a next action |
| It's a trap that already cost debugging time **twice** | `PITFALLS.md` | A heading, then **Trap:**, **Tell:**, **Fix:** — under 12 lines, no story |
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
"open `sandbox/foo.html` and say whether it lands" is not. A field may run onto the lines
under its label (a short list is fine), but the block is **the three fields and nothing
else**: no banners, no commands, no "things a cold session must know". A standing warning
is a constraint and lives in `CONTEXT.md`; a trap lives in `PITFALLS.md`; a task list
lives in the body of this file. Keep the whole block under 25 lines.

This is checked mechanically: the Stop hook after wrap-up rejects a first step with no
path, backticked command, URL or commit, stops once when the block carries extra content
or runs long, and the next session start re-checks the whole handoff.

### 4b. If workers ran this session, land their state

Delegated work is invisible in `git diff` until it's integrated, so it's the easiest thing
to lose between sessions. Before moving on:

- **Every slice gets a status row** in the phases table — done, in progress, or blocked,
  with what's left. If a fan-out created slices that were never written down, write them
  now.
- **Unintegrated work goes in `Mid-flight`** — a worker still running, a branch or worktree
  not merged, a result returned but not yet applied. This is the single most valuable line
  in the file for a build that spans sessions.
- **Nothing about the workers themselves.** No agent ids, no token counts, no "spawned 6
  workers" — that's what happened, not where things stand. Record only the state of the
  work.
- **A branch or worktree other than the working branch is unintegrated work.** Session
  start lists them; any with commits not on the working branch must be named here (what
  it holds, who decides) until it is merged or deleted, or the verifier's `branches`
  check stays incomplete. Merged leftovers are clutter: say "clean up the branches".

### 5. Save durable preferences to memory

If the user corrected how you work, or confirmed an approach, write it to your memory
directory and index it. Preferences belong in memory; project status belongs in `STATE.md`.
Never put project state in global memory — projects are at different stages and it will be
wrong everywhere else.

### 6. Trim every file, every time

This is the step that gets skipped, and the reason the files bloat: at the end of a long
session the context is full and cutting feels risky. So it is not optional, and it is
checked. **Every wrap-up removes as well as adds.** A file over its guidance size that
leaves wrap-up no shorter than it entered stops the agent once, with the sizes; you then
trim it or say in one line why the size is needed. That is not a cap. It is the trim pass
being checked.

A cold session trusts these files completely, and on shared projects the next session may
be a different person's. **Read every memory file that exists** and cut, file by file:

| File | Guidance | What to cut |
|---|---|---|
| `STATE.md` | 400 lines | Resolved items; ✅ phases with nothing left (collapse to one line); verdict transcripts and "what happened" narrative; ideas nobody decided (one line under Open questions, or delete); warnings that belong in CONTEXT or PITFALLS |
| `CONTEXT.md` | 300 lines | Implementation detail the code already says; exact paths that can be grepped; explanations that can be a sentence; anything with a date |
| `PITFALLS.md` | 300 lines, entries under 12 | War stories; entries whose trap no longer exists; anything that bit once. Every entry is a heading, then **Trap:**, **Tell:**, **Fix:**, nothing else |
| `DESIGN.md` | 300 lines | Reversed or superseded choices; the history of how the look got there; claims that no longer match the code (flag those rather than silently trusting them) |

**Fresh eyes when a file is over guidance.** Hand the trim pass for that file to a
subagent with a clean context: give it the file, the row above and one rule, that it
proposes deletions and does not write. Apply the cuts you agree with; show the user the
ones you are unsure about. One extra model call is cheaper than every future session
starting 50K tokens deep.

Then, across all files:

- **Deduplicate.** A fact in two files gets one home (the test in step 2) and a pointer
  from the other. Two copies drift; one will be wrong eventually.
- **Contradictions.** Compare claims across files and against the code. Present both
  versions to the user with the file each is in, and let them decide. Never silently pick.
- **The cold-open test.** Someone opens a session tomorrow and asks "what do we need to
  do?" Does `STATE.md` alone answer correctly? If not, it isn't finished.
- **The changelog check.** Lines starting with a date, or containing "we added / fixed /
  changed / did", are log lines. Rewrite as status or delete. The Stop hook flags what its
  patterns catch; the patterns do not catch everything.

Finish with the **trim line** you will report in the chat: lines out of each file, and for
any file at zero, why.

### 7. Sync the shared branch

Check whether this project uses the shared-branch flow:

```bash
git rev-parse --verify --quiet refs/remotes/origin/dev
```

**No `origin/dev`** → the normal case: work is on `main`. Show what would be committed
and ask. Pushing is the user's call. Never sweep in files the user was working on
themselves — check `git status` for anything you didn't touch and exclude it explicitly.
**Do not create a `dev` branch** — its absence is not a gap to fill. Continue to step 8
even if publication is not requested.

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
4. **Verify** — run step 8 after the final edit, commit and approved push.
   A cached origin/dev comparison alone does not establish that the live remote matches.

### 8. Verify the handoff mechanically

After the final changes and any authorized Git operations, run the plugin's command,
resolving its root from this skill's location:

```sh
node "<plugin-root>/hooks/wrap-up-verify.mjs" --project "<project-directory>" --check-remote
```

This explicit command reports JSON with `passed`, `incomplete` or `unknown` for
each check. Exit codes are 0, 1 and 2 respectively; a nonzero result is evidence to
interpret, not a reason to bypass the checks. It never commits, pushes, fetches,
switches branches or edits project files. The remote flag queries origin/dev only
when the existing shared-dev workflow is adopted.

- **Passed:** mechanical checks succeeded. Review memory accuracy, agreed commit
  scope, ignored work and outstanding workers separately before calling wrap-up complete.
- **Incomplete:** report and resolve the named issues within the user's authorized
  scope. Never sweep unrelated work into a commit to obtain a clean result.
- **Unknown:** report what could not be verified. A missing/offline remote or skipped
  remote check cannot justify saying the shared handoff is complete.

Rerun after fixing an issue or changing files. For local projects, a passing result
does not claim publication; commits and pushing remain the user's decision. If the
user chooses to leave work uncommitted, state that choice and the incomplete result.
An accurate Mid-flight field can describe unfinished work; its presence alone never
proves that the work is finished. Results are a point-in-time snapshot.

Details and check boundaries: `docs/WRAP-UP-VERIFIER.md` in the plugin.

## If the project has no `STATE.md`

It hasn't adopted the protocol. Offer to create the three files in the standard shape
before doing anything else — `CONTEXT.md` (the WHAT), `STATE.md` (the progress tracker),
`PITFALLS.md` (the repeating traps), loaded with bare `@path` lines from the project's
`CLAUDE.md` (`@import path` loads nothing). The
plugin's `templates/` directory has skeletons for all of them.

If it has them in the **old shape** — a `Done ✅` log inside `STATE.md`, or a separate
dated history file — say so and offer to convert: lift settled decisions into `CONTEXT.md`,
rebuild `STATE.md` as a status tracker, drop the log. Don't keep feeding a changelog just
because one is already there.

## Report back in the chat

Close with, briefly:

- **Where to pick up** — repeat the `Do this first` line.
- **What moved** — statuses that changed, in one line.
- **What you trimmed** — lines out of each memory file; for a file at zero, why.
- **Sync state** — on shared projects: "dev is committed and pushed" or exactly what isn't
  and why.
- **What's waiting on them** — decisions only they can make.
- **Anything you left out and why.**
