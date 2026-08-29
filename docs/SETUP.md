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

That's the whole adoption. The hooks detect it from here: `origin/dev` existing turns
on the session-start sync, a `STATE.md` existing turns on the memory enforcement.
Repos without either stay untouched.

## Optional: the delegation harness

Off until you turn it on. Skip this if you don't use subagents much.

```
/harness on
```

That writes `~/.claude/harness.json` with defaults and starts the hooks: a compact
delegation core injected each turn, a cost estimate before each dispatch, and a tally of
what workers actually cost. Tune the two numbers that matter in that file:

- `askThresholdTokens` (400k) — a fan-out estimated above this turns into one permission
  prompt. Raise it if you're prompted too often; lower it if a big fleet has ever
  surprised you.
- `expensiveModels` / `cheapModels` — your top and standard tiers.

`/harness status` reports live workers, today's spend, reuse rate, and whether the mode is
paying for itself. `/harness off` stops all of it; the doctrine in the skill still works by
hand.

There's a shadow mode too: set `tallyWhenDisabled: true` with `enabled: false` to measure
what delegation costs you *before* turning the harness on, so the comparison is real.

## Daily rhythm

- **Open a session** → the sync hook has already pulled `dev` if it was safe; if
  anything needs a decision (dirty tree, diverged branch), Claude tells you before work
  starts. Ask "what's next?" — the answer comes from `STATE.md`.
- **Work** → normal. Claude keeps `STATE.md` honest as things move.
- **End the session** → say "wrap up." Memory gets updated and compacted, then `dev`
  is committed and pushed (you approve the push). Your collaborators' next session
  starts from what yours learned.

## Updating the plugin

New versions land via git — `/plugin` → manage → update, or reinstall from the
marketplace. Hook changes re-prompt for approval.
