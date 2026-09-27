#!/usr/bin/env node
// Stop hook: after the `wrap-up` skill has run (armed by wrap-up-arm.mjs's PostToolUse
// hook), checks the memory files for the ways a handoff goes bad:
//   1. no usable "Start here" block, or a block that holds more than its three fields
//   2. a file over its guidance size that wrap-up left no shorter than it found it
//   3. PITFALLS entries without the Trap / Tell / Fix shape, or running long
//   4. changelog creep in STATE.md: dated entries, "we added/fixed" narration, log
//      sections, or facts duplicated word-for-word from CONTEXT.md
// None of these is a size cap. Each stops the agent once with the facts; the agent
// then fixes the file or says in one line why not. Staleness is state-reminder.mjs's
// job on every Stop, independent of wrap-up.
//
// Fires only once per wrap-up invocation: the marker is consumed (deleted) the moment
// it's read, whether or not anything is found, and stale markers older than
// MAX_MARKER_AGE_MS are ignored (still consumed) rather than firing late against an
// unrelated Stop event.
//
// Safe globally: no STATE.md, no marker, or git unavailable all degrade to a silent
// exit — this does nothing in general chats or projects that haven't adopted the
// protocol, same as state-reminder.mjs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mainProjectRoot, findMemoryFile } from './lib/project-inspection.mjs';
import { checkHandoff } from './lib/wrap-up-verifier.mjs';
import { GUIDANCE, START_HERE_LINES, PITFALL_ENTRY_LINES, MEMORY_FILES, countLines, pitfallShape } from './lib/memory-hygiene.mjs';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}
if (!data || typeof data !== 'object' || Array.isArray(data) ||
    (data.cwd != null && typeof data.cwd !== 'string')) process.exit(0);

// Already reminded this stop cycle — let Claude stop.
if (data.stop_hook_active) process.exit(0);

const projectDir = mainProjectRoot(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const markerDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'hooks', '.wrapup-armed');
const key = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 16);
const markerPath = path.join(markerDir, `${key}.json`);

let marker;
try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { process.exit(0); } // not armed => wrap-up didn't just run here
try { fs.unlinkSync(markerPath); } catch {} // consume unconditionally — fires at most once per wrap-up call

const MAX_MARKER_AGE_MS = 30 * 60 * 1000; // generous for a long wrap-up, short enough not to misfire on a much-later unrelated Stop
if (!marker || !marker.armedAt || Date.now() - marker.armedAt > MAX_MARKER_AGE_MS) process.exit(0);

// No STATE.md => protocol not adopted => stay silent.
if (!findMemoryFile(projectDir, 'STATE')) process.exit(0);
const texts = {};
for (const name of MEMORY_FILES) {
  const file = findMemoryFile(projectDir, name);
  if (!file) continue;
  try { texts[name] = fs.readFileSync(file, 'utf8'); } catch {}
}
if (texts.STATE == null) process.exit(0);

const reasons = [];

// ---- 1. The Start here block ---------------------------------------------
const handoff = checkHandoff(projectDir);
if (handoff.status !== 'passed') {
  reasons.push([
    `STATE.md's Start here block is not a usable handoff yet (${handoff.message}).`,
    'Before this session ends it needs the three fields: "Do this first" naming a file, route or command;',
    '"Waiting on you"; "Mid-flight" (or "nothing" for the last two).',
    'If wrap-up is still in progress and you have not reached that step, keep going and write it.',
  ].join(' '));
} else {
  const notes = [];
  if (handoff.extraLines > 0) notes.push(`holds ${handoff.extraLines} line${handoff.extraLines === 1 ? '' : 's'} beyond the three fields (banners, code or notes)`);
  if (handoff.lines > START_HERE_LINES) notes.push(`runs ${handoff.lines} lines against a guidance of ${START_HERE_LINES}`);
  if (notes.length) {
    reasons.push([
      `STATE.md's Start here block ${notes.join(' and ')}. The block is the three fields and nothing else:`,
      'move standing warnings to CONTEXT.md, traps to PITFALLS.md and tasks into the body of STATE.md.',
      'If the fields genuinely need this much, say why in one line and stop.',
    ].join(' '));
  }
}

