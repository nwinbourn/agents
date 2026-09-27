#!/usr/bin/env node
// branch-guard — PreToolUse hook on Bash | PowerShell | EnterWorktree | Task | Agent.
//
// Enforces the Git flow from AGENTS.md at the command, not in prose. Only in
// projects that adopted the memory protocol (STATE/CONTEXT, or origin/dev):
//   - local projects:      no new branches or worktrees (creating `dev` asks)
//   - origin/dev exists:   work goes on dev, or on a feature/<task> or fix/<task>
//                          branch made off dev in its own worktree under
//                          .claude/worktrees/ (opening one asks); other branch
//                          names and worktrees are refused; commits stay on dev
//                          or a task branch; anything touching main asks,
//                          because that is a release; force-push, rebase, hard
//                          reset and deleting other branches ask, per AGENTS.md
// A personal ~/.claude/branch-guard.json can soften the two refusals to prompts
// or drop them (see docs/BRANCH-GUARD.md). A one-shot `/override`
// (branch-guard-override.mjs) can turn this project's hard refusals into prompts for
// a single hotfix window; see docs/BRANCH-GUARD.md. Silent everywhere else, silent
// under the rules, read-only, fail-open on error.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { inspectProject, mainProjectRoot, runGit } from './lib/project-inspection.mjs';
import { splitCommands, analyzeCommand, decide, combine, WORKTREE_HOME } from './lib/branch-policy.mjs';
import { readActiveOverride, OVERRIDE_NOTE } from './branch-guard-override.mjs';

const MODES = ['deny', 'ask', 'allow'];

function guardSettings() {
  const settings = { taskBranches: 'deny', worktrees: 'deny' };
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.claude', 'branch-guard.json'), 'utf8'));
    for (const key of Object.keys(settings)) if (MODES.includes(raw?.[key])) settings[key] = raw[key];
  } catch { /* missing or invalid file: defaults */ }
  return settings;
}

// The long, real form of a path that may not exist yet: resolve its deepest existing
// ancestor through the filesystem (Windows short names, symlinks), then re-append the rest.
function canonical(path) {
  let head = resolve(path);
  const tail = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    tail.unshift(basename(head));
    head = up;
  }
  try { head = realpathSync.native(head); } catch { /* keep the resolved form */ }
  return join(head, ...tail);
}

function emit(decision, reason) {
  if (decision === 'allow') return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
}

try {
  const data = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.cwd != null && typeof data.cwd !== 'string')) process.exit(0);
  const tool = String(data.tool_name ?? '');
  const input = data.tool_input && typeof data.tool_input === 'object' && !Array.isArray(data.tool_input) ? data.tool_input : {};
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const settings = guardSettings();

  let shellDir = cwd; // where the next git command runs; follows `cd` and `git -C`
  const states = new Map();
  const stateFor = dir => {
    const project = inspectProject(dir);
    if (!project.adopted) return null;
    if (states.has(project.root)) return states.get(project.root);
    const git = args => runGit(project.root, args);
    const branchExists = name => Boolean(name) && git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).ok;
    const head = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const gitDir = git(['rev-parse', '--absolute-git-dir']);
    const state = {
      workflow: project.workflow === 'shared-dev' ? 'shared-dev' : 'local',
      root: project.root,
      trunk: branchExists('main') ? 'main' : branchExists('master') ? 'master' : 'main',
      current: head.ok ? head.output.trim() : null,
      mergeInProgress: gitDir.ok && existsSync(join(gitDir.output.trim(), 'MERGE_HEAD')),
      settings,
      probes: {
        branchExists,
        isCommit: ref => Boolean(ref) && !ref.startsWith('-') && git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok,
        pathExists: p => existsSync(resolve(shellDir, p)),
        previousBranch: () => {
          const r = git(['rev-parse', '--symbolic-full-name', '@{-1}']);
          const name = r.ok ? r.output.trim() : '';
          return name.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : null;
        },
        // Branch folders live under the main checkout's .claude/worktrees/, which Git must ignore.
        worktreePlace: p => {
          const mainRoot = mainProjectRoot(project.root);
          const target = canonical(resolve(shellDir, p));
          const rel = relative(canonical(join(mainRoot, WORKTREE_HOME)), target);
          if (!rel || rel.startsWith('..') || isAbsolute(rel) || /[\\/]/.test(rel)) return 'outside'; // one level: .claude/worktrees/<task>
          const ignored = runGit(mainRoot, ['check-ignore', '-q', target]);
          return !ignored.ok && ignored.code === 1 ? 'not-ignored' : 'ok';
        },
      },
    };
    states.set(project.root, state);
    return state;
  };

  if (tool === 'EnterWorktree' || ((tool === 'Task' || tool === 'Agent') && input.isolation === 'worktree')) {
    // Entering a folder that already exists creates nothing; the branch was checked when it was made.
    if (tool === 'EnterWorktree' && typeof input.path === 'string' && input.path) process.exit(0);
    const state = stateFor(cwd);
    if (state && settings.worktrees !== 'allow') {
      let decision = settings.worktrees === 'ask' ? 'ask' : 'deny';
      let reason = state.workflow !== 'shared-dev'
        ? `branch-guard: this project works on a single branch ('${state.trunk}'); worktrees create stray branches. Run without worktree isolation. Rules: AGENTS.md → Git flow.`
        : tool === 'EnterWorktree'
          ? `branch-guard: without a path this makes a randomly named branch. Branches here are feature/<task> or fix/<task> made off 'dev': \`git worktree add ${WORKTREE_HOME}/<task> -b feature/<task> dev\` (the user approves it), then EnterWorktree with that path. Rules: AGENTS.md → Git flow.`
          : `branch-guard: worktree isolation makes a randomly named branch. Run the agent without isolation; branches here are feature/<task> or fix/<task> made off 'dev', opened only when the user chose one. Rules: AGENTS.md → Git flow.`;
      if (decision === 'deny' && readActiveOverride(state.root)) { decision = 'ask'; reason = `${reason} | ${OVERRIDE_NOTE}`; }
      emit(decision, reason);
    }
    process.exit(0);
  }
  if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
  const command = typeof input.command === 'string' ? input.command : '';
  if (!/\b(git|gh)\b/i.test(command)) process.exit(0);

  const decisions = [];
  for (const words of splitCommands(command, { powershell: tool === 'PowerShell' })) {
    const op = analyzeCommand(words);
    if (!op) continue;
    if (op.kind === 'cd') {
      if (op.path && !op.path.startsWith('-') && op.path !== '~' && !op.path.startsWith('$')) shellDir = resolve(shellDir, op.path);
      continue;
    }
    const state = stateFor(op.cwd ? resolve(shellDir, op.cwd) : shellDir);
    if (!state) continue;
    if (op.kind === 'worktree' && op.path && op.cwd) op.path = resolve(shellDir, op.cwd, op.path);
    const result = decide(op, state);
    if (result.decision === 'deny' && readActiveOverride(state.root)) {
      result.decision = 'ask';
      result.reason = result.reason ? `${result.reason} | ${OVERRIDE_NOTE}` : OVERRIDE_NOTE;
    }
    state.current = result.current;
    decisions.push(result);
  }
  const { decision, reason } = combine(decisions);
  emit(decision, reason);
} catch { /* A guard that breaks must never break the session: fail open. */ }
process.exit(0);
