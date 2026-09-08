#!/usr/bin/env node
// One hook owns ordering: sync first, then load memory from the resulting checkout.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProjectMemory } from './lib/project-memory.mjs';

try {
  const raw = readFileSync(0, 'utf8');
  const event = JSON.parse(raw || '{}');
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      (event.cwd != null && typeof event.cwd !== 'string') ||
      (event.source && !['startup', 'resume', 'clear'].includes(event.source))) process.exit(0);
  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const chunks = [];
  let syncFailed = false;
  try {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./git-sync.mjs', import.meta.url))], {
      cwd, input: JSON.stringify({ ...event, cwd }), encoding: 'utf8', timeout: 35000,
      maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.trim()) {
      const context = JSON.parse(output).hookSpecificOutput?.additionalContext;
      if (typeof context === 'string') chunks.push(context);
    }
  } catch { syncFailed = true; }
  const memory = loadProjectMemory(cwd);
  if (memory) {
    if (syncFailed) chunks.push('[git-sync] Startup sync did not complete; the checkout may be behind the remote. Inspect Git status before starting shared work.');
    chunks.push(memory);
  }
  if (chunks.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'SessionStart', additionalContext: chunks.join('\n\n'),
  } }));
} catch { /* Unexpected failures must not break a session. */ }
process.exit(0);
