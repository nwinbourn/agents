#!/usr/bin/env node
// Stop hook: after the `wrap-up` skill has run (armed by wrap-up-arm.mjs's
// PostToolUse hook), checks STATE.md for the three ways a handoff goes bad:
//   1. bloat — the file grew past the point where it stays legible
//   2. no usable "Start here" block — missing fields, placeholders, or a first
//      step that names nothing concrete
//   3. changelog creep — dated entries, "we added/fixed" narration, log sections,
//      or facts duplicated word-for-word from CONTEXT.md
// Staleness is state-reminder.mjs's job on every Stop, independent of wrap-up.
//
// Fires only once per wrap-up invocation: the marker is consumed (deleted) the
// moment it's read, whether or not anything is found, and stale markers older
// than MAX_MARKER_AGE_MS are ignored (still consumed) rather than firing late
// against an unrelated Stop event.
//
// Safe globally: no STATE.md, no marker, or git unavailable all degrade to a
// silent exit — this does nothing in general chats or projects that haven't
// adopted the protocol, same as state-reminder.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { resolveProject, findMemoryFile } from './lib/project-inspection.mjs';
import { checkHandoff } from './lib/wrap-up-verifier.mjs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}
if (!data || typeof data !== 'object' || Array.isArray(data) ||
    (data.cwd != null && typeof data.cwd !== 'string')) process.exit(0);

// Already reminded this stop cycle — let Claude stop.
if (data.stop_hook_active) process.exit(0);

const projectDir = resolveProject(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()).root;
const markerDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'hooks', '.wrapup-armed');
const key = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 16);
const markerPath = path.join(markerDir, `${key}.json`);

let marker;
try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { process.exit(0); } // not armed => wrap-up didn't just run here
try { fs.unlinkSync(markerPath); } catch {} // consume unconditionally — fires at most once per wrap-up call

const MAX_MARKER_AGE_MS = 30 * 60 * 1000; // 30 min — generous for a long wrap-up, short enough not to misfire on a much-later unrelated Stop
if (!marker || !marker.armedAt || Date.now() - marker.armedAt > MAX_MARKER_AGE_MS) process.exit(0);

// Find STATE.md (project root or docs/). No STATE.md => protocol not adopted => stay silent.
const statePath = findMemoryFile(projectDir, 'STATE');
if (!statePath) process.exit(0);

let stateText;
try { stateText = fs.readFileSync(statePath, 'utf8'); } catch { process.exit(0); }
const currentLines = stateText.split('\n').length;

const reasons = [];

// ---- 1. Bloat -------------------------------------------------------------
// Growth since the last commit, if this is a git repo with a prior committed
// version of the file. Unavailable (no git, uncommitted file, detached tree)
// just drops the growth check — the absolute ceiling below still applies.
let committedLines = null;
try {
  const relPath = path.relative(projectDir, statePath).split(path.sep).join('/');
  const out = execFileSync('git', ['show', `HEAD:${relPath}`], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  committedLines = out.split('\n').length;
} catch {}

const HARD_LINE_CEILING = 700; // nag regardless of history once STATE.md is this big on its own
const GROWTH_FLOOR = 500;      // below this absolute size, growth alone never nags — small/young projects are fine
const GROWTH_CEILING = 150;    // nag if it grew more than this many lines in one sitting, past the floor

const growth = committedLines != null ? currentLines - committedLines : null;
if (currentLines > HARD_LINE_CEILING || (growth != null && currentLines > GROWTH_FLOOR && growth > GROWTH_CEILING)) {
  const growthNote = growth != null ? `, +${growth} lines since the last commit` : '';
  reasons.push([
    `STATE.md just got a wrap-up update and is now ${currentLines} lines${growthNote} — past the point where this project's`,
    'progress tracker usually stays legible. That size is almost always changelog entries, resolved narrative, or detail',
    'duplicated with CONTEXT.md/PITFALLS.md creeping back in, not genuinely new open work.',
    'Before this turn ends, re-read STATE.md and compact it: for each paragraph, ask "would this still be true in three',
    'months if nobody did anything?" A settled fact graduates to CONTEXT.md; a trap that has bitten twice graduates to',
    'PITFALLS.md; dated narrative, resolved items, or anything already recorded elsewhere gets deleted outright — git',
    'already keeps that history. Keep every genuinely open item, and everything named in "Start here" needs a home in',
    'the body somewhere. The test: does the file still answer "what do we need to do?" correctly, in as few words as',
    'that requires? If you have already checked and there is nothing left to compact — every line is a live, undecided',
    'item — say so in one line and stop.',
  ].join(' '));
}

// ---- 2. The Start here block ---------------------------------------------
const handoff = checkHandoff(projectDir);
if (handoff.status !== 'passed') {
  reasons.push([
    `STATE.md's Start here block is not a usable handoff yet (${handoff.message}).`,
    'Before this session ends it needs exactly three lines: "Do this first" naming a file, route or command;',
    '"Waiting on you"; "Mid-flight" (or "nothing" for the last two).',
    'If wrap-up is still in progress and you have not reached that step, keep going and write it.',
  ].join(' '));
}

// ---- 3. Changelog creep ---------------------------------------------------
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

let contextText = '';
const contextPath = findMemoryFile(projectDir, 'CONTEXT');
if (contextPath) { try { contextText = fs.readFileSync(contextPath, 'utf8'); } catch {} }
const found = smells(stateText, contextText);
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
