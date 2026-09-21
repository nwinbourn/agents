import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../plugin/hooks');
const base = mkdtempSync(join(tmpdir(), 'agents-override-'));
const home = join(base, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'CLAUDE_PROJECT_DIR']) delete env[key];

const OVERRIDE_FILE = join(home, '.claude', 'branch-guard-override.json');
const OVERRIDE = join(HOOKS, 'branch-guard-override.mjs');

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
function shared({ onMain = false } = {}) {
  const dir = local(); const origin = join(folder(), 'origin.git');
  git(dir, 'init', '--bare', origin); git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main'); git(dir, 'switch', '-c', 'dev'); git(dir, 'push', '-u', 'origin', 'dev');
  if (onMain) git(dir, 'switch', 'main');
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
const cli = (...args) => execFileSync(process.execPath, [OVERRIDE, ...args], { env, encoding: 'utf8', timeout: 15000 }).trim();
const arm = (dir, ...extra) => cli('arm', '--project', dir, ...extra);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  PASS ${name}`); };

try {
  await test('baseline: without an override the guard still refuses a commit off dev', () => {
    const dir = shared({ onMain: true });
    assert.equal(decision(sh(dir, 'git commit -m x')), 'deny');
    assert(!existsSync(OVERRIDE_FILE), 'no override file should exist yet');
  });

  await test('armed: the commit-off-dev refusal becomes a prompt carrying the reason', () => {
    const dir = shared({ onMain: true });
    try {
      assert.match(arm(dir), /ARMED/);
      const r = sh(dir, 'git commit -m x');
      assert.equal(decision(r), 'ask');
      assert.match(reason(r), /commits go on 'dev'/);       // original reason preserved
      assert.match(reason(r), /override is active for this project/); // and the override note
    } finally { cli('clear'); }
  });

  await test('armed: task-branch and worktree creation also downgrade to a prompt', () => {
    const dir = shared();
    try {
      arm(dir);
      for (const c of ['git switch -c feature', 'git checkout -b feature', 'git branch feature', 'git worktree add ../tree']) {
        assert.equal(decision(sh(dir, c)), 'ask', c);
      }
      assert.equal(decision(hook(dir, 'EnterWorktree', {})), 'ask');
      assert.equal(decision(hook(dir, 'Agent', { isolation: 'worktree', prompt: 'x' })), 'ask');
    } finally { cli('clear'); }
  });

  await test('armed: prompts stay prompts and silent operations stay silent', () => {
    const dir = shared({ onMain: true });
    try {
      arm(dir);
      const push = sh(dir, 'git push origin main');
      assert.equal(decision(push), 'ask');
      assert.match(reason(push), /release/);                 // unchanged release prompt
      assert.doesNotMatch(reason(push), /override is active/); // not a downgraded refusal
      git(dir, 'switch', 'dev');
      assert.equal(sh(dir, 'git commit -m x'), null);        // committing on dev is still silent
      assert.equal(sh(dir, 'git status'), null);
    } finally { cli('clear'); }
  });

  await test('scope: an override armed for one project does not touch another', () => {
    const a = shared({ onMain: true });
    const b = shared({ onMain: true });
    try {
      arm(a);
      assert.equal(decision(sh(a, 'git commit -m x')), 'ask');
      assert.equal(decision(sh(b, 'git commit -m x')), 'deny'); // b is untouched
    } finally { cli('clear'); }
  });

  await test('an unadopted repository stays untouched even with an override armed', () => {
    const plain = local(false);
    arm(plain);
    try {
      for (const c of ['git commit -m x', 'git checkout -b feature', 'git worktree add ../x']) assert.equal(sh(plain, c), null, c);
    } finally { cli('clear'); }
  });

  await test('an expired override is ignored and deleted; the refusal stands', () => {
    const dir = shared({ onMain: true });
    arm(dir);
    const token = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8'));
    token.expiresAt = Date.now() - 1000;
    writeFileSync(OVERRIDE_FILE, JSON.stringify(token));
    assert.equal(decision(sh(dir, 'git commit -m x')), 'deny');
    assert(!existsSync(OVERRIDE_FILE), 'expired override should be removed');
  });

  await test('a corrupt override file fails safe: the guard enforces normally', () => {
    const dir = shared({ onMain: true });
    mkdirSync(dirname(OVERRIDE_FILE), { recursive: true });
    try {
      writeFileSync(OVERRIDE_FILE, '{ not json');
      assert.equal(decision(sh(dir, 'git commit -m x')), 'deny');
    } finally { rmSync(OVERRIDE_FILE, { force: true }); }
  });

  await test('clear turns the guard back on; status reports both states', () => {
    const dir = shared({ onMain: true });
    arm(dir);
    assert.match(cli('status', '--project', dir), /ACTIVE/);
    assert.equal(decision(sh(dir, 'git commit -m x')), 'ask');
    assert.match(cli('clear'), /CLEARED/);
    assert.match(cli('status', '--project', dir), /OFF/);
    assert.equal(decision(sh(dir, 'git commit -m x')), 'deny');
  });

  await test('arm scopes the token to the git root and honors --minutes', () => {
    const dir = shared();
    try {
      arm(dir, '--minutes', '45');
      const token = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8'));
      assert.equal(resolve(token.project), resolve(git(dir, 'rev-parse', '--show-toplevel')));
      const minutes = Math.round((token.expiresAt - token.armedAt) / 60000);
      assert.equal(minutes, 45);
    } finally { cli('clear'); }
  });

  await test('the override never changes the repository', () => {
    const dir = shared({ onMain: true });
    try {
      arm(dir);
      const before = { branch: git(dir, 'branch', '--show-current'), head: git(dir, 'rev-parse', 'HEAD'), status: git(dir, 'status', '--porcelain') };
      sh(dir, 'git commit -m x'); sh(dir, 'git switch -c feature'); sh(dir, 'git worktree add ../tree');
      assert.deepEqual({ branch: git(dir, 'branch', '--show-current'), head: git(dir, 'rev-parse', 'HEAD'), status: git(dir, 'status', '--porcelain') }, before);
    } finally { cli('clear'); }
  });

  console.log(`${passed} branch guard override checks passed`);
} finally {
  rmSync(base, { recursive: true, force: true });
}
