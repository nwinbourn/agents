---
name: voice
description: Show or switch the active output style (default / technical / learning / terse), or turn styling off entirely. Invoke on "/voice", "/voice <style>", "/voice off", or when the user asks to change how Claude talks — "switch to terse", "go into learning mode", "turn the voice off", "what style is on?".
argument-hint: "[default | technical | learning | terse | off]"
---

# /voice — output style switcher

The styles live in `~/.claude/outputs.md` (one `## name` block each; `core` is not a style —
it always applies). If that file doesn't exist, the plugin's `templates/outputs.md` serves as
the fallback library. The active style is the single word in `~/.claude/active-style`. The
plugin's `comms-style` hook injects core + the active block every turn.

`off` is a reserved pointer word, not a style — see below.

## No argument → status

1. Read `~/.claude/active-style` (trimmed word; treat missing/unreadable as `default`).
2. Read `~/.claude/outputs.md` — or the plugin's `templates/outputs.md` if the user has no
   copy — and list its `##` block names, excluding `core`.
3. Reply in one or two lines: the current style, then the available ones plus `off`. If the
   pointer already says `off`, say styling is off and list what's there to turn back on.

## With an argument (e.g. `/voice terse`) → switch

1. Validate: the argument must exactly match a `##` block in the styles file (not `core`),
   or be the reserved word `off`.
   - No match → say so, list the valid names, change nothing.
2. Overwrite `~/.claude/active-style` with just that name and a trailing newline.
3. Confirm in one line, and note it kicks in from the next message (the hook reads the
   pointer when a message is submitted).

## `off` — the reserved word

`off` is never a `##` block. With it in the pointer the hook injects one short override
instead of core + a style: ignore the "How I talk to Noah" section of `~/.claude/CLAUDE.md`
and write in Claude's own default voice.

That section is a hand-synced mirror of the style library, kept as a safety net for when the
hook fails. `off` cancels it for the turn rather than deleting it — **the net stays**. Every
other section of CLAUDE.md keeps applying in full.

The `stay technical` / `explain the technical side` escape hatches still beat `off` — they're
an explicit in-the-moment ask. `back to normal` returns to `off`.

Never add an `## off` block to a styles file; the pointer word would shadow it.

## First run — no personal outputs.md

If `~/.claude/outputs.md` doesn't exist, offer once to copy the plugin's
`templates/outputs.md` there so the user has their own tunable copy. Their copy always
wins over the plugin's. Don't push it — the plugin fallback works fine untouched.

## Rules

- The pointer is global — every session picks it up. Don't scope it per-project.
- Never rewrite style wording from this skill; wording changes are their own conversation
  with the user (and belong in the user's personal copy, not the plugin template).
- "stay technical" / "back to normal" session overrides are handled by the hook itself, not
  this skill — don't touch its flag files.
