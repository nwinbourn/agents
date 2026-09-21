#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugin');
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
assert.equal(marketplace.plugins[0].source, './plugin');
assert.equal(manifest.version, marketplace.metadata.version);
assert.equal(readFileSync(join(plugin, 'LICENSE'), 'utf8'), readFileSync(join(root, 'LICENSE'), 'utf8'));
assert.deepEqual(readdirSync(plugin).sort(), ['.claude-plugin', 'LICENSE', 'commands', 'docs', 'hooks', 'skills', 'templates'].sort());
const sandbox = mkdtempSync(join(tmpdir(), 'agents-package-'));
try {
  const installed = join(sandbox, 'plugin');
  cpSync(plugin, installed, { recursive: true });
  assert(!existsSync(join(installed, 'tests')));
  assert(!existsSync(join(installed, 'node_modules')));
  const config = JSON.parse(readFileSync(join(installed, 'hooks/hooks.json'), 'utf8'));
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) for (const hook of group.hooks) {
      const match = hook.command.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\n]+)"$/);
      assert(match, 'Hook must resolve from the installed plugin root');
      assert(existsSync(join(installed, match[1])), `Missing hook: ${match[1]}`);
    }
  }
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir,e.name)) : [join(dir,e.name)]);
  for (const file of walk(installed).filter(p => p.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', file]);
  console.log('Packaging checks passed; running suites against plugin/ copied in isolation.');
  const env = { ...process.env, AGENTS_HOOKS: join(installed, 'hooks') };
  for (const suite of ['core.mjs', 'memory-loader.mjs', 'verifier.mjs', 'branch-guard.mjs', 'branch-guard-override.mjs', 'harness/run.mjs']) {
    execFileSync(process.execPath, [join(root, 'tests', suite)], { env, stdio: 'inherit', timeout: 180000 });
  }
} finally {
  // sandbox is an absolute path allocated specifically for this test run.
  rmSync(sandbox, { recursive: true, force: true });
}
