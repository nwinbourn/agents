// Independent implementation of this repository's handoff requirements.
// Read-only Git queries; no fetch, index refresh, checkout, commit or push.
import { inspectProject, findMemoryFile, runGit as git } from './project-inspection.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const result = (id, status, message, evidence = {}) => ({ id, status, message, ...evidence });
export function checkHandoff(project) {
  const statePath = findMemoryFile(project, 'STATE');
  if (!statePath) return result('handoff', 'incomplete', 'STATE.md is missing.');
  let text;
  try { text = readFileSync(statePath, 'utf8'); }
  catch { return result('handoff', 'unknown', 'STATE.md could not be read.', { path: statePath }); }
  // Ignore commented-out examples and fenced code; fields must be real handoff text.
  const lines = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
  let fence = null;
  let inside = false;
  let sections = 0;
  const fields = { 'Do this first': [], 'Waiting on you': [], 'Mid-flight': [] };
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    if (/^(?: {4}|\t)/.test(line)) continue;
    const heading = line.match(/^\s{0,3}(#{1,2})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      inside = heading[1] === '##' && heading[2].toLowerCase() === 'start here';
      if (inside) sections++;
      continue;
    }
    if (!inside) continue;
    const field = line.match(/^\s*\*\*(Do this first|Waiting on you|Mid-flight)(?::\*\*|\*\*:)\s*(.*?)\s*$/);
    if (field) fields[field[1]].push(field[2]);
  }
  const unfinished = value => !value || /^(?:<[^>]*>|\[.*\]|TODO\b.*|TBD\b.*|\.{3}|…|[-–—])$/i.test(value);
  const invalid = Object.entries(fields).filter(([, values]) => values.length !== 1 || unfinished(values[0])).map(([key]) => key);
  if (sections !== 1 || invalid.length) {
    return result('handoff', 'incomplete', 'Use one Start here section with three unique, nonempty handoff fields; replace placeholders.',
      { path: statePath, sections, invalidFields: invalid });
  }
  return result('handoff', 'passed', 'All three handoff fields are present. Their accuracy still requires agent review.',
    { path: statePath, fields: Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values[0]])) });
}

export function verifyWrapUp({ project = process.cwd(), checkRemote = false } = {}) {
  const projectInfo = inspectProject(project);
  const checks = [];
  const root = projectInfo.root;
  const scope = projectInfo.workflow;
  if (!projectInfo.isGit) {
    for (const id of ['branch', 'conflicts', 'commits', 'worktree', 'remote']) {
      checks.push(result(id, 'unknown', 'A Git working tree could not be inspected.'));
    }
  } else {
    const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    checks.push(scope === 'unknown' ? result('branch', 'unknown', 'Could not determine whether the dev workflow is adopted.') :
      branch.ok ? result('branch', scope !== 'shared-dev' || branch.output.trim() === 'dev' ? 'passed' : 'incomplete',
        scope === 'shared-dev' ? 'Shared projects must finish on dev.' : 'No origin/dev is recorded; no shared-branch requirement applies.',
        { current: branch.output.trim(), expected: scope === 'shared-dev' ? 'dev' : null }) :
      result('branch', branch.code === 1 ? 'incomplete' : 'unknown', 'HEAD is detached or the branch could not be read.'));
    const conflicts = git(root, ['ls-files', '--unmerged', '-z']);
    checks.push(!conflicts.ok ? result('conflicts', 'unknown', 'Conflict status could not be read.') :
      result('conflicts', conflicts.output ? 'incomplete' : 'passed', conflicts.output ? 'Unresolved index conflicts remain.' : 'No unresolved index conflicts.'));
    const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
    const operations = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
    const active = gitDir.ok ? operations.filter(name => existsSync(join(gitDir.output.trim(), name))) : [];
    checks.push(result('operation', !gitDir.ok ? 'unknown' : active.length ? 'incomplete' : 'passed',
      !gitDir.ok ? 'Git operation state could not be read.' : active.length ? 'A merge, rebase, cherry-pick or revert is still in progress.' : 'No unfinished Git operation detected.'));
    const head = git(root, ['rev-parse', '--verify', 'HEAD']);
    checks.push(result('commits', head.ok ? 'passed' : head.code === 128 ? 'incomplete' : 'unknown',
      head.ok ? 'The checkout has a commit.' : 'No HEAD commit could be verified.', head.ok ? { head: head.output.trim() } : {}));
    const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
    checks.push(!dirty.ok ? result('worktree', 'unknown', 'Working-tree status could not be read.') :
      result('worktree', dirty.output ? 'incomplete' : 'passed', dirty.output ?
        'Uncommitted or untracked work remains. Review its ownership; do not commit unrelated files to make this pass.' :
        'No staged, unstaged or untracked changes. Ignored files are outside this check.'));

    if (scope === 'local') {
      checks.push(result('remote', 'passed', 'Sharing is not required by the local workflow; nothing about publication was verified.', { required: false }));
    } else if (scope === 'unknown' || !checkRemote) {
      checks.push(result('remote', 'unknown', scope === 'unknown' ? 'Shared-branch requirements are unknown.' :
        'The live remote was not checked. Rerun with --check-remote to verify sharing.', { required: true }));
    } else {
      const remote = git(root, ['ls-remote', '--exit-code', '--refs', 'origin', 'refs/heads/dev'], 15000);
      if (!remote.ok) {
        checks.push(result('remote', remote.code === 2 ? 'incomplete' : 'unknown', remote.code === 2 ?
          'The remote dev branch is missing; the recorded shared workflow needs review.' :
          'The live remote could not be checked (connectivity, credentials or timeout). Sharing is unverified.', { required: true }));
      } else {
        const match = remote.output.trim().match(/^([0-9a-f]{40,64})\s+refs\/heads\/dev$/);
        checks.push(!match || !head.ok ? result('remote', 'unknown', 'Remote and local commit IDs could not both be verified.', { required: true }) :
          result('remote', match[1] === head.output.trim() ? 'passed' : 'incomplete', match[1] === head.output.trim() ?
            'Local HEAD matches live origin/dev at the time of this check.' :
            'Local HEAD and live origin/dev differ. Work may be unpushed, behind or diverged; reconcile before declaring a shared handoff.',
          { required: true, remoteHead: match[1], localHead: head.output.trim() }));
      }
    }
  }
  const handoff = checkHandoff(root);
  checks.push(handoff);
  if (scope === 'shared-dev' && handoff.path) {
    const rel = relative(root, handoff.path).split('\\').join('/');
    const committed = git(root, ['cat-file', '-e', `HEAD:${rel}`]);
    checks.push(result('shared-memory', committed.ok ? 'passed' : committed.code === 128 ? 'incomplete' : 'unknown',
      committed.ok ? 'The handoff file exists in HEAD; the worktree check covers uncommitted edits.' :
        'The handoff file is not verified in HEAD. An ignored or untracked STATE.md cannot travel with the shared commit.'));
  }
  const status = checks.some(c => c.status === 'incomplete') ? 'incomplete' : checks.some(c => c.status === 'unknown') ? 'unknown' : 'passed';
  return { version: 1, checkedAt: new Date().toISOString(), project: root, scope, status,
    summary: status === 'passed' ? (scope === 'shared-dev' ? 'Mechanical shared-handoff checks passed.' : 'Mechanical local checks passed; publication was not required or verified.') :
      'Wrap-up is not verified complete. Review each incomplete or unknown check.',
    checks,
    limitations: 'Point-in-time checks, not a repository lock. No proof of prose accuracy, task completion, intended commit scope, ignored work, or workers still running. The agent must review those separately.' };
}
