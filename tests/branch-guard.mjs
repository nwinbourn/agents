import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../plugin/hooks');
const base = mkdtempSync(join(tmpdir(), 'agents-guard-'));
const home = join(base, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'CLAUDE_PROJECT_DIR']) delete env[key];
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
  { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim();
const write = (dir, name, text) => { const p = join(dir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
const folder = () => mkdtempSync(join(base, 'project-'));
const state = '# State\n\n## Start here\n\n**Do this first:** inspect app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n';
function local(memory = true) {
  const dir = folder(); git(dir, 'init', '-b', 'main'); write(dir, 'app.txt', 'initial\n');
  if (memory) { write(dir, 'STATE.md', state); write(dir, 'CONTEXT.md', '# Context\n'); }
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'Fixture'); return dir;
}
function shared() {
  const dir = local(); const origin = join(folder(), 'origin.git');
  git(dir, 'init', '--bare', origin); git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main'); git(dir, 'switch', '-c', 'dev'); git(dir, 'push', '-u', 'origin', 'dev');
  return dir;
}
function hook(cwd, toolName, toolInput) {
  const out = execFileSync(process.execPath, [join(HOOKS, 'branch-guard.mjs')],
    { cwd, env, input: JSON.stringify({ cwd, tool_name: toolName, tool_input: toolInput }), encoding: 'utf8', timeout: 15000 });
  return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
}
const sh = (cwd, command, tool = 'Bash') => hook(cwd, tool, { command });
const ignoreWorktrees = dir => writeFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/worktrees/\n');
const decision = r => r?.permissionDecision ?? 'allow';
const reason = r => r?.permissionDecisionReason ?? '';
const snapshot = dir => ({ branch: git(dir, 'branch', '--show-current'), branches: git(dir, 'branch', '--list'), head: git(dir, 'rev-parse', 'HEAD'), status: git(dir, 'status', '--porcelain') });
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS ${name}`); };

try {
  await test('unadopted repositories are untouched', () => {
    const dir = local(false);
    for (const c of ['git checkout -b feature', 'git switch -c x', 'git worktree add ../x', 'git commit -m x', 'git push origin main']) assert.equal(sh(dir, c), null, c);
    assert.equal(hook(dir, 'EnterWorktree', {}), null);
    assert.equal(hook(dir, 'Agent', { isolation: 'worktree', prompt: 'x' }), null);
  });
  await test('local workflow: task branches and worktrees are denied, dev asks, the rest is silent', () => {
    const dir = local();
    for (const c of ['git checkout -b feature', 'git checkout -B feature', 'git switch -c feature', 'git switch --create feature',
      'git branch feature', 'git branch -c feature', 'git stash branch feature', 'git checkout --orphan docs', 'git worktree add ../tree',
      'git checkout -t origin/feature', 'git checkout feature', 'git switch feature']) {
      assert.equal(decision(sh(dir, c)), 'deny', c);
    }
    assert.match(reason(sh(dir, 'git checkout -b feature')), /works directly on 'main'/);
    ignoreWorktrees(dir);
    for (const c of ['git switch -c feature/mobile-nav', 'git branch fix/footer', 'git worktree add .claude/worktrees/x -b feature/x main']) {
      assert.equal(decision(sh(dir, c)), 'deny', c); // task branches are a dev-project thing only
    }
    assert.equal(decision(sh(dir, 'git checkout -b dev')), 'ask');
    assert.equal(decision(sh(dir, 'git switch -c dev')), 'ask');
    for (const c of ['git commit -m x', 'git push origin main', 'git merge other', 'git rebase main', 'git reset --hard', 'git branch -d feature',
      'git branch', 'git branch -a', 'git branch --list', 'git branch -vv', 'git status', 'git checkout main', 'git switch main',
      'git checkout -- app.txt', 'git checkout app.txt', 'git checkout HEAD~0 -- app.txt', 'git log --oneline', 'gh pr merge 1']) {
      assert.equal(sh(dir, c), null, c);
    }
  });
  await test('worktree tools are denied in adopted projects', () => {
    const dir = local();
    assert.equal(decision(hook(dir, 'EnterWorktree', {})), 'deny');
    assert.equal(decision(hook(dir, 'Agent', { isolation: 'worktree', prompt: 'x' })), 'deny');
    assert.equal(decision(hook(dir, 'Task', { isolation: 'worktree', prompt: 'x' })), 'deny');
    assert.equal(hook(dir, 'Agent', { prompt: 'x' }), null);
    assert.equal(hook(dir, 'Agent', { isolation: 'remote', prompt: 'x' }), null);
  });
  await test('shared workflow on dev: normal work is silent', () => {
    const dir = shared();
    for (const c of ['git commit -m x', 'git push', 'git push origin dev', 'git push -u origin dev', 'git push origin HEAD', 'git push origin HEAD:dev',
      'git merge origin/dev', 'git fetch origin dev', 'git status', 'git switch dev', 'git checkout dev', 'git checkout -- app.txt',
      'git reset --soft HEAD~1', 'git branch --list', 'git stash', 'git stash pop', 'git merge --abort', 'git rebase --abort',
      'git push --tags', 'git push origin refs/tags/v1', 'git add . && git commit -m "save" && git push origin dev']) {
      assert.equal(sh(dir, c), null, c);
    }
  });
  await test('shared workflow: names other than dev, wip/ and feature/ or fix/ are denied, wip/ asks', () => {
    const dir = shared();
    for (const c of ['git checkout -b feature', 'git switch -c feature', 'git branch feature', 'git worktree add ../tree', 'git checkout feature', 'git switch feature',
      'git branch claude/unhidden-work-page-867d9f', 'git branch feat/mobile-nav', 'git branch feature/', 'git branch Feature/Mobile_Nav']) {
      assert.equal(decision(sh(dir, c)), 'deny', c);
    }
    assert.match(reason(sh(dir, 'git switch -c feature')), /not a branch this project uses/);
    assert.equal(decision(sh(dir, 'git switch -c wip/noah-conflict')), 'ask');
    assert.equal(decision(sh(dir, 'git push origin wip/noah-conflict')), 'ask');
  });
  await test('shared workflow: a feature/ or fix/ branch opens off dev in its own folder, with the user\'s approval', () => {
    const dir = shared(); ignoreWorktrees(dir);
    for (const c of ['git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav dev',
      'git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav origin/dev',
      'git worktree add -b fix/footer-links .claude/worktrees/footer-links',
      'git branch feature/mobile-nav', 'git branch feature/mobile-nav dev']) {
      assert.equal(decision(sh(dir, c)), 'ask', c);
    }
    assert.equal(decision(sh(dir, 'git worktree add .claude\\worktrees\\footer-links -b fix/footer-links dev', 'PowerShell')), 'ask');
    assert.match(reason(sh(dir, 'git branch feature/mobile-nav')), /open a new branch 'feature\/mobile-nav' off 'dev'/);
    for (const c of ['git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav main', 'git branch feature/mobile-nav main',
      'git switch -c feature/mobile-nav', 'git checkout -b fix/footer-links', 'git stash branch fix/footer-links',
      'git worktree add ../mobile-nav -b feature/mobile-nav dev', 'git worktree add .claude/worktrees/x --detach',
      'git worktree add .claude/worktrees/mobile-nav', 'git worktree add .claude/worktrees/x -b claude/x-867d9f dev']) {
      assert.equal(decision(sh(dir, c)), 'deny', c);
    }
    assert.match(reason(sh(dir, 'git switch -c feature/mobile-nav')), /gets its own folder/);
    assert.match(reason(sh(dir, 'git branch feature/mobile-nav main')), /must be made off 'dev'/);
    assert.match(reason(sh(dir, 'git worktree add ../mobile-nav -b feature/mobile-nav dev')), /live in \.claude\/worktrees/);
  });
  await test('shared workflow: a branch folder Git would not ignore is refused until it is excluded', () => {
    const dir = shared(); const c = 'git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav dev';
    assert.equal(decision(sh(dir, c)), 'deny');
    assert.match(reason(sh(dir, c)), /not ignored by Git/);
    ignoreWorktrees(dir);
    assert.equal(decision(sh(dir, c)), 'ask');
    assert.equal(decision(sh(join(dir, '..'), `git -C "${dir}" worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav dev`)), 'ask');
  });
  await test('shared workflow: inside a task branch folder, work and syncing with dev are silent', () => {
    const dir = shared(); ignoreWorktrees(dir);
    const tree = join(dir, '.claude', 'worktrees', 'mobile-nav');
    git(dir, 'worktree', 'add', tree, '-b', 'feature/mobile-nav', 'dev');
    for (const c of ['git commit -m x', 'git merge dev', 'git merge origin/dev', 'git merge --no-edit -m "sync" origin/dev', 'git merge --continue',
      `git -C "${dir}" merge --ff-only feature/mobile-nav`, `git -C "${dir}" push origin dev`,
      `git -C "${dir}" worktree remove .claude/worktrees/mobile-nav`, `git -C "${dir}" branch -d feature/mobile-nav`]) {
      assert.equal(sh(tree, c), null, c);
    }
    for (const c of ['git merge main', 'git push origin feature/mobile-nav', 'git switch main', `git -C "${dir}" branch -D feature/mobile-nav`]) {
      assert.equal(decision(sh(tree, c)), 'ask', c);
    }
    assert.equal(decision(sh(tree, 'git switch -c feature/other')), 'deny');
    assert.equal(decision(sh(tree, 'git worktree add .claude/worktrees/other -b feature/other dev')), 'deny'); // would nest inside this folder
    assert.equal(decision(sh(tree, `git worktree add "${join(dir, '.claude', 'worktrees', 'other')}" -b feature/other dev`)), 'ask');
    assert.equal(decision(sh(dir, 'git switch feature/mobile-nav')), 'deny');
    assert.match(reason(sh(dir, 'git checkout feature/mobile-nav')), /lives in its own folder/);
    git(dir, 'worktree', 'remove', tree);
    assert.equal(sh(dir, 'git worktree add .claude/worktrees/mobile-nav feature/mobile-nav'), null);
    assert.match(reason(sh(dir, 'git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav dev')), /already exists/);
  });
  await test('EnterWorktree: entering an existing folder is silent; making one without a name is refused', () => {
    const dir = shared();
    assert.equal(hook(dir, 'EnterWorktree', { path: join(dir, '.claude', 'worktrees', 'mobile-nav') }), null);
    assert.equal(decision(hook(dir, 'EnterWorktree', { name: 'mobile-nav' })), 'deny');
    assert.match(reason(hook(dir, 'EnterWorktree', {})), /feature\/<task> or fix\/<task> made off 'dev'/);
    assert.match(reason(hook(dir, 'Agent', { isolation: 'worktree', prompt: 'x' })), /without isolation/);
  });
  await test('shared workflow: a fresh clone on main may create local dev from origin', () => {
    const dir = shared(); const clone = join(folder(), 'clone');
    git(dir, 'clone', '--branch', 'main', git(dir, 'remote', 'get-url', 'origin'), clone);
    assert.equal(git(clone, 'branch', '--list', 'dev'), '');
    for (const c of ['git switch dev', 'git checkout dev', 'git checkout -b dev origin/dev', 'git switch -c dev --track origin/dev', 'git checkout --track origin/dev']) {
      assert.equal(sh(clone, c), null, c);
    }
  });
  await test('shared workflow: leaving dev asks, and main is the release path', () => {
    const dir = shared();
    for (const c of ['git checkout main', 'git switch main', 'git switch -', 'git checkout HEAD~0', 'git checkout --detach', 'git switch --detach']) {
      assert.equal(decision(sh(dir, c)), 'ask', c);
    }
    assert.match(reason(sh(dir, 'git checkout main')), /release/);
    for (const c of ['git push origin main', 'git push origin dev:main', 'git push origin HEAD:main', 'git push origin +dev:main', 'git push --all',
      'git push --force origin dev', 'git push -f origin dev', 'git push --force-with-lease origin dev', 'git push origin :feature',
      'git push origin --delete feature', 'git rebase origin/dev', 'git reset --hard origin/dev', 'git branch -d feature', 'git branch -D feature',
      'git branch -m dev main', 'gh pr merge 1 --squash']) {
      assert.equal(decision(sh(dir, c)), 'ask', c);
    }
  });
  await test('shared workflow: commits off dev are denied, merges into main ask', () => {
    const dir = shared(); git(dir, 'switch', 'main');
    for (const c of ['git commit -m x', 'git commit --amend --no-edit', 'git cherry-pick dev', 'git revert HEAD']) assert.equal(decision(sh(dir, c)), 'deny', c);
    assert.match(reason(sh(dir, 'git commit -m x')), /commits go on 'dev'/);
    assert.equal(decision(sh(dir, 'git merge dev')), 'ask');
    assert.equal(decision(sh(dir, 'git push')), 'ask');
    assert.equal(decision(sh(dir, 'git push origin main')), 'ask');
    assert.equal(sh(dir, 'git cherry-pick --abort'), null);
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), git(dir, 'rev-parse', 'dev') + '\n');
    assert.equal(decision(sh(dir, 'git commit -m "merge dev"')), 'ask');
    assert.equal(decision(sh(dir, 'git merge --continue')), 'ask');
  });
  await test('chains are followed: a release sequence asks once, a stray-branch chain is denied', () => {
    const dir = shared();
    const release = sh(dir, 'git checkout main && git merge dev && git push origin main');
    assert.equal(decision(release), 'ask');
    assert.match(reason(release), /release/);
    assert.equal(decision(sh(dir, 'git checkout main && git commit -m x')), 'deny');
    assert.equal(decision(sh(dir, 'git switch -c feature && git commit -m x && git push -u origin feature')), 'deny');
    assert.equal(sh(dir, 'git fetch origin dev; git merge origin/dev; git push origin dev'), null);
  });
  await test('quoted text, heredocs and comments do not trigger the guard', () => {
    const dir = shared();
    for (const c of [
      'git commit -m "docs: never run git checkout -b feature; use dev"',
      "git commit -m 'note; git switch -c x'",
      "cat > doc.md <<'EOF'\n# Flow\nRun: git checkout -b feature\ngit push origin main\nEOF\ngit status",
      'cat <<EOF > notes.txt\n  git worktree add ../x\nEOF',
      'echo "git push origin main"',
      'grep -n "git checkout -b" README.md',
      '# git checkout -b comment\ngit status',
    ]) assert.equal(sh(dir, c), null, JSON.stringify(c));
  });
  await test('PowerShell commands and git wrappers are analyzed the same way', () => {
    const dir = shared();
    assert.equal(decision(sh(dir, 'git checkout -b feature; git status', 'PowerShell')), 'deny');
    assert.equal(decision(sh(dir, 'if ($?) { git push origin main }', 'PowerShell')), 'ask');
    assert.equal(decision(sh(dir, '& "C:\\Program Files\\Git\\bin\\git.exe" switch -c feature', 'PowerShell')), 'deny');
    assert.equal(decision(sh(dir, 'GIT_TRACE=1 git checkout -b feature')), 'deny');
    assert.equal(decision(sh(dir, 'git -c core.autocrlf=false checkout -b feature')), 'deny');
    assert.equal(decision(sh(dir, 'git --no-pager checkout -b feature')), 'deny');
    assert.equal(decision(sh(dir, 'git checkout -b feature > out.txt 2>&1')), 'deny');
    assert.equal(decision(sh(dir, 'npm test && git switch -c feature')), 'deny');
  });
  await test('the checked directory follows cd, git -C and subfolders', () => {
    const adopted = shared(); const plain = local(false);
    assert.equal(sh(adopted, `git -C "${plain}" checkout -b feature`), null);
    assert.equal(decision(sh(plain, `git -C "${adopted}" checkout -b feature`)), 'deny');
    assert.equal(decision(sh(plain, `cd "${adopted}" && git checkout -b feature`)), 'deny');
    mkdirSync(join(adopted, 'src'));
    assert.equal(decision(sh(join(adopted, 'src'), 'git switch -c feature')), 'deny');
  });
  await test('the guard never changes the repository', () => {
    const dir = shared(); const before = snapshot(dir);
    sh(dir, 'git checkout -b feature'); sh(dir, 'git checkout main && git merge dev && git push origin main'); sh(dir, 'git worktree add ../tree');
    assert.deepEqual(snapshot(dir), before);
    assert(!existsSync(join(dir, '..', 'tree')));
  });
  await test('personal settings soften the refusals for other people', () => {
    const dir = shared(); const settings = join(home, '.claude', 'branch-guard.json'); mkdirSync(dirname(settings), { recursive: true });
    try {
      writeFileSync(settings, JSON.stringify({ taskBranches: 'ask', worktrees: 'allow' }));
      assert.equal(decision(sh(dir, 'git checkout -b feature')), 'ask');
      assert.equal(sh(dir, 'git worktree add ../tree'), null);
      assert.equal(hook(dir, 'EnterWorktree', {}), null);
      assert.equal(decision(sh(dir, 'git commit -m x && git push origin main')), 'ask');
      writeFileSync(settings, JSON.stringify({ taskBranches: 'allow', worktrees: 'ask' }));
      assert.equal(sh(dir, 'git switch -c feature'), null);
      assert.equal(decision(hook(dir, 'Agent', { isolation: 'worktree', prompt: 'x' })), 'ask');
      writeFileSync(settings, '{not json');
      assert.equal(decision(sh(dir, 'git switch -c feature')), 'deny');
      writeFileSync(settings, JSON.stringify({ taskBranches: 'whatever' }));
      assert.equal(decision(sh(dir, 'git switch -c feature')), 'deny');
    } finally { rmSync(settings, { force: true }); }
  });
  await test('force-deleting a branch or force-removing a worktree asks in every mode', () => {
    const dir = local();
    assert.equal(sh(dir, 'git branch -d feature'), null);
    assert.equal(sh(dir, 'git worktree remove ../tree'), null);
    assert.equal(sh(dir, 'git worktree prune'), null);
    for (const c of ['git branch -D feature', 'git branch --delete --force feature', 'git branch -df feature', 'git worktree remove --force ../tree', 'git worktree remove -f ../tree']) {
      assert.equal(decision(sh(dir, c)), 'ask', c);
    }
    assert.match(reason(sh(dir, 'git branch -D feature')), /discards any commits/);
    const team = shared();
    assert.match(reason(sh(team, 'git branch -D feature')), /discards any commits/);
    assert.equal(sh(team, 'git branch -d feature/mobile-nav'), null); // -d refuses unmerged work on its own
    assert.equal(decision(sh(team, 'git branch -D feature/mobile-nav')), 'ask');
    assert.equal(decision(sh(team, 'git worktree remove --force ../tree')), 'ask');
    assert.equal(sh(team, 'git worktree remove ../tree'), null);
  });
  await test('malformed events exit silently', () => {
    const dir = shared();
    for (const raw of ['', 'null', '[]', '{', '{"cwd":42}', '{"tool_name":"Bash"}', '{"tool_name":"Bash","tool_input":"git checkout -b x"}', '{"tool_name":"Bash","tool_input":{"command":42}}']) {
      const out = execFileSync(process.execPath, [join(HOOKS, 'branch-guard.mjs')], { cwd: dir, env, input: raw, encoding: 'utf8' });
      assert.equal(out, '', raw);
    }
  });
  await test('command splitting keeps quotes, heredocs and separators straight', async () => {
    const { splitCommands, analyzeCommand } = await import(pathToFileURL(join(HOOKS, 'lib/branch-policy.mjs')).href);
    assert.deepEqual(splitCommands('git commit -m "a; b && c" && git push'), [['git', 'commit', '-m', 'a; b && c'], ['git', 'push']]);
    assert.deepEqual(splitCommands("cat <<'EOF'\ngit checkout -b x\nEOF\ngit status"), [['cat'], ['git', 'status']]);
    assert.deepEqual(splitCommands('echo $(git rev-parse HEAD) | tee log > out 2>&1'), [['echo', '$'], ['git', 'rev-parse', 'HEAD'], ['tee', 'log']]);
    assert.deepEqual(splitCommands('git -C C:\\repo status', { powershell: true }), [['git', '-C', 'C:\\repo', 'status']]);
    assert.deepEqual(analyzeCommand(['git', '-C', '../x', 'switch', '-c', 'feat']), { kind: 'create', target: 'feat', inPlace: true, cwd: '../x' });
    assert.deepEqual(analyzeCommand(['git', 'worktree', 'add', '--lock', '--reason', 'x y', '.claude/worktrees/a', '-b', 'feature/a', 'dev']),
      { kind: 'worktree', path: '.claude/worktrees/a', start: 'dev', create: 'feature/a', detach: false, orphan: false });
    assert.deepEqual(analyzeCommand(['git', 'merge', '--no-ff', '-m', 'msg', 'origin/dev']), { kind: 'merge', sources: ['origin/dev'] });
    assert.deepEqual(analyzeCommand(['git', 'push', 'origin', 'dev:main']), { kind: 'push', force: false, remove: false, all: false, targets: ['main'], usesCurrent: false });
    assert.equal(analyzeCommand(['npm', 'test']), null);
    assert.equal(analyzeCommand(['git', 'branch', '--list']), null);
  });
  console.log(`${passed} branch guard checks passed`);
} finally {
  // Only this run's freshly allocated temp root is removed.
  rmSync(base, { recursive: true, force: true });
}
