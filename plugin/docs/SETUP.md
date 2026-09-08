# Setup — technical user

You're comfortable with a terminal and git. Ten minutes, three layers.

## 1. Install the plugin (the SYSTEM layer)

```
/plugin marketplace add nwinbourn/agents
/plugin install agents@agents
```

Approve the hooks when Claude Code asks — they're what enforce the memory protocol and
run the git sync. Restart the session after installing.

Already have your own hooks or skills with the same jobs (a state reminder, a wrap-up,
a style injector)? Disable your local copies — two copies of the same hook fire twice.

## 2. Personal layer (yours, never shared)

- **Git identity** — each machine commits as its actual human, even on a shared GitHub
  account:

  ```bash
  git config --global user.name "Your Name"
  git config --global user.email "you@example.com"
  ```

- **Output styles** — optional. The plugin's starter styles work out of the box. To tune
  them, copy `templates/outputs.md` (from the plugin install directory) to
  `~/.claude/outputs.md` and edit — your copy always wins. Switch styles with `/voice`.
- **Personal `~/.claude/CLAUDE.md`** — optional. Who you are, standing preferences for
  how Claude works with you. The plugin never writes here.

## 3. Per project (the PROJECT layer)

For each project that should carry memory:

1. Copy from the plugin's `templates/`: `AGENTS.md`, `CLAUDE.md` (the loader — fill in
   the project name), `CONTEXT.md`, `STATE.md`. Add `PITFALLS.md` / `DESIGN.md` when
   they earn their place.
2. Fill in `CONTEXT.md` (what the project is, the stack, where it deploys) and seed
   `STATE.md` with the current phases.
3. Commit them. Memory files are code — they travel with the repo.

That's it for most projects — **work on `main`**. Don't add a `dev` branch just to have
a working branch; it's overhead with nothing to show for it on a solo or pre-launch repo.

**Add `dev` only when the project is live** — real users, `main` auto-deploys, and more
than one person commits. Then the branch is doing a real job: keeping half-finished work
off production. Set it up yourself, deliberately:

```bash
git switch -c dev && git push -u origin dev
```

Then point deploys at `main` (Vercel and similar auto-deploy `main`; pushes to `dev` get
preview builds) and record where it deploys in `CONTEXT.md`. From that moment the
session-start sync and the wrap-up push activate on their own — they key off
`origin/dev` existing, and stay silent everywhere else.

Startup now runs sync and memory loading in order. It loads STATE, CONTEXT and
existing PITFALLS/DESIGN after the sync attempt, using the Git working-tree root
even from a subfolder. Missing required memory is explicit. See
[session memory](SESSION-MEMORY.md) for discovery rules and size limits.

That's the whole adoption. A recorded `origin/dev` enables sync. STATE or CONTEXT
enables startup memory loading; STATE enables the staleness reminder. Shared dev
projects also get notices when required memory is missing. Other projects stay silent.

## Optional: the agent harness

Off until you turn it on — no config file needed:

```
/harness on
```

From then on Claude manages delegation itself: it reuses existing background agents
instead of spawning fresh ones, routes each task to an appropriately priced model
(fan-outs default to Sonnet), and runs delegated work asynchronously. You never pick
models. The hooks ask only above their best-effort burst limits (3 fable / 15 opus /
30 sonnet by default). They count dispatch attempts or static workflow call sites,
not active workers. Loops, denied attempts and unrecognized models limit accuracy.

`/harness agents` is the chat-while-they-work mode — you keep talking, planning, and
reviewing with the main agent while workers handle implementation in the background.
`/harness off` stops new delegation (in-flight work finishes).

To change the caps, create `~/.claude/harness.json`:

```json
{ "caps": { "fable": 3, "opus": 15, "sonnet": 30 }, "capWindowSeconds": 120 }
```

Use `/harness status` to inspect the global mode, burst counts and timestamped
diagnostics. The mode and counter are shared across projects and sessions. Hooks
stay silent on errors; status is the explicit place to investigate them. Personal
`~/.claude/harness-core.md` overrides still win: incorporate the new ownership and
verification rules there if you maintain an override.

## Daily rhythm

- **Open a session** → startup has synced `dev` if safe and loaded current project memory; if
  anything needs a decision (dirty tree, diverged branch), Claude tells you before work
  starts. Ask "what's next?" — the answer comes from `STATE.md`.
- **Work** → normal. Claude keeps `STATE.md` honest as things move.
- **End the session** → say "wrap up." Memory gets updated and compacted, then `dev`
  is committed and pushed (you approve the push). Your collaborators' next session
  starts from what yours learned.

## Updating the plugin

New versions land via git — `/plugin` → manage → update, or reinstall from the
marketplace. Hook changes re-prompt for approval.
