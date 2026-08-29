# The work order

A worker boots blind. It cannot see this conversation, the user's last three corrections,
or why any of this matters. Everything it needs rides in the order — or the work comes
back subtly wrong, which is worse than coming back empty.

## Template

```markdown
## Work order — <short name>

**Objective:** <the outcome in one sentence — the what, never the how>

**Why it matters:** <what this plugs into. You cannot see the conversation this came
from; this is the context that stops literal-minded execution.>

**Inputs:** <exact paths, URLs, commands, prior artifacts. Name the files. "the config"
is a defect.>

**Standing rules:** Read <project>/AGENTS.md and PITFALLS.md and follow them. They
override this order where they conflict.

**Constraints:** <the files you own and must not stray from; branch or worktree;
foreground writes; no scroll- or animation-timing checks; anything explicitly out of
scope>

**Done when:** <objective and checkable — "npm test exits 0", "GET /health returns 200".
Never "looks right" or "is complete".>

**Return:** <exact shape — raw data, file:line references, a diff summary, a JSON block.
Not prose narration. Never paste file contents; give paths.>

**Verify before returning:** <the command you must run and pass — build / typecheck /
test. Report the actual output if it fails; do not fix-and-hide.>

**Budget:** <scope ceiling — "read at most these 6 files"; "if this needs more than ~N
edits, stop and report what you found instead of continuing">

**You are not the orchestrator.** Execute this order. Do not re-plan the surrounding
work or spawn further workers unless this order says to.
```

## Why each field exists

- **Objective** — one sentence. If it needs two, the task probably needs two workers.
- **Why it matters** — the field people skip, and the reason "self-contained" orders
  still produce literal-minded work. A worker that knows the purpose makes better calls
  at the twenty small forks you didn't anticipate.
- **Inputs** — exact paths. A worker that has to *find* the file burns boot tax hunting
  and may find the wrong one.
- **Standing rules** — project facts live in the project's own files, never hardcoded in
  a work order. Pointing at `AGENTS.md` keeps every worker current for free.
- **Constraints** — file ownership is what makes parallel writers safe. State it even
  when it seems obvious.
- **Done when** — objective, or the worker decides for itself when it's finished, and it
  will decide generously.
- **Return** — the context-economics lever. "Raw data and paths, never dumps" is most of
  why delegation pays.
- **Verify before returning** — moves checking into the worker's cheap context instead of
  the orchestrator's expensive one.
- **Budget** — the missing stopping rule. A worker with no ceiling doesn't stop, it
  explores; runaway workers are the single biggest source of surprise cost.
- **You are not the orchestrator** — prevents recursive delegation. Workers can dispatch,
  and a worker that reads harness context may decide to.

## A bad order and a good one

**Bad:**

> Fix the auth bug we talked about and make sure it's solid.

Every failure at once: no repro, no files, "we talked about" is invisible, "solid" is not
checkable, no return shape, no budget. The worker will read a lot of code and return
prose.

**Good:**

```markdown
## Work order — fix session refresh 401

**Objective:** Stop `/api/me` returning 401 for users whose access token expired but
whose refresh token is still valid.

**Why it matters:** Users are silently logged out after 15 minutes. This is the last
blocker on the beta; the fix ships today.

**Inputs:** `src/server/auth/session.ts`, `src/server/middleware/requireUser.ts`,
failing test `tests/auth/refresh.test.ts` (currently red).

**Standing rules:** Read AGENTS.md and PITFALLS.md and follow them.

**Constraints:** Only those two source files. Do not touch the token schema or
`src/server/auth/jwt.ts` — other work is in flight there.

**Done when:** `npx vitest tests/auth/refresh.test.ts` exits 0 and no other test regresses.

**Return:** a unified diff summary (file + hunk headers only), the root cause in two
sentences, and the exact test output.

**Verify before returning:** `npx vitest run` — paste the failure verbatim if it's red.

**Budget:** if the fix needs changes outside those two files, stop and report why.

**You are not the orchestrator.** Execute this order; don't spawn workers.
```

## Orders for fan-outs

When N workers share one template, vary only the assignment and keep everything else
identical — divergent boilerplate produces divergent output shapes and a painful merge.

Add two fields:

- **Your slice:** the one hypothesis, module, surface, or file set this worker owns.
- **Do not touch:** the slices belonging to the others, named explicitly.

And give every worker the *same* return schema. Merging twelve differently-shaped
returns costs more than the fan-out saved.
