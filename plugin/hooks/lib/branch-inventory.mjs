// Leftover branches and worktrees, read-only. A project keeps one working branch;
// everything else is either unrecorded work (commits not on it, not named in STATE.md)
// or clutter (merged, safe to delete). Nothing here fetches, switches or deletes.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runGit, findMemoryFile } from './project-inspection.mjs';

const TRUNKS = ['main', 'master'];
const SCAN_LIMIT = 40; // per list; beyond this the count is reported, not inspected

export function trunkBranch(root) {
  const has = name => runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).ok;
  return has('main') ? 'main' : has('master') ? 'master' : 'main';
}

/**
 * @param {string} root the working-tree root
 * @param {'shared-dev'|'local'|'unknown'} workflow from inspectProject
 */
export function branchInventory(root, workflow) {
  const trunk = trunkBranch(root);
  const working = workflow === 'shared-dev' ? 'dev' : trunk;
  const keep = new Set([working, trunk]);
  const head = runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const current = head.ok ? head.output.trim() : null;
  let stateText = '';
  const statePath = findMemoryFile(root, 'STATE');
  if (statePath) { try { stateText = readFileSync(statePath, 'utf8'); } catch { /* treated as unnamed */ } }
  const named = (...names) => names.some(name => name && stateText.includes(name));
  const workingExists = runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${working}`]).ok;
  const ahead = ref => {
    if (!workingExists) return null;
    const r = runGit(root, ['rev-list', '--count', `${working}..${ref}`]);
    return r.ok && /^\d+$/.test(r.output.trim()) ? Number(r.output.trim()) : null;
  };
  const refs = pattern => {
    // Full ref names: the short form of refs/remotes/origin/HEAD is just "origin".
    const r = runGit(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:short)', pattern]);
    return r.ok ? r.output.split('\n').filter(Boolean).map(line => {
      const [full, sha, date] = line.split('\t');
      return { name: full.replace(/^refs\/(?:heads|remotes)\//, ''), sha, date };
    }) : [];
  };
  const describe = (ref, ...aliases) => {
    const count = ahead(ref.sha);
    return { name: ref.name, ahead: count, merged: count === 0, lastCommit: ref.date, named: named(ref.name, ...aliases), current: ref.name === current };
  };
  let skipped = 0;
  const local = [];
  for (const ref of refs('refs/heads')) {
    if (keep.has(ref.name)) continue;
    if (local.length >= SCAN_LIMIT) { skipped++; continue; }
    local.push(describe(ref));
  }
  const remote = [];
  for (const ref of refs('refs/remotes/origin')) {
    const short = ref.name.replace(/^origin\//, '');
    if (short === 'HEAD' || keep.has(short) || short === 'dev' || TRUNKS.includes(short)) continue;
    if (remote.length >= SCAN_LIMIT) { skipped++; continue; }
    remote.push(describe(ref, short));
  }
  const worktrees = [];
  const list = runGit(root, ['worktree', 'list', '--porcelain']);
  if (list.ok) {
    const blocks = list.output.split(/\r?\n\r?\n+/).map(b => b.trim()).filter(Boolean);
    for (const block of blocks.slice(1)) { // the first block is the main worktree
      const get = key => (block.match(new RegExp(`^${key} (.+)$`, 'm')) || [])[1];
      const path = get('worktree');
      if (!path || resolve(path) === resolve(root)) continue;
      const sha = get('HEAD');
      const branch = (get('branch') || '').replace(/^refs\/heads\//, '') || null;
      const exists = existsSync(path);
      const status = exists ? runGit(path, ['status', '--porcelain']) : null;
      const count = sha ? ahead(sha) : null;
      const rel = relative(root, path).split('\\').join('/');
      worktrees.push({ path, branch, exists, clean: status && status.ok ? !status.output.trim() : null,
        ahead: count, merged: count === 0, named: named(branch, rel, path) });
    }
  }
  return { working, trunk, current, local, worktrees, remote, skipped };
}

/** The one-line session-start report; empty when only the working branch exists. */
export function describeInventory(inv) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : word.endsWith('h') ? 'es' : 's'}`;
  const work = item => item.ahead === 0 ? (item.current ? 'checked out here, nothing beyond ' + inv.working : 'merged, safe to delete')
    : item.ahead == null ? 'state unknown'
    : `${plural(item.ahead, 'commit')} not on ${inv.working}, ${item.named ? 'named in STATE.md' : 'not named in STATE.md'}${item.current ? ', checked out here' : ''}`;
  const some = (list, format) => list.slice(0, 5).map(format).join('; ') + (list.length > 5 ? `; and ${list.length - 5} more` : '');
  const parts = [];
  if (inv.local.length) {
    parts.push(`${plural(inv.local.length, 'local branch')} besides ${inv.working}${inv.trunk !== inv.working ? ` and ${inv.trunk}` : ''}: ` +
      some(inv.local, b => `${b.name} (${work(b)}, last commit ${b.lastCommit})`));
  }
  if (inv.worktrees.length) {
    parts.push(`${plural(inv.worktrees.length, 'leftover worktree')}: ` +
      some(inv.worktrees, w => `${w.path} (${!w.exists ? 'missing on disk' : w.clean === false ? 'has uncommitted changes' : 'clean'}${w.branch ? `, branch ${w.branch}` : ', detached'}, ${work(w)})`));
  }
  if (inv.remote.length) {
    parts.push(`${plural(inv.remote.length, 'remote leftover')}: ` + some(inv.remote, r => `${r.name} (${work(r)}, last commit ${r.lastCommit})`));
  }
  if (inv.skipped) parts.push(`${inv.skipped} more not inspected`);
  if (!parts.length) return '';
  return `[branches] ${parts.join('. ')}. This project keeps one working branch (${inv.working}). Say "clean up the branches" to resolve these; nothing is deleted without the user's yes.`;
}
