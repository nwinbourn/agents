#!/usr/bin/env node
// Stop hook: after the personal `wrap-up` skill has run (armed by
// wrap-up-arm.mjs's PostToolUse hook), checks STATE.md for BLOAT — the
// changelog-drift failure mode, not staleness (state-reminder.mjs already
// covers staleness on every Stop, independent of wrap-up).
//
// Fires only once per wrap-up invocation: the marker is consumed (deleted) the
// moment it's read, whether or not bloat is found, and stale markers older than
// MAX_MARKER_AGE_MS are ignored (still consumed) rather than firing late against
// an unrelated Stop event.
//
// Safe globally: no STATE.md, no marker, or git unavailable all degrade to a
// silent exit — this does nothing in general chats or projects that haven't
// adopted the protocol, same as state-reminder.mjs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

// Already reminded this stop cycle — let Claude stop.
if (data.stop_hook_active) process.exit(0);

const projectDir = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const markerDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'hooks', '.wrapup-armed');
const key = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 16);
const markerPath = path.join(markerDir, `${key}.json`);

let marker;
try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { process.exit(0); } // not armed => wrap-up didn't just run here
try { fs.unlinkSync(markerPath); } catch {} // consume unconditionally — fires at most once per wrap-up call

const MAX_MARKER_AGE_MS = 30 * 60 * 1000; // 30 min — generous for a long wrap-up, short enough not to misfire on a much-later unrelated Stop
if (!marker.armedAt || Date.now() - marker.armedAt > MAX_MARKER_AGE_MS) process.exit(0);

// Find STATE.md (project root or docs/). No STATE.md => protocol not adopted => stay silent.
const candidates = [
  path.join(projectDir, 'STATE.md'),
  path.join(projectDir, 'docs', 'STATE.md'),
];
const statePath = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!statePath) process.exit(0);

let currentLines;
try { currentLines = fs.readFileSync(statePath, 'utf8').split('\n').length; } catch { process.exit(0); }

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
const bloated = currentLines > HARD_LINE_CEILING || (growth != null && currentLines > GROWTH_FLOOR && growth > GROWTH_CEILING);

if (!bloated) process.exit(0);

const growthNote = growth != null ? `, +${growth} lines since the last commit` : '';

const reason = [
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
].join(' ');

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
