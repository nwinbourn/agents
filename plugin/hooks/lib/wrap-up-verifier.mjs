// Independent implementation of this repository's handoff requirements.
// Read-only Git queries; no fetch, index refresh, checkout, commit or push.
import { inspectProject, findMemoryFile, runGit as git } from './project-inspection.mjs';
import { branchInventory, isOpenBranch } from './branch-inventory.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const result = (id, status, message, evidence = {}) => ({ id, status, message, ...evidence });
const LABEL = /^\s*\*\*(Do this first|Waiting on you|Mid-flight)(?::\*\*|\*\*:)\s*(.*?)\s*$/;

/**
 * Parse the Start here block. A field is its label line plus the lines directly under
 * it, up to a blank line, so a list under "Waiting on you:" still counts. Everything
 * else in the block (banners, code, notes) is reported as extra content. Comments never
 * count; fenced code never forms a field; a heading indented four spaces is not a heading.
 */
export function parseStartHere(text) {
  const lines = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
  const fields = { 'Do this first': [], 'Waiting on you': [], 'Mid-flight': [] };
  let fence = null, inside = false, sections = 0, field = null, extra = 0, total = 0;
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      field = null;
      continue;
    }
    if (fence) { if (inside) { extra++; total++; } continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading && heading[1].length <= 2) {
      inside = heading[1] === '##' && heading[2].toLowerCase() === 'start here';
      if (inside) sections++;
      field = null;
      continue;
    }
    if (!inside) continue;
    if (!line.trim()) { field = null; continue; }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { field = null; continue; }
    total++;
    const label = !/^(?: {4}|\t)/.test(line) && line.match(LABEL);
    if (label) { field = label[1]; fields[field].push(label[2]); continue; }
    if (heading) { field = null; extra++; continue; }
    if (field) { fields[field][fields[field].length - 1] += ' ' + line.trim(); continue; }
    extra++;
  }
  for (const key of Object.keys(fields)) fields[key] = fields[key].map(value => value.replace(/\s+/g, ' ').trim());
  return { sections, fields, lines: total, extraLines: extra };
}

export function checkHandoff(project) {
  const statePath = findMemoryFile(project, 'STATE');
  if (!statePath) return result('handoff', 'incomplete', 'STATE.md is missing.');
  let text;
  try { text = readFileSync(statePath, 'utf8'); }
  catch { return result('handoff', 'unknown', 'STATE.md could not be read.', { path: statePath }); }
  const { sections, fields, lines, extraLines } = parseStartHere(text);
  const unfinished = value => !value || /^(?:<[^>]*>|\[.*\]|TODO\b.*|TBD\b.*|\.{3}|…|[-–—])$/i.test(value);
  // The first step must name something concrete: a path, a backticked command, a URL or a commit.
  const specific = value => /[`\/\\]|\b\w+\.[A-Za-z]{1,6}\b|https?:\/\/|\b[0-9a-f]{7,40}\b/.test(value);
  const invalid = Object.entries(fields).filter(([, values]) => values.length !== 1 || unfinished(values[0])).map(([key]) => key);
  const vague = sections === 1 && !invalid.length && !specific(fields['Do this first'][0]);
  const evidence = { path: statePath, sections, lines, extraLines };
  if (sections !== 1 || invalid.length || vague) {
    return result('handoff', 'incomplete', vague
      ? "'Do this first' must name a file, route or command: include a path, a backticked command, a URL or a commit."
      : 'Use one Start here section with three unique, nonempty handoff fields; replace placeholders.',
      { ...evidence, invalidFields: vague ? ['Do this first'] : invalid, vague });
  }
  return result('handoff', 'passed', 'All three handoff fields are present and the first step names something concrete. Their accuracy still requires agent review.',
    { ...evidence, fields: Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values[0].slice(0, 160)])) });
}

export function verifyWrapUp({ project = process.cwd(), checkRemote = false, remote = checkRemote ? 'live' : 'skip' } = {}) {
  const projectInfo = inspectProject(project);
  const checks = [];
  const root = projectInfo.root;
  const scope = projectInfo.workflow;
  if (!projectInfo.isGit) {
    for (const id of ['branch', 'conflicts', 'commits', 'worktree', 'branches', 'remote']) {
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

    // A branch or worktree with commits not on the working branch is unintegrated work;
    // STATE.md has to name it. Merged leftovers are clutter, reported but not failing.
    // Open feature/ and fix/ branches in their own folders belong to parallel sessions
    // that merge them back at their own wrap-up: reported, never failing this one.
    const inventory = branchInventory(root, scope);
    const commits = n => `${n} commit${n === 1 ? '' : 's'} not on ${inventory.working}`;
    const open = inventory.local.filter(isOpenBranch).map(b => b.name);
    const unrecorded = [
      ...inventory.local.filter(b => b.ahead > 0 && !b.named && !isOpenBranch(b)).map(b => `'${b.name}' has ${commits(b.ahead)}`),
      ...inventory.worktrees.filter(w => w.ahead > 0 && !w.named && !w.task).map(w => `the worktree at ${w.path} has ${commits(w.ahead)}`),
    ];
    const leftovers = [...inventory.local.filter(b => b.merged && !b.current && !isOpenBranch(b)).map(b => b.name), ...inventory.worktrees.filter(w => w.merged && !w.task).map(w => w.path)];
    const openNote = open.length ? ` Open branches in their own folders merge back at their own wrap-up: ${open.join(', ')}.` : '';
    checks.push(unrecorded.length
      ? result('branches', 'incomplete', `${unrecorded.slice(0, 3).join('; ')}${unrecorded.length > 3 ? `; and ${unrecorded.length - 3} more` : ''}, and STATE.md does not name ${unrecorded.length === 1 ? 'it' : 'them'}. Record it under Mid-flight, merge it, or delete it.${openNote}`,
        { working: inventory.working, unrecorded, leftovers, open })
      : result('branches', 'passed', `No branch or worktree carries unrecorded work.${openNote}${leftovers.length ? ` Merged leftovers safe to delete: ${leftovers.join(', ')}.` : ''}`,
        { working: inventory.working, leftovers, open }));

    if (scope === 'local') {
      checks.push(result('remote', 'passed', 'Sharing is not required by the local workflow; nothing about publication was verified.', { required: false }));
    } else if (scope === 'unknown' || remote === 'skip') {
      checks.push(result('remote', 'unknown', scope === 'unknown' ? 'Shared-branch requirements are unknown.' :
        'The live remote was not checked. Rerun with --check-remote to verify sharing.', { required: true }));
    } else if (remote === 'tracking') {
      // Compare against the fetched tracking ref: no network, accurate as of the last fetch (session start runs one first).
      const fetched = git(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/dev']);
      const same = fetched.ok && head.ok && fetched.output.trim() === head.output.trim();
      checks.push(!fetched.ok || !head.ok ? result('remote', 'unknown', 'No fetched origin/dev to compare against.', { required: true }) :
        result('remote', same ? 'passed' : 'incomplete', same ?
          'Local HEAD matches origin/dev as of the last fetch; the live remote was not queried.' :
          'Local HEAD and the last-fetched origin/dev differ. Work may be unpushed, behind or diverged.',
          { required: true, remoteHead: fetched.output.trim(), localHead: head.output.trim(), asOf: 'last fetch' }));
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
