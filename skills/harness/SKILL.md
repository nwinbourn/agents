---
name: harness
description: Autonomous agent manager — maintains a reusable background worker pool, routes each task to an appropriately priced model on its own, and only interrupts for unusually large parallel fan-outs. Invoke on "/harness", "/harness on", "/harness off", "/harness agents", "/harness status", "turn the harness on/off", or "agents mode".
argument-hint: "[on | off | agents | status]"
---

# /harness — autonomous agent manager

Three jobs, one interruption:

1. **Reuse agents.** New work goes to an existing suitable agent whenever possible —
   its context (codebase reads, prior results) is preserved, so nothing is re-read.
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
assignments. The **only** interruption is mechanical: a proposed parallel workload of
more than **3 fable, 15 opus, or 30 sonnet** agents becomes one permission prompt
before anything launches. Under those caps the harness is completely silent.

## The switch

The single word in `~/.claude/harness/mode` (create the `harness/` directory if
needed). Missing file or anything unrecognized = off.

| Command | Write to the mode file | Meaning |
|---|---|---|
| `/harness on` | `on` | Autonomous background delegation is enabled. |
| `/harness off` | `off` | No new delegation; work already in flight finishes. |
| `/harness agents` | `agents` | Interactive orchestration: the user chats, plans, reviews, and audits with the main agent while workers do the implementation and research in the background. |
| `/harness status` (or bare `/harness`) | — | Report the current mode, what it means, and the caps. |

After writing the mode file, confirm in one line and note it takes effect from the
next message (the per-turn hook reads the file when a message is submitted).

## Conduct while on (both modes)

- **Reuse before boot.** `ListAgents` is the truth about which workers exist;
  `SendMessage` continues one with its context intact — even after it finished.
- **Route silently.** Set `model` on every dispatch yourself. If a plan or workflow
  script arrives with routing missing or obviously wrong (a top-tier model on a
  mechanical task), fix it — don't narrate it, don't ask.
- **Fan-outs default to sonnet.** Upgrade an individual task only for genuine
  difficulty; downgrade mechanical ones to haiku/Explore.
- **Complete work orders.** Workers can't see the conversation. Every order carries:
  objective, inputs, expected output shape, done-when, and how it gets verified.
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

## Enforcement (hooks, not promises)

Two PreToolUse hooks enforce the caps mechanically; they say nothing under the caps
and never deny or allow on their own:

- **Per-dispatch** (`Task`/`Agent`): each worker's tier joins a rolling burst counter
  (default window 120s). A dispatch that takes a tier past its cap asks first.
- **Per-workflow** (`Workflow`): the script's `agent()` sites are read as text and
  counted as one parallel fan-out. Sites with no `model` count as the session's own
  model — that is what they would actually run as, and it is how an unannotated script
  on a top-tier session gets caught before launching a whole fleet of it.

Tuning is optional, via `~/.claude/harness.json`:

```json
{ "caps": { "fable": 3, "opus": 15, "sonnet": 30 }, "capWindowSeconds": 120 }
```
