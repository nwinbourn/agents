# Occam — rationale, evidence, and honest limits

Kept out of `SKILL.md` on purpose. That file loads whenever the skill fires; this one
only loads if someone opens it. The split keeps the per-firing cost to working content.

## What occam is, and what it is not

**It is an over-engineering brake.** It exists to stop the wrong thing, or too much of
the right thing, from getting built.

**It is not a token optimizer**, and no longer claims to be. Ranked by actual cost, the
real levers are: model choice (Opus vs Sonnet is roughly a 5x difference), then context
size per turn, then number of turns, then output length. A skill only touches the last
two — and it *adds* to the second. Framing occam as a token saver meant defending its
weakest claim with evidence it does not have.

Framed as an over-engineering brake it is judged on things you can actually see per
task: did it reuse what already existed, is there less code, is the thing built the size
of the thing asked for. No benchmark required.

Token efficiency is a **consequence**, not the pitch.

## Where the waste actually comes from

An operator audit of 65 sessions / 1,383 prompts counted **59 rework loops, 35 context
bleeds, 35 misunderstandings**. A rework loop pays for the same task twice — a 100%
overspend on that task. That is the big number, and it is why the correction hook exists
and why it is the only automatic piece.

The prompt-only predecessor measured roughly 54% fewer lines and 20% lower cost on
feature tasks. That number is **borrowed evidence** — it belongs to a different skill and
was never re-measured for this one. Treat it as a plausible direction, not a result.

## The ladder, and what it came from

Four patterns found unprompted across three real repos:

| What was skipped | Written instead | Already available |
|---|---|---|
| Platform primitive | ~900 lines of hand-built HTML-string templating | Plain JSX `.map()` |
| Installed dependency | A custom analytics/attribution system | An analytics library already installed and mounted |
| Installed dependency | A ~150-line regex Markdown parser | An existing library for exactly that |
| Standard library | A hand-rolled mean/variance/z-score loop | One stdlib call |

Those four are the whole argument for the check-first ordering in `SKILL.md`.

## The two things that got deleted, and why

### 1. The hand-written duplicate/unused-dependency checker

The first version detected duplication and unused dependencies itself, by text matching.
Two audits took it apart: bare-substring carve-outs matched "aria" inside **variant** and
"fix" inside **prefix**, so most realistic prompts were silently exempted; committing the
work silenced it entirely; a new file inside a new directory was invisible; and its first
test suite reported 11/11 while three tests were the same tautology.

The deeper problem: duplicate detection is solved. Hand-writing a worse version was
itself the exact mistake the ladder exists to prevent. Deleted.

### 2. The automatic analyzer Stop hook

Its replacement ran real tools (jscpd, knip, deptry) on turn end and returned
`decision: "block"` so the turn could not complete until the findings were addressed.
Deleted too, for two reasons:

**It was coercive.** Blocking turn completion forces the model to eat the findings. The
model needs judgement about whether a duplicate should be factored out; a gate removes
that judgement. Occam guides, it does not govern.

**It was the most expensive thing in the design.** Blocking does not cost the ~125 tokens
of the message — it buys an entire extra model turn of reasoning and edits. Highest cost,
lowest reliability, and it was the one part that could be flatly wrong.

There is no soft version available: a Stop hook has no context-injection channel, so it
either blocks or is silent. That is why the answer was deletion rather than softening.

The capability survives as `/occam check`, run on purpose. The difference that matters is
consent, not politeness: the old hook imposed findings on a turn nobody asked it to touch;
`/occam check` only runs when invoked, and once invoked it goes ahead and edits rather than
handing back a report to read. Tool output there is a lead to verify, not a verdict to obey.

## What the real-tool verification found before it was deleted

Run against a fixture with a genuine clone, a guards-only clone, a pre-existing clone in
untouched files, and a real unused dependency:

- **jscpd — the format guess was right.** The report shape, the backslash paths, and the
  relevance and guard filters all behaved as designed. It correctly caught new code
  duplicating existing code, which nobody had designed for.
- **knip — the adapter was wrong.** Its section matcher swallowed knip's "Unused files"
  block, which fires on anything not reachable from an entry point. Four irrelevant
  filenames filled the finding cap and the one real unused dependency was never reported.
  Signal dropped, noise promoted — the same "inert while reporting green" failure as the
  version before it.
- knip also flags jscpd itself as an unused devDependency, so installing the tools to run
  the check creates findings about the tools.

`/occam check` inherits the lesson: the tool notes in `CHECK.md` say which knip sections
are relevant and which are noise.

## A bug worth remembering

The narrowed correction patterns were first written as strings joined into one RegExp,
which needs doubled backslashes. One pass through a shell heredoc collapsed them, turning
every word-boundary escape into a backspace character. The patterns still compiled, the
hook still exited 0, and it silently matched almost nothing — 11 of 14 real corrections
went unnoticed while the false-positive tests all "passed" for the wrong reason.

Caught only because the validation asserted on prompts that *should* fire, not just ones
that shouldn't. Now written as regex literals, where the problem cannot occur.

That is the third silent failure in this component — substring carve-outs matching inside
unrelated words, a suite reporting 11/11 on tautologies, and now this. All three shared a
shape: the hook exits 0 and looks healthy while matching nothing. So the fix is not only
the literals; `hooks/occam-confirm.test.mjs` now guards the shape itself:

- It asserts on prompts that **must** fire, not just ones that must not. A suite checking
  only false positives passes perfectly against a hook that matches nothing.
- It reads the source and fails on any control character inside a pattern — the exact
  signature of a collapsed escape.

Verified by reintroducing the bug: with word boundaries swapped back to backspace
characters the suite fails 23 assertions and exits non-zero; restored, it passes 32.

```bash
node hooks/occam-confirm.test.mjs
```

## Installing

Only one hook remains. Add to a project's `.claude/settings.json`, or
`~/.claude/settings.json` for every project. It injects a short paragraph on turns that
read as a correction, and is silent otherwise. It never blocks.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/occam/hooks/occam-confirm.mjs\"", "timeout": 5 } ] }
    ]
  }
}
```

The skill itself installs by copying the folder into `~/.claude/skills/occam/`.

## Known limits, honestly

- **The ladder is unverifiable.** Nothing checks whether the look-before-building step
  actually happened. It is advice, and it says so.
- **The correction detector is phrase-based.** A correction worded off the list ("hmm, I
  meant the other one") will not fire. Narrowing it to kill false positives necessarily
  widened that gap; the trade was deliberate, since a wrong fire on an explicit rebuild
  request is worse than a missed catch.
- **`/occam check` has never been run on a real change.** The procedure is written; its
  output quality is unmeasured.
- **No benchmark for occam itself** on feature, correction, debugging or safety tasks.
  The evidence above is either observational or borrowed.
- **Nothing runs the tests automatically.** `node hooks/occam-confirm.test.mjs` is a
  manual step — no CI, no pre-commit wiring. It covers the correction hook only; the
  ladder and `/occam check` are prose and have nothing to run.