// ---- 2. Trim: a file over guidance must leave wrap-up shorter than it entered --------
const before = marker.sizes && typeof marker.sizes === 'object' ? marker.sizes : {};
const stuck = [];
for (const name of MEMORY_FILES) {
  if (texts[name] == null) continue;
  const now = countLines(texts[name]);
  const start = Number.isFinite(before[name]) ? before[name] : null;
  if (now <= GUIDANCE[name] || (start != null && now < start)) continue;
  stuck.push(`${name}.md is ${now} lines against a guidance of ${GUIDANCE[name]}` +
    (start != null ? ` and did not get shorter during this wrap-up (${start} when it started)` : ''));
}
if (stuck.length) {
  reasons.push([
    `${stuck.join('; ')}.`,
    "Every wrap-up trims: cut what the skill's trim pass names (settled decisions, detail the code already says,",
    'resolved items, traps that no longer bite) before this session ends, or say in one line why the size is',
    'needed and stop. This is not a cap; it is the trim pass being checked.',
  ].join(' '));
}

// ---- 3. PITFALLS entries: a heading, then Trap, Tell, Fix ------------------------
if (texts.PITFALLS != null) {
  const shape = pitfallShape(texts.PITFALLS);
  if (shape.off.length) {
    reasons.push([
      `PITFALLS.md: ${shape.off.length} of ${shape.entries} entries are missing the Trap / Tell / Fix labels or run past`,
      `${PITFALL_ENTRY_LINES} lines (first: "${shape.off[0].heading}"). Each entry is a heading plus **Trap:**, **Tell:** and`,
      '**Fix:**, nothing else; rewrite those, or drop the ones that no longer bite.',
    ].join(' '));
  }
}

// ---- 4. Changelog creep ---------------------------------------------------
function smells(state, context) {
  const found = [];
  const blank = m => m.replace(/[^\n]/g, ''); // drop comments but keep line numbers
  const lines = state.replace(/<!--[\s\S]*?-->/g, blank).split(/\r?\n/);
  const norm = s => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const inContext = new Set(context.replace(/<!--[\s\S]*?-->/g, blank).split(/\r?\n/).map(norm)
    .filter(l => l.length >= 40 && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('```')));
  let fence = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('```')) { fence = !fence; return; }
    if (fence || !t || t.startsWith('|')) return;
    const n = i + 1;
    if (/^[-*]?\s*\(?(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})\b/i.test(t)) found.push(`line ${n}: dated entry`);
    else if (/\b(?:we|i)\s+(?:added|fixed|changed|removed|implemented|updated|refactored|shipped|did|built|completed)\b/i.test(t)) found.push(`line ${n}: "what happened" narration`);
    else if (/^#{1,6}\s*(?:done|completed|changelog|history|what (?:we|i) did)\b/i.test(t)) found.push(`line ${n}: a log section`);
    else if (norm(t).length >= 40 && !t.startsWith('#') && inContext.has(norm(t))) found.push(`line ${n}: duplicated in CONTEXT.md`);
  });
  return found;
}

const found = smells(texts.STATE, texts.CONTEXT ?? '');
if (found.length) {
  const shown = found.slice(0, 6).join('; ') + (found.length > 6 ? `; and ${found.length - 6} more` : '');
  reasons.push([
    `STATE.md has lines that read as a changelog or duplicate CONTEXT.md — ${shown}.`,
    'STATE.md records where things stand, not what happened: rewrite each as a current status or delete it (git keeps',
    'the history), and keep each fact in one file. If a flagged line is genuinely a live status, say so in one line and stop.',
  ].join(' '));
}

if (!reasons.length) process.exit(0);

process.stdout.write(JSON.stringify({ decision: 'block', reason: reasons.join('\n\n') }));
process.exit(0);
