// branch-policy — pure analysis for the branch guard. No git calls live here; the
// hook supplies probes for anything that needs the repository. This is best-effort
// text analysis of a shell command: it catches the ordinary ways an agent creates
// branches or touches main, not every conceivable one.

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'env', 'time', 'nohup', 'nice', 'builtin']);
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);
const MERGE_VALUE_OPTIONS = new Set(['-m', '-s', '-X', '-F', '--strategy', '--strategy-option', '--file', '--into-name']);
const BRANCH = 'dev';
const DEV_REFS = new Set([BRANCH, `origin/${BRANCH}`, `refs/heads/${BRANCH}`, `refs/remotes/origin/${BRANCH}`]);
export const WORKTREE_HOME = '.claude/worktrees';

/**
 * A task branch on a dev project: feature/<task> or fix/<task>, lowercase words joined
 * by dashes. It is made off dev, lives in its own worktree and merges back at wrap-up.
 * @param {unknown} name
 */
export function isTaskBranch(name) {
  return typeof name === 'string' && name.length <= 64 && /^(?:feature|fix)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

const openCommand = (target, create = true) =>
  `git worktree add ${WORKTREE_HOME}/${target.slice(target.indexOf('/') + 1)} ${create ? `-b ${target} ${BRANCH}` : target}`;

/**
 * Split a bash or PowerShell command string into simple commands, each an array of
 * words. Quote-aware; heredoc bodies, comments and redirections are dropped; pipes,
 * chains, subshells and blocks become separate commands.
 * @param {string} text
 * @param {{ powershell?: boolean }} [options] PowerShell keeps backslashes literal and escapes with a backtick.
 */
export function splitCommands(text, { powershell = false } = {}) {
  const segments = [];
  const heredocs = [];
  let words = [];
  let word = '';
  let has = false;
  const push = () => { if (has) { words.push(word); word = ''; has = false; } };
  const end = () => { push(); if (words.length) segments.push(stripRedirections(words)); words = []; };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      word += j < 0 ? text.slice(i + 1) : text.slice(i + 1, j);
      has = true;
      i = j < 0 ? n : j + 1;
    } else if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        const escape = powershell ? '`' : '\\';
        if (text[i] === escape && i + 1 < n && (powershell || '$`"\\\n'.includes(text[i + 1]))) { word += text[i + 1]; i += 2; }
        else { word += text[i]; i++; }
      }
      i++;
      has = true;
    } else if (!powershell && c === '\\') {
      if (text[i + 1] === '\n') { i += 2; continue; }
      word += text[i + 1] ?? '';
      has = true;
      i += 2;
    } else if (powershell && c === '`') {
      if (text[i + 1] === '\n' || text[i + 1] === '\r') { i += 2; continue; }
      word += text[i + 1] ?? '';
      has = true;
      i += 2;
    } else if (c === '#' && !has) {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      i += 2;
      if (text[i] === '-') i++;
      while (text[i] === ' ' || text[i] === '\t') i++;
      let term = '';
      if (text[i] === "'" || text[i] === '"') {
        const q = text[i];
        const j = text.indexOf(q, i + 1);
        term = j < 0 ? text.slice(i + 1) : text.slice(i + 1, j);
        i = j < 0 ? n : j + 1;
      } else {
        while (i < n && !/[\s;|&()<>]/.test(text[i])) term += text[i++];
      }
      if (term) heredocs.push(term);
      push();
    } else if (c === '\n') {
      end();
      i++;
      while (heredocs.length && i < n) {
        const j = text.indexOf('\n', i);
        const line = j < 0 ? text.slice(i) : text.slice(i, j);
        i = j < 0 ? n : j + 1;
        if (line.trim() === heredocs[0]) heredocs.shift();
      }
    } else if (c === '&' && ((has && /[<>]$/.test(word)) || text[i + 1] === '>')) {
      word += c; // `2>&1`, `>&2`, `&>file` are redirections, not separators
      has = true;
      i++;
    } else if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}' || c === '`') {
      end();
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      push();
      i++;
    } else {
      word += c;
      has = true;
      i++;
    }
  }
  end();
  return segments;
}

function stripRedirections(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d*>&\d+$/.test(w) || /^\d*>{1,2}\S+$/.test(w) || /^<\S+$/.test(w) || /^&>\S+$/.test(w)) continue;
    if (/^\d*>{1,2}$/.test(w) || /^\d*<$/.test(w) || w === '&>' || w === '>&' || w === '<&') { i++; continue; }
    out.push(w);
  }
  return out;
}

/**
 * Interpret one simple command. Returns an operation descriptor, or null when the
 * command is not git-related.
 * @param {string[]} words
 */
export function analyzeCommand(words) {
  const w = words.slice();
  while (w.length && (WRAPPERS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w.shift();
  if (!w.length) return null;
  const base = w[0].split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  if (base === 'cd' || base === 'set-location' || base === 'pushd') return { kind: 'cd', path: w[1] ?? null };
  if (base === 'gh') return w[1] === 'pr' && w[2] === 'merge' ? { kind: 'pr-merge' } : null;
  if (base !== 'git') return null;
  let cwd = null;
  let k = 1;
  for (; k < w.length; k++) {
    const a = w[k];
    if (!a.startsWith('-')) break;
    if (a === '-C') cwd = w[++k] ?? cwd;
    else if (GIT_VALUE_OPTIONS.has(a)) k++;
  }
  const op = analyzeGit(w[k], w.slice(k + 1));
  if (op && cwd) op.cwd = cwd;
  return op;
}

function analyzeGit(sub, args) {
  const has = (...flags) => args.some(a => flags.includes(a));
  switch (sub) {
    case 'checkout': return parseCheckout(args);
    case 'switch': return parseSwitch(args);
    case 'branch': return parseBranch(args);
    case 'worktree':
      if (args[0] === 'add') return parseWorktreeAdd(args.slice(1));
      return args[0] === 'remove' && has('--force', '-f') ? { kind: 'worktree-remove-force' } : null;
    case 'stash': return args[0] === 'branch' && args[1] ? { kind: 'create', target: args[1], inPlace: true } : null;
    case 'commit': return { kind: 'commit' };
    case 'cherry-pick':
    case 'revert': return has('--abort', '--quit', '--skip') ? null : { kind: 'commit' };
    case 'merge': {
      if (has('--abort', '--quit')) return null;
      if (has('--continue')) return { kind: 'commit' };
      const sources = [];
      for (let i = 0; i < args.length; i++) {
        if (MERGE_VALUE_OPTIONS.has(args[i])) i++;
        else if (!args[i].startsWith('-')) sources.push(args[i]);
      }
      return { kind: 'merge', sources };
    }
    case 'rebase': return has('--abort', '--quit', '--continue', '--skip') ? null : { kind: 'rebase' };
    case 'reset': return has('--hard') ? { kind: 'reset-hard' } : null;
    case 'push': return parsePush(args);
    default: return null;
  }
}

function parseCheckout(args) {
  let create = null;
  let track = false;
  let detach = false;
  let paths = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { paths = true; break; }
    if (a === '-b' || a === '-B' || a === '--orphan') create = args[++i] ?? create;
    else if (/^-[bB].+/.test(a)) create = a.slice(2);
    else if (a.startsWith('--orphan=')) create = a.slice(9);
    else if (a === '-t' || a === '--track') track = true;
    else if (a === '-d' || a === '--detach') detach = true;
    else if (a.startsWith('-') && a !== '-') continue;
    else positional.push(a);
  }
  if (create) return { kind: 'create', target: create, inPlace: true };
  if (track && positional[0]) return { kind: 'create', target: positional[0].replace(/^[^/]+\//, ''), inPlace: true };
  if (paths) return null;
  if (detach) return { kind: 'detach' };
  if (!positional.length) return null;
  return { kind: 'checkout', target: positional[0], maybePath: true };
}

function parseSwitch(args) {
  let create = null;
  let track = false;
  let detach = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '-C' || a === '--create' || a === '--force-create' || a === '--orphan') create = args[++i] ?? create;
    else if (/^-[cC].+/.test(a)) create = a.slice(2);
    else if (/^--(create|force-create|orphan)=/.test(a)) create = a.slice(a.indexOf('=') + 1);
    else if (a === '-t' || a === '--track') track = true;
    else if (a === '-d' || a === '--detach') detach = true;
    else if (a.startsWith('-') && a !== '-') continue;
    else positional.push(a);
  }
  if (create) return { kind: 'create', target: create, inPlace: true };
  if (track && positional[0]) return { kind: 'create', target: positional[0].replace(/^[^/]+\//, ''), inPlace: true };
  if (detach) return { kind: 'detach' };
  if (!positional.length) return null;
  return { kind: 'checkout', target: positional[0], maybePath: false };
}

// git worktree add [-f] [--detach] [--lock [--reason <text>]] [--orphan] [(-b | -B) <branch>] <path> [<commit-ish>]
function parseWorktreeAdd(args) {
  let create = null;
  let detach = false;
  let orphan = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { positional.push(...args.slice(i + 1)); break; }
    if (a === '-b' || a === '-B') create = args[++i] ?? create;
    else if (/^-[bB].+/.test(a)) create = a.slice(2);
    else if (a === '--reason') i++;
    else if (a === '-d' || a === '--detach') detach = true;
    else if (a === '--orphan') orphan = true;
    else if (a.startsWith('-')) continue;
    else positional.push(a);
  }
  return { kind: 'worktree', path: positional[0] ?? null, start: positional[1] ?? null, create, detach, orphan };
}

const BRANCH_LIST_FLAGS = new Set(['--list', '--all', '--remotes', '--verbose', '--show-current', '--contains', '--no-contains',
  '--merged', '--no-merged', '--points-at', '--edit-description', '--unset-upstream', '--set-upstream-to', '-u']);

function parseBranch(args) {
  const positional = [];
  let mode = 'create';
  let force = false;
  for (const a of args) {
    if (a === '--') continue;
    if (!a.startsWith('-')) { positional.push(a); continue; }
    if (a === '--delete') mode = 'delete';
    else if (a === '--force') force = true;
    else if (a === '--move') mode = 'rename';
    else if (a === '--copy') mode = 'copy';
    else if (BRANCH_LIST_FLAGS.has(a) || /^--(format|sort|column|set-upstream-to|contains|no-contains|merged|no-merged|points-at)=/.test(a)) mode = 'list';
    else if (/^-[a-zA-Z]+$/.test(a)) {
      const letters = a.slice(1);
      if (/D/.test(letters)) { mode = 'delete'; force = true; }
      else if (/d/.test(letters)) mode = 'delete';
      else if (/[mM]/.test(letters)) mode = 'rename';
      else if (/[cC]/.test(letters)) mode = 'copy';
      else if (/[larv]/.test(letters)) mode = 'list';
      if (/f/.test(letters)) force = true;
    }
  }
  if (mode === 'list') return null;
  if (mode === 'delete') return { kind: 'branch-delete', target: positional[0] ?? null, force };
  if (mode === 'rename') return { kind: 'branch-rename', target: positional[positional.length - 1] ?? null };
  if (mode === 'copy') return positional.length ? { kind: 'create', target: positional[positional.length - 1], start: positional.length > 1 ? positional[0] : null } : null;
  return positional.length ? { kind: 'create', target: positional[0], start: positional[1] ?? null } : null;
}

function parsePush(args) {
  let force = false;
  let remove = false;
  let all = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) force = true;
    else if (a === '-d' || a === '--delete') remove = true;
    else if (a === '--all' || a === '--mirror' || a === '--branches') all = true;
    else if (a === '-o' || a === '--push-option' || a === '--receive-pack' || a === '--exec') i++;
    else if (a.startsWith('-')) continue;
    else positional.push(a);
  }
  const targets = [];
  for (const spec of positional.slice(1)) {
    let s = spec;
    if (s.startsWith('+')) { force = true; s = s.slice(1); }
    const colon = s.indexOf(':');
    const src = colon >= 0 ? s.slice(0, colon) : s;
    const dst = colon >= 0 ? s.slice(colon + 1) : s;
    if (dst === '') { remove = true; continue; }
    if (dst.startsWith('refs/tags/')) continue;
    if (colon < 0 && src === 'HEAD') { targets.push(null); continue; }
    targets.push(dst.replace(/^refs\/heads\//, ''));
  }
  return { kind: 'push', force, remove, all, targets, usesCurrent: positional.length < 2 };
}

/**
 * Decide one operation against a project. `state` carries workflow ('local' |
 * 'shared-dev'), trunk ('main' | 'master'), current (branch, or null when detached),
 * mergeInProgress, and probes { branchExists, isCommit, pathExists, previousBranch,
 * worktreePlace } where worktreePlace(path) is 'ok', 'outside' (not under
 * WORKTREE_HOME) or 'not-ignored' (Git would see the folder as untracked work).
 * Returns { decision: 'allow' | 'ask' | 'deny', reason, current } where `current`
 * is the branch after the operation, for the next command in a chain.
 */
export function decide(op, state) {
  const shared = state.workflow === 'shared-dev';
  const rules = 'Rules: AGENTS.md → Git flow.';
  const allow = (current = state.current) => ({ decision: 'allow', reason: '', current });
  const ask = (reason, current = state.current) => ({ decision: 'ask', reason, current });
  const deny = reason => ({ decision: 'deny', reason, current: state.current });
  const example = `git worktree add ${WORKTREE_HOME}/<task> -b feature/<task> ${BRANCH}`;
  const misfit = target => soften(state, 'taskBranches', deny(`branch-guard: '${target}' is not a branch this project uses. Work goes straight on '${BRANCH}', or, when the user chose a branch, on feature/<task> or fix/<task> made off ${BRANCH} in its own folder: \`${example}\`. ${rules}`), target);
  // A new task branch (not checked out here): off dev, with the user's approval.
  const openTaskBranch = (target, start) => {
    const from = start ?? state.current; // git branches from HEAD when no start point is given
    if (state.probes.branchExists(target)) return deny(`branch-guard: '${target}' already exists. Reopen it in its folder with \`${openCommand(target, false)}\`, or pick a new name. ${rules}`);
    if (!DEV_REFS.has(from)) return soften(state, 'taskBranches', deny(`branch-guard: '${target}' must be made off '${BRANCH}', not ${from ? `'${from}'` : 'a detached HEAD'}. Use \`${openCommand(target)}\`. ${rules}`));
    return ask(`branch-guard: open a new branch '${target}' off '${BRANCH}' in its own folder? Approve only if the user chose a branch for this work; straight on '${BRANCH}' is the default. It merges back into ${BRANCH} at wrap-up. ${rules}`);
  };
  switch (op.kind) {
    case 'worktree': {
      if (!shared) return soften(state, 'worktrees', deny(`branch-guard: worktrees are not used in this project; each one becomes a stray branch. Work in this checkout on '${state.current ?? state.trunk}'. ${rules}`));
      const refuse = why => soften(state, 'worktrees', deny(`branch-guard: ${why} ${rules}`));
      if (op.detach || op.orphan) return refuse(`a worktree here holds one feature/ or fix/ branch made off '${BRANCH}'; detached and orphan worktrees are not used. Open one with \`${example}\`.`);
      const place = op.path ? state.probes.worktreePlace(op.path) : 'outside';
      if (place === 'outside') return refuse(`branch folders live in ${WORKTREE_HOME}/<task>. Open one with \`${example}\`.`);
      if (place === 'not-ignored') return deny(`branch-guard: ${WORKTREE_HOME}/ is not ignored by Git here, so a branch folder would show up as untracked work on '${BRANCH}'. Add the line \`${WORKTREE_HOME}/\` to .git/info/exclude, then retry. ${rules}`);
      if (op.create) {
        const target = op.create.replace(/^refs\/heads\//, '');
        return isTaskBranch(target) ? openTaskBranch(target, op.start) : misfit(target);
      }
      // Without -b: reopen an existing task branch, or git would invent a branch named after the folder.
      if (isTaskBranch(op.start) && state.probes.branchExists(op.start)) return allow();
      return refuse(`\`git worktree add\` here takes -b with a feature/<task> or fix/<task> name made off '${BRANCH}' (\`${example}\`), or reopens an existing one of those.`);
    }
    case 'create': {
      const target = String(op.target ?? '').replace(/^refs\/heads\//, '');
      if (shared) {
        if (target === BRANCH) return allow(BRANCH);
        if (target.startsWith('wip/')) return ask(`branch-guard: '${target}' — a wip/ branch exists only to park commits after a merge conflict the user cannot resolve. Approve only if that is what is happening. ${rules}`, target);
        if (!isTaskBranch(target)) return misfit(target);
        if (op.inPlace) return soften(state, 'taskBranches', deny(`branch-guard: '${target}' gets its own folder, so this checkout stays on '${state.current ?? BRANCH}'. Open it with \`${openCommand(target)}\`, then move the session there (EnterWorktree with that path). ${rules}`), target);
        return openTaskBranch(target, op.start);
      }
      if (target === BRANCH) return ask(`branch-guard: creating '${BRANCH}' switches this project to the shared dev → main flow. Only for a live, multi-person project with the user's explicit go-ahead. ${rules}`, BRANCH);
      return soften(state, 'taskBranches', deny(`branch-guard: this project works directly on '${state.trunk}'. Creating '${target}' is not allowed; no task branches, no worktrees. Do the work on ${state.trunk}. ${rules}`), target);
    }
    case 'checkout': {
      let target = op.target;
      if (target === '-') {
        target = state.probes.previousBranch();
        if (!target) return shared ? ask(`branch-guard: switching to the previous branch leaves '${BRANCH}'; needs the user's say-so. ${rules}`, null) : allow(null);
      }
      if (state.probes.branchExists(target)) return switchTo(target, state, shared, rules);
      if (op.maybePath && state.probes.pathExists(target)) return allow();
      if (state.probes.isCommit(target)) return decide({ kind: 'detach' }, state);
      return decide({ kind: 'create', target: target.replace(/^origin\//, ''), inPlace: true }, state);
    }
    case 'detach':
      return shared ? ask(`branch-guard: checking out a commit leaves '${BRANCH}' for a detached HEAD. Needs the user's say-so. ${rules}`, null) : allow(null);
    case 'commit': {
      if (!shared) return allow();
      const cur = state.current;
      if (cur === BRANCH || (cur && cur.startsWith('wip/')) || isTaskBranch(cur)) return allow();
      const where = cur ? `'${cur}'` : 'a detached HEAD';
      if (state.mergeInProgress) return ask(`branch-guard: a merge is in progress on ${where}; finishing it commits there. Approve only as part of a release the user asked for. ${rules}`);
      return deny(`branch-guard: commits go on '${BRANCH}' (or on a feature/ or fix/ branch in its own folder), never on ${where}. Switch back to ${BRANCH} and commit there. ${rules}`);
    }
    case 'merge':
      if (!shared || state.current === BRANCH) return allow();
      // Bringing dev into a task branch is how its conflicts get settled before it merges back.
      if (isTaskBranch(state.current) && op.sources?.length && op.sources.every(s => DEV_REFS.has(s))) return allow();
      return ask(`branch-guard: merging into '${state.current ?? 'a detached HEAD'}' publishes work outside '${BRANCH}'.${state.current === state.trunk ? ' On the production branch that is a release.' : ''} Approve only if the user asked for it. ${rules}`);
    case 'rebase':
      return shared ? ask(`branch-guard: rebasing rewrites history on a shared project. Needs the user's explicit approval. ${rules}`) : allow();
    case 'reset-hard':
      return shared ? ask(`branch-guard: 'git reset --hard' discards work. Needs the user's explicit approval. ${rules}`) : allow();
    case 'branch-delete':
      if (op.force) return ask(`branch-guard: force-deleting '${op.target ?? 'a branch'}' discards any commits that are not on the working branch. Show the user what it holds and get an explicit yes. ${rules}`);
      // Plain -d refuses a branch that is not merged, so tidying a merged task branch is safe.
      if (shared && isTaskBranch(op.target)) return allow();
      return shared ? ask(`branch-guard: deleting branches needs the user's explicit approval. ${rules}`) : allow();
    case 'branch-rename':
      return shared ? ask(`branch-guard: renaming branches needs the user's explicit approval. ${rules}`) : allow();
    case 'worktree-remove-force':
      return ask(`branch-guard: removing a worktree with --force discards its uncommitted changes. Needs the user's explicit yes. ${rules}`);
    case 'pr-merge':
      return shared ? ask(`branch-guard: merging a pull request can publish '${state.trunk}'. Approve only for a release the user asked for. ${rules}`) : allow();
    case 'push': {
      if (!shared) return allow();
      if (op.force) return ask(`branch-guard: force-pushing rewrites shared history. Needs the user's explicit approval. ${rules}`);
      if (op.remove) return ask(`branch-guard: deleting a remote branch needs the user's explicit approval. ${rules}`);
      const targets = op.all ? [state.trunk] : op.targets.map(t => t ?? state.current);
      if (op.usesCurrent && !op.all) targets.push(state.current);
      for (const t of targets) {
        if (t === BRANCH) continue;
        if (t === state.trunk) return ask(`branch-guard: pushing '${state.trunk}' publishes production. Approve only for a release the user asked for. ${rules}`);
        return ask(`branch-guard: '${t ?? 'a detached HEAD'}' is not the shared working branch; pushing it needs the user's say-so. ${rules}`);
      }
      return allow();
    }
    default:
      return allow();
  }
}

// Personal settings (~/.claude/branch-guard.json) can turn a refusal into a prompt or drop it.
function soften(state, key, denial, next = state.current) {
  const mode = state.settings?.[key];
  if (mode === 'allow') return { decision: 'allow', reason: '', current: next };
  if (mode === 'ask') return { ...denial, decision: 'ask', current: next };
  return denial;
}

function switchTo(target, state, shared, rules) {
  if (!shared || target === BRANCH) return { decision: 'allow', reason: '', current: target };
  if (target === state.trunk) {
    return { decision: 'ask', current: target, reason: `branch-guard: switching to '${state.trunk}' leaves the working branch '${BRANCH}'. That is a release step (merge ${BRANCH} → ${state.trunk}). Approve only if the user asked for a release. ${rules}` };
  }
  if (isTaskBranch(target)) {
    return soften(state, 'taskBranches', { decision: 'deny', current: state.current, reason: `branch-guard: '${target}' lives in its own folder; this checkout stays where it is. If its folder is gone, reopen it with \`${openCommand(target, false)}\`, then EnterWorktree with that path. ${rules}` }, target);
  }
  return { decision: 'ask', current: target, reason: `branch-guard: '${BRANCH}' is the working branch here. Switching to '${target}' needs the user's say-so. ${rules}` };
}

const RANK = { allow: 0, ask: 1, deny: 2 };

/** Fold several decisions into the strictest one, keeping every distinct reason. */
export function combine(decisions) {
  let decision = 'allow';
  const reasons = [];
  for (const d of decisions) {
    if (RANK[d.decision] > RANK[decision]) decision = d.decision;
    if (d.reason && !reasons.includes(d.reason)) reasons.push(d.reason);
  }
  return { decision, reason: reasons.join(' | ') };
}
