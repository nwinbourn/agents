---
name: harness
description: Autonomous agent manager — maintains a reusable background worker pool, routes each task to an appropriately priced model on its own, and only interrupts for unusually large dispatch bursts. Invoke on "/harness", "/harness on", "/harness off", "/harness agents", "/harness status", "turn the harness on/off", or "agents mode".
argument-hint: "[on | off | agents | status]"
---

# /harness — autonomous agent manager

Three jobs, one interruption:

1. **Reuse agents.** New work goes to an existing suitable agent whenever possible —
   its useful context (codebase reads, prior results) is preserved. Check that it is still current.
   Spawn a new agent only when existing ones are unsuitable or occupied.
2. **Route models autonomously.** The harness judges task difficulty and picks the
   model itself: simple/mechanical → smaller cheap model; normal implementation or
   research → mid tier; hard architecture, debugging, or synthesis → larger model.
   Fan-outs default to the mid tier. The user never chooses models; missing or unsafe
   routing is corrected internally, silently.
3. **Work while the user chats.** Delegated agents run asynchronously; the main agent
   stays available for conversation, reports progress, and folds results in as they
   arrive — it never blocks a reply waiting on a worker.

The user controls whether the harness is active — never the individual model
assignments. The hooks ask only when their best-effort burst checks exceed a configured limit.
They do not measure active concurrency. Under the limits they remain silent.

## The switch

The single word in `~/.claude/harness/mode` (create the `harness/` directory if
needed). Missing file or anything unrecognized = off.

| Command | Write to the mode file | Meaning |
|---|---|---|
| `/harness on` | `on` | Autonomous background delegation is enabled. |
| `/harness off` | `off` | No new delegation; work already in flight finishes. |
| `/harness agents` | `agents` | Interactive orchestration: the user chats, plans, reviews, and audits with the main agent while workers do the implementation and research in the background. |
| `/harness status` (or bare `/harness`) | — | Run the status procedure below. |

After writing the mode file, confirm in one line and note it takes effect from the
next message (the per-turn hook reads the file when a message is submitted).

## Conduct while on (both modes)

- **Reuse before boot.** `ListAgents` is the truth about which workers exist;
  `SendMessage` continues one with its context intact — even after it finished.
  Reuse only when the subject, checkout and prior decisions still fit. Send changed
  requirements explicitly; start fresh when obsolete context would mislead the worker.
- **Delegate when useful.** In `on` mode, delegate bounded independent work when
  the main agent has useful work to do alongside it. Keep small edits and tightly
  dependent steps local. In `agents` mode, favor workers to keep the chat responsive,
  but do not split dependent work into competing workers.
- **Route silently.** Set `model` on every dispatch yourself. If a plan or workflow
  script arrives with routing missing or obviously wrong (a top-tier model on a
  mechanical task), fix it — don't narrate it, don't ask.
- **Fan-outs default to sonnet.** Upgrade an individual task only for genuine
  difficulty; downgrade mechanical ones to haiku/Explore.
- **Complete work orders.** Workers can't see the conversation. Every order carries:
  objective, inputs, allowed files, dependencies, expected output, acceptance criteria
  and verification. Default to one writer per file; other workers may review it.
  A worker needing broader ownership reports the conflict before editing outside its scope.
  Return changed files, verification results and unresolved issues.
- **Verify before done.** Track tasks in session state as queued → running → ready
  for review → verified, with blocked/failed as needed. A worker finishing means ready
  for review. The main agent inspects the result against the acceptance criteria,
  integrates it and runs relevant checks before marking verified.
  Keep worker IDs and transient task state out of project memory. At handoff, record
  only the durable work status and any unintegrated work. Revalidate results after
  user redirection; results based on superseded requirements are not ready to integrate.
- **Never add model questions.** The cap prompt is enforced by hooks, mechanically.
  It is the only model-related question the user ever gets.

## Additional conduct in `agents` mode

- Dispatch in the background and **end the turn** — the user's next reply must never
  wait on a worker.
- Keep the conversation moving: brainstorm, plan, analyze, review, audit. The user can
  change direction or add ideas while work is underway; fold redirections into the
  in-flight work.
- Integrate results as they land, with one short status line — never poll, never go
  quiet for a stretch because workers are busy.

## Status (only when requested)

Run `node "<plugin-root>/hooks/harness-status.mjs"`, resolving the plugin root from
this skill's location. Report mode, global scope, caps, current burst counts and
timestamped issues. Use the runtime worker list and session task state for running
or queued work; say unavailable if those cannot be observed. Never infer live workers
from burst counts. Historical issues do not establish that the hook is still broken.

The mode and counter remain global across projects and sessions. Status is read-only.
If a counter lock persists after all dispatch hooks have stopped, remove only the
empty `counts.json.lock` directory in the reported harness home before retrying.
Never clear a lock while an owner might still be running. A hook waits at most 1.5s
for the lock, then allows the dispatch silently and records a diagnostic.

## Best-effort burst checks

Two PreToolUse hooks check different estimates; they say nothing under the limits
and never deny or allow on their own:

- **Per-dispatch** (`Task`/`Agent`): each recognized dispatch attempt joins a fixed-window
  counter (default 120s from the first attempt). Denied attempts remain counted.
  A dispatch that takes a tier past its limit asks first. Counter updates are serialized.
- **Per-workflow** (`Workflow`): the script's `agent()` sites are read as text and
  counted separately from dispatch attempts. Missing models use the session model
  when recognizable. Loops, sequential execution, helper-built options and saved
  workflows prevent this from measuring runtime fan-out. Unknown sites are not counted.

Neither check tracks completion, enforces a cost budget, or guarantees concurrency.
Errors fail open and record a small local diagnostic without user-facing chatter.

Tuning is optional, via `~/.claude/harness.json`:

```json
{ "caps": { "fable": 3, "opus": 15, "sonnet": 30 }, "capWindowSeconds": 120 }
```
