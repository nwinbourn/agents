import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../plugin/hooks');
const base = mkdtempSync(join(tmpdir(), 'agents-core-'));
const userHome = join(base, 'isolated-home');
mkdirSync(userHome);
const env = { ...process.env, HOME: userHome, USERPROFILE: userHome,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(userHome, 'gitconfig'),
  GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
let passed = 0;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
  { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim();
const write = (dir, name, text) => { const p = join(dir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
const folder = () => { const p = mkdtempSync(join(base, 'project-')); return p; };
const hook = (file, cwd, input = {}) => {
  const out = execFileSync(process.execPath, [join(HOOKS, file)], { cwd, env, input: JSON.stringify({ cwd, ...input }), encoding: 'utf8', timeout: 15000 });
  return out.trim() ? JSON.parse(out) : null;
};
const context = r => r?.hookSpecificOutput?.additionalContext || '';
const check = (name, fn) => { fn(); passed++; console.log(`  PASS ${name}`); };
function repository() {
  const dir = folder();
  git(dir, 'init', '-b', 'main');
  write(dir, 'STATE.md', '# State\n\n## Start here\n\n**Do this first:** inspect app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n');
  write(dir, 'CONTEXT.md', '# Context\nA test project.\n');
  write(dir, 'app.txt', 'initial\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'Initial fixture');
  return dir;
}
function shared() {
  const writer = repository();
  const origin = join(folder(), 'origin.git');
  git(writer, 'init', '--bare', origin);
  git(writer, 'remote', 'add', 'origin', origin);
  git(writer, 'push', '-u', 'origin', 'main');
  git(writer, 'switch', '-c', 'dev');
  git(writer, 'push', '-u', 'origin', 'dev');
  const client = join(folder(), 'client');
  git(writer, 'clone', '--branch', 'dev', origin, client);
  return { writer, origin, client };
}
function publish(writer, name = 'remote.txt') {
  write(writer, name, 'work from collaborator\n');
  git(writer, 'add', name); git(writer, 'commit', '-m', 'Collaborator work'); git(writer, 'push', 'origin', 'dev');
}
const arm = dir => hook('wrap-up-arm.mjs', dir, { tool_name: 'Skill', tool_input: { skill: 'agents:wrap-up' } });
const bloat = dir => hook('wrap-up-bloat-check.mjs', dir);
const handoff = '# State\n\n## Start here\n\n**Do this first:** inspect app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n';

try {
  check('memory: unadopted projects are untouched', () => {
    const dir = folder(); write(dir, 'app.txt', 'x');
    assert.equal(hook('state-reminder.mjs', dir), null);
    assert.deepEqual(readdirSync(dir), ['app.txt']);
  });
  check('memory: a newer project file triggers one reminder', () => {
    const dir = folder(); const state = write(dir, 'STATE.md', '# State');
    const old = new Date(Date.now() - 10000); utimesSync(state, old, old);
    write(dir, 'app.txt', 'changed');
    assert.equal(hook('state-reminder.mjs', dir).decision, 'block');
    assert.equal(hook('state-reminder.mjs', dir, { stop_hook_active: true }), null);
    const newer = new Date(Date.now() + 1000); utimesSync(state, newer, newer);
    assert.equal(hook('state-reminder.mjs', dir), null);
  });
  check('memory: docs/STATE.md is supported and build output is ignored', () => {
    const dir = folder(); const state = write(dir, 'docs/STATE.md', '# State');
    const old = new Date(Date.now() - 10000); utimesSync(state, old, old);
    write(dir, 'node_modules/generated.txt', 'generated');
    write(dir, 'dist/bundle.js', 'generated');
    assert.equal(hook('state-reminder.mjs', dir), null);
    write(dir, 'src/app.txt', 'source');
    assert.equal(hook('state-reminder.mjs', dir).decision, 'block');
  });
  check('memory: deletions alone illustrate the mtime limitation', () => {
    const dir = folder(); write(dir, 'app.txt', 'old'); write(dir, 'STATE.md', '# State');
    rmSync(join(dir, 'app.txt'));
    assert.equal(hook('state-reminder.mjs', dir), null);
  });
  check('wrap-up: ordinary skills do not arm a check', () => {
    const dir = folder(); write(dir, 'STATE.md', 'line\n'.repeat(710));
    hook('wrap-up-arm.mjs', dir, { tool_name: 'Skill', tool_input: { skill: 'agents:voice' } });
    assert.equal(bloat(dir), null);
  });
  check('wrap-up: namespaced skill arms a one-shot bloat check', () => {
    const dir = folder(); write(dir, 'STATE.md', 'line\n'.repeat(710));
    arm(dir); assert.equal(bloat(dir).decision, 'block'); assert.equal(bloat(dir), null);
  });
  check('wrap-up: a branch session armed in its own folder is checked back in the project folder', () => {
    const dir = repository(); write(dir, 'STATE.md', 'line\n'.repeat(710)); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'Long state');
    const tree = join(dir, '.claude', 'worktrees', 'mobile-nav'); git(dir, 'worktree', 'add', tree, '-b', 'feature/mobile-nav');
    arm(tree); assert.equal(bloat(dir).decision, 'block'); assert.equal(bloat(dir), null);
  });
  check('wrap-up: lean state with a usable handoff passes after invocation', () => {
    const dir = folder(); write(dir, 'STATE.md', handoff + '\n## What\'s next\n\n1. inspect app.\n');
    arm(dir); assert.equal(bloat(dir), null);
  });
  check('wrap-up: a missing or vague Start here block is flagged once', () => {
    const dir = folder(); write(dir, 'STATE.md', '# State\nNext: inspect app.\n');
    arm(dir); const r = bloat(dir); assert.equal(r.decision, 'block'); assert.match(r.reason, /Start here/); assert.equal(bloat(dir), null);
    write(dir, 'STATE.md', handoff.replace('inspect app.txt', 'Continue the redesign'));
    arm(dir); assert.match(bloat(dir).reason, /file, route or command/);
  });
  check('wrap-up: changelog lines and facts duplicated from CONTEXT.md are flagged', () => {
    const dir = folder(); const fact = 'The checkout service retries three times before it gives up on a payment.';
    write(dir, 'CONTEXT.md', `# Context\n\n${fact}\n`);
    write(dir, 'STATE.md', `${handoff}\n## Notes\n\n- 2026-09-01 we added the retry loop\n${fact}\n\n<!-- we fixed nothing here: comments are ignored -->\n`);
    arm(dir); const r = bloat(dir); assert.equal(r.decision, 'block');
    assert.match(r.reason, /line 11: dated entry/); assert.match(r.reason, /line 12: duplicated in CONTEXT.md/); assert(!/line 14/.test(r.reason));
    assert.equal(bloat(dir), null);
  });
  check('wrap-up: large growth against committed state prompts compaction', () => {
    const dir = repository();
    write(dir, 'STATE.md', 'open item\n'.repeat(520));
    arm(dir); assert.equal(bloat(dir).decision, 'block');
  });
  check('wrap-up: an over-guidance file that did not get shorter is flagged once, a trimmed one passes', () => {
    const dir = folder(); write(dir, 'STATE.md', handoff); write(dir, 'CONTEXT.md', 'fact\n'.repeat(320));
    arm(dir); const r = bloat(dir); assert.equal(r.decision, 'block');
    assert.match(r.reason, /CONTEXT.md is 320 lines against a guidance of 300 and did not get shorter during this wrap-up \(320 when it started\)/);
    assert(!/STATE.md is \d+ lines/.test(r.reason)); assert.equal(bloat(dir), null);
    arm(dir); write(dir, 'CONTEXT.md', 'fact\n'.repeat(310)); assert.equal(bloat(dir), null);
    arm(dir); write(dir, 'CONTEXT.md', 'fact\n'.repeat(330)); assert.match(bloat(dir).reason, /330 lines against a guidance of 300/);
  });
  check('wrap-up: PITFALLS entries need the Trap, Tell, Fix shape', () => {
    const dir = folder(); write(dir, 'STATE.md', handoff);
    write(dir, 'PITFALLS.md', '# Pitfalls\n\n## The dev page looks broken after a hot reload\n\nA long story about what happened.\nIt kept going.\n');
    arm(dir); const r = bloat(dir); assert.equal(r.decision, 'block'); assert.match(r.reason, /PITFALLS.md: 1 of 1 entries/); assert.match(r.reason, /The dev page looks broken/);
    write(dir, 'PITFALLS.md', '# Pitfalls\n\n## Group\n\n### The dev page looks broken after a hot reload\n\n**Trap:** stale closures.\n**Tell:** a control that did nothing.\n**Fix:** reload before diagnosing.\n');
    arm(dir); assert.equal(bloat(dir), null);
  });
  check('wrap-up: Start here holds the three fields and nothing else', () => {
    const dir = folder(); write(dir, 'STATE.md', handoff + '\n> ALL WORK HAPPENS ON dev\n\n```bash\nnpm run dev\n```\n');
    arm(dir); const r = bloat(dir); assert.equal(r.decision, 'block'); assert.match(r.reason, /holds 2 lines beyond the three fields/); assert.equal(bloat(dir), null);
  });
  check('wrap-up: expired markers are consumed without prompting', () => {
    const dir = folder(); write(dir, 'STATE.md', 'line\n'.repeat(710)); arm(dir);
    const markerDir = join(userHome, '.claude/hooks/.wrapup-armed');
    for (const file of readdirSync(markerDir)) {
      const p = join(markerDir, file); const m = JSON.parse(readFileSync(p, 'utf8'));
      if (m.projectDir === dir) { m.armedAt = Date.now() - 31 * 60 * 1000; writeFileSync(p, JSON.stringify(m)); }
    }
    assert.equal(bloat(dir), null); assert.equal(bloat(dir), null);
  });
  check('hooks: malformed event shapes exit silently', () => {
    const dir = folder();
    for (const file of ['git-sync.mjs', 'state-reminder.mjs', 'wrap-up-arm.mjs', 'wrap-up-bloat-check.mjs']) {
      for (const raw of ['null', '[]', '{', '{"cwd":42}']) {
        assert.equal(execFileSync(process.execPath, [join(HOOKS, file)], { cwd: dir, env, input: raw, encoding: 'utf8' }), '');
      }
    }
  });
  check('git: repositories without origin/dev stay on main', () => {
    const dir = repository(); assert.equal(hook('git-sync.mjs', dir), null);
    assert.equal(git(dir, 'branch', '--show-current'), 'main');
    assert.equal(git(dir, 'branch', '--list', 'dev'), '');
  });
  check('handoff: committed memory and work reach the next clean dev session', () => {
    const { writer, client } = shared();
    write(writer, 'STATE.md', '# State\n\n## Start here\n\n**Do this first:** review app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n');
    write(writer, 'app.txt', 'ready for review\n');
    arm(writer); assert.equal(bloat(writer), null);
    git(writer, 'add', 'STATE.md', 'app.txt'); git(writer, 'commit', '-m', 'Handoff fixture'); git(writer, 'push', 'origin', 'dev');
    const r = hook('git-sync.mjs', client);
    assert.equal(git(client, 'rev-parse', 'HEAD'), git(writer, 'rev-parse', 'HEAD'));
    assert.equal(readFileSync(join(client, 'STATE.md'), 'utf8'), readFileSync(join(writer, 'STATE.md'), 'utf8'));
    assert.equal(readFileSync(join(client, 'app.txt'), 'utf8'), 'ready for review\n');
    assert.equal(git(client, 'status', '--porcelain'), '');
    assert.match(context(r), /re-read STATE.md/);
  });
  check('git: dirty work is preserved instead of pulling', () => {
    const { writer, client } = shared(); publish(writer);
    write(client, 'app.txt', 'local unsaved work\n'); const before = git(client, 'rev-parse', 'HEAD');
    const r = hook('git-sync.mjs', client);
    assert.equal(git(client, 'rev-parse', 'HEAD'), before);
    assert.equal(readFileSync(join(client, 'app.txt'), 'utf8'), 'local unsaved work\n');
    assert.match(context(r), /did NOT pull/);
  });
  check('git: diverged branches never auto-merge or rebase', () => {
    const { writer, client } = shared(); publish(writer);
    write(client, 'local.txt', 'local'); git(client, 'add', '.'); git(client, 'commit', '-m', 'Local work');
    const before = git(client, 'rev-parse', 'HEAD'); const r = hook('git-sync.mjs', client);
    assert.equal(git(client, 'rev-parse', 'HEAD'), before);
    assert(!existsSync(join(client, '.git/MERGE_HEAD')));
    assert.match(context(r), /diverged/);
  });
  check('git: wrong branch warns without switching or altering main', () => {
    const { writer, client } = shared(); git(client, 'switch', '-c', 'main', 'origin/main'); publish(writer);
    const before = git(client, 'rev-parse', 'HEAD'); const r = hook('git-sync.mjs', client);
    assert.equal(git(client, 'branch', '--show-current'), 'main');
    assert.equal(git(client, 'rev-parse', 'HEAD'), before);
    assert.match(context(r), /not the shared working branch/);
  });
  check('git: on dev the agent asks straight-on-dev or a branch; a branch session is told it merges back', () => {
    const { client } = shared();
    assert.match(context(hook('git-sync.mjs', client)), /Before the first change, ask the user: straight on dev, or a branch off dev\?/);
    writeFileSync(join(client, '.git', 'info', 'exclude'), '.claude/worktrees/\n');
    const tree = join(client, '.claude', 'worktrees', 'mobile-nav'); git(client, 'worktree', 'add', tree, '-b', 'feature/mobile-nav', 'dev');
    const r = context(hook('git-sync.mjs', tree));
    assert.match(r, /On branch 'feature\/mobile-nav', in its own folder, made off 'dev'/);
    assert(!/Do NOT switch branches/.test(r) && !/Before the first change/.test(r));
    assert.equal(git(tree, 'branch', '--show-current'), 'feature/mobile-nav');
  });
  check('git: unpushed local work is reported but not pushed', () => {
    const { writer, client } = shared(); const before = git(writer, 'rev-parse', 'origin/dev');
    write(client, 'local.txt', 'local'); git(client, 'add', '.'); git(client, 'commit', '-m', 'Local only');
    assert.match(context(hook('git-sync.mjs', client)), /unpushed work/);
    assert.equal(git(writer, 'ls-remote', 'origin', 'refs/heads/dev').split(/\s/)[0], before);
  });
  check('git: unavailable remote reports stale sync information', () => {
    const { client } = shared(); const before = git(client, 'rev-parse', 'HEAD');
    git(client, 'remote', 'set-url', 'origin', join(base, 'missing.git'));
    assert.match(context(hook('git-sync.mjs', client)), /could not reach the remote/);
    assert.equal(git(client, 'rev-parse', 'HEAD'), before);
  });
  check('git: compaction events do not fetch or change the checkout', () => {
    const { writer, client } = shared(); publish(writer); const before = git(client, 'rev-parse', 'HEAD');
    assert.equal(hook('git-sync.mjs', client, { source: 'compact' }), null);
    assert.equal(git(client, 'rev-parse', 'HEAD'), before);
  });
  console.log(`${passed} core workflow checks passed`);
} finally {
  // base is the absolute, freshly allocated temp directory for this run only.
  rmSync(base, { recursive: true, force: true });
}
