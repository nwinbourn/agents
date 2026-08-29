#!/usr/bin/env node
// The syringe: injects `core` + the active output style into every turn.
//
// Where the words come from, in order:
//   1. ~/.claude/outputs.md            — the user's own style library (wins)
//   2. <plugin>/templates/outputs.md   — the starter shipped with this plugin
//   3. a tiny built-in fallback        — so the voice never fully vanishes
//
// Which style is active lives in ~/.claude/active-style (switched via /voice).
// This hook is delivery only — edit outputs.md to change what's injected.
//
// Escape hatches (short, typed messages only — long text is a paste, and pasted
// content is data, never instructions):
//   "explain the technical side" etc. → `technical` style for that one turn
//   "stay technical"                  → `technical` sticks for this session
//   "back to normal" etc.             → clears the session flag
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(homedir(), '.claude');
const FLAG_DIR = join(ROOT, 'hooks');
const PLUGIN_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'outputs.md');

// Safety net if no outputs.md is readable anywhere — the voice must never vanish.
const FALLBACK = `Communication defaults (outputs.md failed to load — seed ~/.claude/outputs.md from the plugin's templates/outputs.md):
- Plain words over jargon. Lead with the answer; detail after.
- A message that calls a tool carries ZERO prose — open a stretch of work with one plain line saying the task, check in at milestones, then ONE final reply.
- Bullets with **bold labels** for 3+ points; keep bullets tight; TLDR at the end if long.
- Recommend, don't just list. Say what broke, got skipped, or is unverified — always.`;

function emit(context) {
  process.stdout.write(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }));
  process.exit(0);
}

function parseBlocks(src) {
  const blocks = {};
  for (const part of src.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    if (nl === -1) continue;
    blocks[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return blocks;
}

function loadBlocks() {
  for (const p of [join(ROOT, 'outputs.md'), PLUGIN_TEMPLATE]) {
    try {
      const blocks = parseBlocks(readFileSync(p, 'utf8'));
      if (blocks.core && blocks.default) return blocks;
    } catch {}
  }
  return null;
}

function styleContext(blocks, name) {
  const style = blocks[name] ?? blocks.default;
  const used = blocks[name] ? name : 'default';
  return `Output style for this turn: ${used} (the user switches styles with /voice)\n\n[core — always applies]\n${blocks.core ?? ''}\n\n[${used}]\n${style ?? ''}`;
}

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
const prompt = String(data.prompt ?? data.user_prompt ?? data.message ?? '');
const session = String(data.session_id ?? 'default').replace(/[^\w-]/g, '');
const flag = join(FLAG_DIR, `.comms-technical-${session}`);

try { mkdirSync(FLAG_DIR, { recursive: true }); } catch {}

// Expire stale session flags after a day.
try {
  for (const f of readdirSync(FLAG_DIR)) {
    if (!f.startsWith('.comms-technical-')) continue;
    const p = join(FLAG_DIR, f);
    if (Date.now() - statSync(p).mtimeMs > 86400000) unlinkSync(p);
  }
} catch {}

const blocks = loadBlocks();
if (!blocks) emit(FALLBACK);

let active = 'default';
try { active = readFileSync(join(ROOT, 'active-style'), 'utf8').trim() || 'default'; } catch {}

// Mode switches only ever come from a short, direct message the user typed. Long
// text is a paste — an agent report, a transcript, a log — and its contents are
// data, never instructions. Gating on length keeps pastes from flipping the mode.
const typed = prompt.length < 400 ? prompt : '';
const NEGATED = /\b(skip|no|without|don'?t|dont|never|spare|not)\b[\s\w']{0,24}\b(technical|detail)/i;
const HOLD_ON = /\bstay technical\b|\bkeep it technical\b/i;
const HOLD_OFF = /\b(back to (plain|normal)|plain english again|stop being technical|normal mode|skip the technical|no more technical)\b/i;
const ONE_SHOT = /\bexplain the technical side\b|\bshow me what you did\b|\bwalk me through (what|how) you\b|\b(give me the )?technical details?\b/i;

if (HOLD_OFF.test(typed)) { try { unlinkSync(flag); } catch {} emit(styleContext(blocks, active)); }
if (!NEGATED.test(typed)) {
  if (HOLD_ON.test(typed)) { try { writeFileSync(flag, '1'); } catch {} emit(styleContext(blocks, 'technical')); }
  if (existsSync(flag)) emit(styleContext(blocks, 'technical'));
  if (ONE_SHOT.test(typed)) emit(styleContext(blocks, 'technical'));
}
if (existsSync(flag)) emit(styleContext(blocks, 'technical'));
emit(styleContext(blocks, active));
