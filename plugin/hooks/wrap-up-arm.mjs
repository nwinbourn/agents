#!/usr/bin/env node
// PostToolUse hook (matcher: "Skill"): arms a marker when the personal `wrap-up`
// skill is invoked, so the Stop hook (wrap-up-bloat-check.mjs) knows to check
// STATE.md for bloat once wrap-up's own edits land later in the same turn.
//
// Companion to state-reminder.mjs, which checks STATE.md for STALENESS on every
// Stop. This checks for DRIFT/LENGTH, but only right after wrap-up specifically
// ran — so it stays silent on ordinary turns instead of nagging constantly.
//
// Writes nothing but a small marker file. Never blocks, never errors visibly:
// any failure here should be invisible, not a hook error in the transcript.

import fs from 'node:fs';
import path from 'node:path';
import { mainProjectRoot, findMemoryFile } from './lib/project-inspection.mjs';
import { MEMORY_FILES, countLines } from './lib/memory-hygiene.mjs';
import crypto from 'node:crypto';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}
if (!data || typeof data !== 'object' || Array.isArray(data) ||
    (data.cwd != null && typeof data.cwd !== 'string')) process.exit(0);

if (data.tool_name !== 'Skill') process.exit(0);
const skillName = String(data.tool_input?.skill ?? '');
if (!/(^|:)wrap-up$/.test(skillName)) process.exit(0); // matches 'wrap-up' and plugin-namespaced 'agents:wrap-up'

// Keyed to the project folder, so a branch session armed in its own folder is still
// checked after wrap-up merges it back and returns to the project folder.
const projectDir = mainProjectRoot(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const markerDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'hooks', '.wrapup-armed');
const key = crypto.createHash('sha1').update(projectDir).digest('hex').slice(0, 16);
const markerPath = path.join(markerDir, `${key}.json`);

// Sizes at the moment wrap-up starts, so the Stop hook can tell whether the trim pass ran.
const sizes = {};
for (const name of MEMORY_FILES) {
  const file = findMemoryFile(projectDir, name);
  if (!file) continue;
  try { sizes[name] = countLines(fs.readFileSync(file, 'utf8')); } catch {}
}

try {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ projectDir, armedAt: Date.now(), sizes }));
} catch {}

process.exit(0);
