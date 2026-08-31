#!/usr/bin/env node
// UserPromptSubmit hook: catches the start of a rework loop.
//
// This is the only automatic part of occam, and it only ever injects a short
// paragraph of advice — it never blocks, and the model is free to ignore it.
// An earlier Stop hook that ran analyzers and blocked turn completion was
// removed for exactly that reason; the reasoning is in NOTES.md.
//
// Why this one earns its place: an audit of 65 real sessions (1,383 prompts)
// counted 59 rework loops, 35 context bleeds and 35 misunderstandings. A
// rework loop means the wrong thing got built and then built again — the whole
// task paid for twice. Writing tighter code saves a fraction of one task; not
// building the wrong task saves all of it.
//
// Mechanism: fires only when the incoming prompt reads as a correction — the
// moment a rework is starting, before any tokens go into the second attempt.
// It does NOT nag on ordinary build requests; a reminder on every turn is
// noise, and noise gets hooks switched off.
//
// Fails silent by design: unreadable input or no match exits 0 quietly.

import fs from 'node:fs';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

const prompt = typeof data.prompt === 'string' ? data.prompt : '';
if (!prompt.trim()) process.exit(0);

// Regex literals, not strings joined into one pattern. The string form needed
// doubled backslashes, and one pass through a shell heredoc silently turned
// every \\b into a backspace escape — the patterns still compiled and the hook
// still exited 0, so it looked healthy while matching almost nothing. Literals
// make that class of bug impossible.
//
// Anchored phrases, not loose words, and narrowed after a false-positive pass.
// Each pattern has to be something a person says when a previous answer missed —
// not something they say while asking for the work in the first place.
//
// Deliberately NOT included, and why:
//   "from scratch" / "start over" / "redo"  — usually the user ASKING for a
//       rebuild. Firing would inject "don't rebuild" over an explicit
//       instruction to rebuild, which is worse than staying quiet.
//   bare "why did you" / "why would you"    — ordinary architecture questions
//       ("why did you choose SQLite?"). Only the negative forms survive.
//   bare "i wanted"                         — "I wanted to add a sidebar" is a
//       feature request. It survives only inside "not what i wanted".
//   bare "undo" / "revert"                  — "add an undo button", "a revert
//       action". Both now require an object.
const CORRECTION = [
  /that'?s not (what|it|right|quite)/i,
  /not what i (asked|wanted|meant|said)/i,
  /\bi (said|asked for)\b/i,
  /\byou (missed|ignored|forgot|misunderstood)\b/i,
  /did ?n[o']?t ask/i,
  /\bwhy did you (not|remove|delete|change|rewrite|undo|ignore)\b/i,
  /\bundo (that|this|it|your|the last)\b/i,
  /\brevert (that|this|it|your|the last)\b/i,
  /\bagain,? but\b/i,
  /\bnot like (that|this)\b/i,
  /\bwrong (approach|direction|thing|file|one|place)\b/i,
  /\bthat broke\b/i,
  /\byou (just )?broke\b/i,
  /\bstill (not|does ?n[o']?t|wrong|broken)\b/i,
  // "no, use X" is a correction; "no, that's fine" is agreement.
  /\bno,? (?!that'?s (fine|good|right|ok|correct|fair))(i|that|it|the|use|do|make|put|go)\b/i,
];

if (!CORRECTION.some((re) => re.test(prompt))) process.exit(0);

const context = [
  'OCCAM — this prompt reads as a correction, which is where rework loops start.',
  'Before writing anything: state in one or two lines what you now understand the target to be,',
  'and what specifically you are changing versus keeping. Name the smallest edit that gets there.',
  'Unless a rebuild is what was explicitly asked for, do not rebuild from scratch, do not "improve"',
  'adjacent things, and do not assume the fix is the opposite of what you just did. If the correction',
  'is ambiguous, ask one tight question instead of guessing — a wrong second attempt costs more',
  'than the question. This is advice, not a rule; use judgement.',
].join(' ');

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  })
);
process.exit(0);
