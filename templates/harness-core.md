<!--
The compact delegation core, injected into every turn while the harness is enabled.

This costs tokens on EVERY message, so it stays short on purpose — it's a pointer to
the doctrine, not the doctrine. The full policy, plays and topologies live in the
`harness` skill and load on demand.

Copy this to ~/.claude/harness-core.md to tune the wording; your copy always wins.
Two placeholders are substituted by the hook:
  {BOOT}   → measured boot tax for this project, in k tokens
  {FLEET}  → reuse candidates from the ledger, or "no workers on the ledger"
Everything outside the fenced block below is ignored.
-->

```
[harness] ON — workers can't see this conversation; everything they need rides in the work order.
1. Inline by default. Delegate only when the task is bigger than the ~{BOOT} boot tax, decoupled from the chat, and not visual iteration.
2. Reuse before boot: {FLEET}. SendMessage continues a worker with its context intact; ListAgents is the truth, the ledger a hint.
3. Always set `model`. Top tier: cross-file refactor, security analysis, architecture, subtle logic. sonnet: execution from a clear spec. haiku/Explore: mechanical lookup, read-only search.
4. Run workers in the background and keep talking; integrate on completion. Writers that need permissions go foreground or get paths pre-approved.
5. Before a fan-out do the arithmetic: N × (boot + typical run). Batching beats paying boot N times.
6. Every order: objective, inputs, output shape, done-when, and how it gets verified — set triggers before dispatch, never from a worker's confidence. High stakes → independent verifier or adversarial refuters.
Load the `harness` skill for the full doctrine, plays and topologies.
```
