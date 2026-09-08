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
  await test('shared workflow: creating anything but dev is denied, wip/ asks', () => {
    const dir = shared();
    for (const c of ['git checkout -b feature', 'git switch -c feature', 'git branch feature', 'git worktree add ../tree', 'git checkout feature', 'git switch feature']) {
      assert.equal(decision(sh(dir, c)), 'deny', c);
    }
    assert.match(reason(sh(dir, 'git switch -c feature')), /'dev' is the only working branch/);
    assert.equal(decision(sh(dir, 'git switch -c wip/noah-conflict')), 'ask');
    assert.equal(decision(sh(dir, 'git push origin wip/noah-conflict')), 'ask');
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
    assert.deepEqual(analyzeCommand(['git', '-C', '../x', 'switch', '-c', 'feat']), { kind: 'create', target: 'feat', cwd: '../x' });
    assert.deepEqual(analyzeCommand(['git', 'push', 'origin', 'dev:main']), { kind: 'push', force: false, remove: false, all: false, targets: ['main'], usesCurrent: false });
    assert.equal(analyzeCommand(['npm', 'test']), null);
    assert.equal(analyzeCommand(['git', 'branch', '--list']), null);
  });
  console.log(`${passed} branch guard checks passed`);
} finally {
  // Only this run's freshly allocated temp root is removed.
  rmSync(base, { recursive: true, force: true });
}
