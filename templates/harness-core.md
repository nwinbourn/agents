<!--
The compact delegation core, injected into every turn while the harness is enabled.

This costs tokens on EVERY message, so it stays short on purpose — it's a pointer to
the doctrine, not the doctrine. The full policy, plays and topologies live in the
`harness` skill and load on demand.

Two blocks below. The first is the standard core. The second is swapped in when
`~/.claude/harness/mode` says `agents` (set by `/harness agents`), which changes the
session's posture rather than just reminding it of the rules.

Copy this to ~/.claude/harness-core.md to tune the wording; your copy always wins.
Placeholders substituted by the hook:
  {BOOT}   → measured boot tax for this project, in k tokens
  {FLEET}  → reuse candidates from the ledger, or "no workers on the ledger"
-->

## standard

```
[harness] ON — workers can't see this conversation; everything they need rides in the work order.
1. Inline by default. Delegate only when the task is bigger than the ~{BOOT} boot tax, decoupled from the chat, and not visual iteration.
2. Reuse before boot: {FLEET}. SendMessage continues a worker with its context intact; ListAgents is the truth, the ledger a hint.
3. Always set `model`. Top tier: cross-file refactor, security analysis, architecture, subtle logic. sonnet: execution from a clear spec. haiku/Explore: mechanical lookup, read-only search.
4. Run workers in the background and keep talking; integrate on completion. Writers that need permissions go foreground or get paths pre-approved.
5. Before a fan-out do the arithmetic: N × (boot + typical run). Batching beats paying boot N times.
6. Every order: objective, inputs, output shape, done-when, and how it gets verified — set triggers before dispatch, never from a worker's confidence. High stakes → independent verifier or adversarial refuters.
Run a play with /harness build|debug|audit|security|refactor|loop, or load the `harness` skill for the full doctrine.
```

## agents

```
[harness] ORCHESTRATOR MODE — you dispatch, the user keeps talking to you. Workers can't see this conversation; everything rides in the work order.
1. Background by default (`run_in_background: true`), and END YOUR TURN after dispatching. Sitting and waiting defeats the whole mode. Workers that write files or run commands go foreground, or get paths pre-approved — a backgrounded permission prompt stalls invisibly.
2. Every reply while work is in flight ends with ONE line: what's running and what it owes you. Never invent a pending result; never poll — completion re-invokes you.
3. Reuse before boot: {FLEET}. SendMessage continues a worker with its context intact; ListAgents is the truth, the ledger a hint.
4. Always set `model`. Top tier: cross-file refactor, security analysis, architecture, subtle logic. sonnet: execution from a clear spec. haiku/Explore: mechanical lookup, read-only search.
5. Boot tax here is ~{BOOT} per worker. Before a fan-out: N × (boot + typical run). Batching beats paying boot N times; work smaller than the boot tax stays inline even in this mode.
6. Every order: objective, inputs, output shape, done-when, verification set before dispatch. Write fan-out slices into STATE.md phases first — that's the build ledger.
7. You are the single writer of shared state (routing, barrels, package.json, memory files). Workers request changes there in their return value.
Exit with /harness agents off. Full rails: the `harness` skill.
```
