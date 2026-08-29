#!/usr/bin/env node
// SessionStart hook: syncs the shared working branch before work begins.
//
// The convention (see templates/AGENTS.md): projects with a GitHub remote and an
// `origin/dev` branch use `dev` as the shared working branch — every person and
// every agent commits there; `main` is production. Memory files (CONTEXT/STATE/
// PITFALLS) travel with the branch, so pulling at session start is how one
// person's Claude receives what another person's Claude learned.
//
// What it does, and the only write it ever performs:
//   - fetch origin/dev (bounded by a timeout; failure degrades to a notice)
//   - IF on dev, clean tree, strictly behind: fast-forward pull — the one git
//     operation that cannot lose local work
//   - everything else (dirty, diverged, other branch): report via context and
//     leave the decision to the human. Never checkout, merge, rebase, or reset.
//
// Silent exit in repos that don't use the flow (no git, no origin/dev), so it's
// safe to run globally. Any unexpected error exits 0 — never break session start.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

const cwd = data.cwd || process.cwd();
if (String(data.source || '') === 'compact') process.exit(0); // matcher covers this; double-guard

const BRANCH = 'dev';

function git(args, timeout = 8000) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function tryGit(args, timeout) {
  try { return git(args, timeout); } catch { return null; }
}

// Not a git repo, or the flow isn't adopted here → stay silent.
if (tryGit(['rev-parse', '--is-inside-work-tree']) !== 'true') process.exit(0);
if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${BRANCH}`]) === null) process.exit(0);

const fetched = tryGit(['fetch', 'origin', BRANCH, '--quiet'], 15000) !== null;

const branch = tryGit(['branch', '--show-current']) ?? '';
const dirty = (tryGit(['status', '--porcelain']) ?? '') !== '';
const count = (range) => { const n = tryGit(['rev-list', '--count', range]); return n === null ? null : parseInt(n, 10); };

const lines = [];
if (!fetched) lines.push('NOTE: could not reach the remote (offline or auth issue) — sync status below may be stale.');

if (branch === BRANCH) {
  const ahead = count(`origin/${BRANCH}..HEAD`) ?? 0;
  const behind = count(`HEAD..origin/${BRANCH}`) ?? 0;

  if (behind > 0 && ahead === 0 && !dirty) {
    // The safe case: fast-forward only. Cannot lose local work by construction.
    const oldHead = tryGit(['rev-parse', 'HEAD']);
    const ok = tryGit(['merge', '--ff-only', `origin/${BRANCH}`], 15000) !== null;
    if (ok) {
      lines.push(`Pulled ${behind} new commit(s) from origin/${BRANCH} (fast-forward — nothing local was touched).`);
      const changed = oldHead ? (tryGit(['diff', '--name-only', `${oldHead}..HEAD`]) ?? '') : '';
      const memChanged = changed.split('\n').filter((f) => /(^|\/)(STATE|CONTEXT|PITFALLS|DESIGN)\.md$/.test(f));
      if (memChanged.length) {
        lines.push(`Project memory changed in that pull (${memChanged.join(', ')}) — trust the files on disk, not any in-context copy, and re-read STATE.md before acting.`);
      }
      lines.push('Mention the pull to the user only if it affects what they are about to do.');
    } else {
      lines.push(`origin/${BRANCH} is ${behind} commit(s) ahead but the fast-forward pull failed — tell the user and investigate before working.`);
    }
  } else if (behind > 0 && ahead === 0 && dirty) {
    lines.push(`origin/${BRANCH} has ${behind} new commit(s), but the working tree has uncommitted changes — did NOT pull.`);
    lines.push('Tell the user in plain words and ask how to proceed (commit first, or stash) before merging anything.');
  } else if (behind > 0 && ahead > 0) {
    lines.push(`Local ${BRANCH} and origin/${BRANCH} have BOTH moved (${ahead} ahead / ${behind} behind) — diverged.`);
    lines.push('Do NOT merge or rebase on your own. Describe both sides to the user and ask before reconciling.');
  } else if (ahead > 0) {
    lines.push(`${BRANCH} is ${ahead} commit(s) ahead of origin/${BRANCH} — unpushed work is invisible to collaborators and their agents.`);
    lines.push('Mention it; offer to push early rather than only at wrap-up.');
  } else {
    lines.push(`${BRANCH} is in sync with origin/${BRANCH}.${dirty ? ' Working tree has uncommitted changes from a previous session — check STATE.md "Mid-flight".' : ''}`);
  }
} else {
  const local = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]);
  const where = branch ? `On branch '${branch}'` : 'In detached HEAD state';
  lines.push(`${where}, not the shared working branch '${BRANCH}'.`);
  if (local === null) {
    lines.push(`Local '${BRANCH}' does not exist yet — \`git switch ${BRANCH}\` will create it from origin/${BRANCH} when the user is ready.`);
  } else {
    const devBehind = count(`${BRANCH}..origin/${BRANCH}`);
    if (devBehind) lines.push(`(origin/${BRANCH} is ${devBehind} commit(s) ahead of local ${BRANCH}.)`);
  }
  lines.push('Tell the user where they are. Do NOT switch branches without their say-so — they may be here deliberately.');
}

lines.push(`Convention here: '${BRANCH}' is the shared working branch — commit there, never directly to main; dev→main merges are deliberate maintainer actions. Full rules in AGENTS.md. At session end, /wrap-up must leave ${BRANCH} committed and pushed.`);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `[git-sync] ${lines.join('\n')}` },
}));
process.exit(0);
