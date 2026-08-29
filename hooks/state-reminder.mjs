#!/usr/bin/env node
// Stop hook: enforces the per-project memory protocol.
// Fires when Claude finishes a turn. If the project has a STATE.md and project
// files have changed more recently than STATE.md was last updated, it blocks the
// stop once and tells Claude to update STATE.md. Self-silences after the update
// (STATE.md becomes newest) and never loops (stop_hook_active guard).
//
// Safe globally: if there is no STATE.md, it exits silently — so it does nothing
// in general chats, this workspace, or any project that hasn't adopted the protocol.

import fs from 'node:fs';
import path from 'node:path';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

// Already reminded this stop cycle — let Claude stop.
if (data.stop_hook_active) process.exit(0);

const projectDir = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Find STATE.md (project root or docs/). No STATE.md => protocol not adopted => stay silent.
const candidates = [
  path.join(projectDir, 'STATE.md'),
  path.join(projectDir, 'docs', 'STATE.md'),
];
const statePath = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!statePath) process.exit(0);

let stateMtime;
try { stateMtime = fs.statSync(statePath).mtimeMs; } catch { process.exit(0); }

// Directories not worth scanning.
const SKIP = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out',
  '.vercel', '.turbo', 'coverage', '.cache', '.claude', '.venv', '__pycache__',
]);

let stale = false;
function walk(dir) {
  if (stale) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (stale) return;
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (full === statePath) continue;
    let m;
    try { m = fs.statSync(full).mtimeMs; } catch { continue; }
    // >2s newer than STATE.md means real work happened since the last state update.
    if (m > stateMtime + 2000) { stale = true; return; }
  }
}
walk(projectDir);

if (!stale) process.exit(0); // STATE.md is current — nothing to do.

const reason = [
  'STATE.md is out of date: project files changed more recently than STATE.md was last updated.',
  'STATE.md is the progress tracker, NOT a changelog — do not add a dated "what happened" entry.',
  'Update where things STAND: change the status of whatever moved, refresh what is next, add',
  'anything newly discovered, delete what is no longer true. A settled decision graduates to',
  'CONTEXT.md; a repeating trap graduates to PITFALLS.md.',
  'The test: if the user asks "what do we need to do?" tomorrow, does STATE.md answer correctly?',
  'The /wrap-up skill runs this whole procedure end to end — prefer it over improvising the steps.',
  'If the changes genuinely do not warrant a state update, say so in one line and stop.',
].join(' ');

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
