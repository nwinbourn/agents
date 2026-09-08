// Additional integration checks; all state is temporary, never the user's harness.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../../plugin/hooks');
const homes = [];
let passed = 0;
const home = (mode = 'on') => {
  const p = mkdtempSync(join(tmpdir(), 'harness-improvements-'));
  homes.push(p);
  if (mode) { mkdirSync(join(p, 'harness')); writeFileSync(join(p, 'harness/mode'), mode); }
  return p;
};
const opts = p => ({ env: { ...process.env, HARNESS_HOME: p }, encoding: 'utf8', timeout: 15000 });
const run = (p, file, input = {}) => execFileSync(process.execPath, [join(HOOKS, file)], { ...opts(p), input: JSON.stringify(input) });
const task = model => ({ tool_name: 'Task', tool_input: { model } });
const status = p => JSON.parse(run(p, 'harness-status.mjs'));
const check = async (name, fn) => { await fn(); passed++; };
try {
  await check('concurrent dispatches preserve every attempt and threshold', async () => {
    const p = home();
    // execFile's async form does not supply stdin input; use a short wrapper.
    const wrapper = `import { addAndCheck } from ${JSON.stringify(pathToFileURL(join(HOOKS, 'lib/harness-counter.mjs')).href)}; import { loadConfig } from ${JSON.stringify(pathToFileURL(join(HOOKS, 'lib/harness-config.mjs')).href)}; console.log(JSON.stringify(addAndCheck({fable:1},loadConfig())));`;
    const results = await Promise.all(Array.from({ length: 32 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', wrapper], opts(p))));
    assert.equal(status(p).burst.tiers.fable, 32);
    assert.equal(results.filter(r => JSON.parse(r.stdout).exceeded.length).length, 29);
    assert.equal(status(p).lockPresent, false);
    assert(!readdirSync(join(p, 'harness')).some(f => f.endsWith('.tmp')));
  });
  await check('existing lock times out silently without stealing ownership', () => {
    const p = home();
    mkdirSync(join(p, 'harness/counts.json.lock'));
    const start = Date.now();
    assert.equal(run(p, 'harness-dispatch.mjs', task('fable')), '');
    assert(Date.now() - start < 7000);
    assert.equal(status(p).lockPresent, true);
    assert(status(p).recentIssues.some(i => i.code === 'lock-timeout'));
    assert(!existsSync(join(p, 'harness/counts.json')));
  });
  await check('failed state write releases owned lock and stays silent', () => {
    const p = home();
    mkdirSync(join(p, 'harness/counts.json'));
    assert.equal(run(p, 'harness-dispatch.mjs', task('fable')), '');
    assert.equal(status(p).lockPresent, false);
    assert(status(p).recentIssues.some(i => i.code === 'update-failed'));
  });
  await check('status while off creates no state', () => {
    const p = home(null);
    assert.equal(status(p).mode, 'off');
    assert.deepEqual(readdirSync(p), []);
  });
  await check('status expires counts without rewriting files', () => {
    const p = home();
    const f = join(p, 'harness/counts.json');
    const text = JSON.stringify({ windowStart: 1, tiers: { fable: 9 } });
    writeFileSync(f, text);
    const mtime = statSync(f).mtimeMs;
    assert.equal(status(p).burst.state, 'expired');
    assert.deepEqual(status(p).burst.tiers, {});
    assert.equal(readFileSync(f, 'utf8'), text);
    assert.equal(statSync(f).mtimeMs, mtime);
  });
  await check('bad cap overrides fall back and still ask', () => {
    const p = home();
    writeFileSync(join(p, 'harness.json'), JSON.stringify({ caps: { fable: '100', opus: -2, sonnet: null }, capWindowSeconds: -1 }));
    assert.deepEqual(status(p).caps, { fable: 3, opus: 15, sonnet: 30 });
    for (let n = 0; n < 3; n++) assert.equal(run(p, 'harness-dispatch.mjs', task('fable')), '');
    assert.equal(JSON.parse(run(p, 'harness-dispatch.mjs', task('fable'))).hookSpecificOutput.permissionDecision, 'ask');
  });
  await check('unrecognized models are silent and inspectable without raw input', () => {
    const p = home();
    assert.equal(run(p, 'harness-dispatch.mjs', task('private-model-name')), '');
    const s = status(p);
    assert(s.recentIssues.some(i => i.code === 'unrecognized-model'));
    assert(!JSON.stringify(s).includes('private-model-name'));
  });
  await check('unknown workflow options are silent and inspectable', () => {
    const p = home();
    assert.equal(run(p, 'harness-workflow.mjs', { tool_name: 'Workflow', tool_input: { script: "agent('private prompt', buildOptions())" } }), '');
    assert(status(p).recentIssues.some(i => i.code === 'uncounted-model-site'));
    assert(!JSON.stringify(status(p)).includes('private prompt'));
  });
  await check('malformed counter is recovered with diagnostic', () => {
    const p = home();
    writeFileSync(join(p, 'harness/counts.json'), JSON.stringify({ windowStart: Date.now(), tiers: { fable: 'bad' } }));
    assert.equal(run(p, 'harness-dispatch.mjs', task('fable')), '');
    assert.equal(status(p).burst.tiers.fable, 1);
    assert(status(p).recentIssues.some(i => i.code === 'state-reset'));
  });
  await check('workflow prompt does not claim runtime concurrency', () => {
    const p = home();
    const r = JSON.parse(run(p, 'harness-workflow.mjs', { tool_input: { script: "await agent('x',{model:'fable'});".repeat(4) } }));
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /written agent call sites/);
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /concurrency is unknown/);
  });
  console.log(`${passed} additional harness checks passed`);
} finally {
  // Every target is an absolute path returned by mkdtempSync under tmpdir().
  for (const p of homes) rmSync(p, { recursive: true, force: true });
}
