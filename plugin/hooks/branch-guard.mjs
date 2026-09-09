#!/usr/bin/env node
// branch-guard — PreToolUse hook on Bash | PowerShell | EnterWorktree | Task | Agent.
//
// Enforces the Git flow from AGENTS.md at the command, not in prose. Only in
// projects that adopted the memory protocol (STATE/CONTEXT, or origin/dev):
//   - any adopted project: no new branches or worktrees (creating `dev` asks)
//   - origin/dev exists:   commits stay on dev; anything touching main asks,
//                          because that is a release; force-push, rebase, hard
//                          reset and branch deletion ask, per AGENTS.md
// A personal ~/.claude/branch-guard.json can soften the two refusals to prompts
// or drop them (see docs/BRANCH-GUARD.md). Silent everywhere else, silent under
// the rules, read-only, fail-open on error.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { inspectProject, runGit } from './lib/project-inspection.mjs';
import { splitCommands, analyzeCommand, decide, combine } from './lib/branch-policy.mjs';

const MODES = ['deny', 'ask', 'allow'];

function guardSettings() {
  const settings = { taskBranches: 'deny', worktrees: 'deny' };
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.claude', 'branch-guard.json'), 'utf8'));
    for (const key of Object.keys(settings)) if (MODES.includes(raw?.[key])) settings[key] = raw[key];
  } catch { /* missing or invalid file: defaults */ }
  return settings;
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
      },
    };
    states.set(project.root, state);
    return state;
  };

  if (tool === 'EnterWorktree' || ((tool === 'Task' || tool === 'Agent') && input.isolation === 'worktree')) {
    const state = stateFor(cwd);
    if (state && settings.worktrees !== 'allow') {
      emit(settings.worktrees === 'ask' ? 'ask' : 'deny', `branch-guard: this project works on a single branch ('${state.workflow === 'shared-dev' ? 'dev' : state.trunk}'); worktrees create stray branches. Run without worktree isolation. Rules: AGENTS.md → Git flow.`);
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
    const result = decide(op, state);
    state.current = result.current;
    decisions.push(result);
  }
  const { decision, reason } = combine(decisions);
  emit(decision, reason);
} catch { /* A guard that breaks must never break the session: fail open. */ }
process.exit(0);
