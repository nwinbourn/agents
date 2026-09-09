#!/usr/bin/env node
// One hook owns ordering: sync first, then check the previous handoff against the
// resulting checkout, then load memory from it.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProjectMemory } from './lib/project-memory.mjs';
import { inspectProject } from './lib/project-inspection.mjs';
import { verifyWrapUp } from './lib/wrap-up-verifier.mjs';

const HANDOFF_ISSUES = {
  branch: 'not on the working branch',
  conflicts: 'unresolved merge conflicts',
  operation: 'an unfinished merge, rebase, cherry-pick or revert',
  commits: 'no commit yet',
  worktree: 'uncommitted or untracked changes',
  remote: 'dev does not match origin as of the fetch (unpushed, behind or diverged)',
  handoff: 'no usable Start here block in STATE.md (three fields; the first step names a file, route or command)',
  'shared-memory': 'STATE.md is not committed on the shared branch',
};

// What the previous session actually left behind, read from git, not from prose.
function handoffLine(cwd) {
  try {
    if (!inspectProject(cwd).isGit) return '';
    const report = verifyWrapUp({ project: cwd, remote: 'tracking' });
    const issues = report.checks.filter(c => c.status !== 'passed')
      .map(c => (HANDOFF_ISSUES[c.id] ?? c.id) + (c.status === 'unknown' ? ' (could not be checked)' : ''));
    if (!issues.length) {
      return '[handoff] The previous handoff passes the mechanical checks: working branch, clean checkout, no unfinished Git operation, usable Start here block' +
        (report.scope === 'shared-dev' ? ', dev matches origin as of the fetch' : '') + '.';
    }
    return `[handoff] The previous handoff is ${report.status}: ${issues.join('; ')}. Tell the user in one line before starting work; do not fix it silently.`;
  } catch { return ''; }
}

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
    const handoff = handoffLine(cwd);
    if (handoff) chunks.push(handoff);
    chunks.push(memory);
  }
  if (chunks.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'SessionStart', additionalContext: chunks.join('\n\n'),
  } }));
} catch { /* Unexpected failures must not break a session. */ }
process.exit(0);
