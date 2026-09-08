#!/usr/bin/env node
// Explicit status command, never wired as a hook. Read-only, including when off.
import { existsSync } from 'node:fs';
import { activeMode, loadConfig, paths } from './lib/harness-config.mjs';
import { readCounts } from './lib/harness-counter.mjs';
import { readIssues } from './lib/harness-diagnostics.mjs';
try {
  const cfg = loadConfig();
  const counts = readCounts(cfg);
  process.stdout.write(JSON.stringify({
    mode: activeMode(), harnessHome: paths().home, scope: 'global: shared across projects and sessions using this harness home',
    caps: cfg.caps, capWindowSeconds: cfg.capWindowSeconds,
    burst: counts, lockPresent: existsSync(paths().counts + '.lock'),
    recentIssues: readIssues(),
    workers: 'Not tracked by hooks; use the runtime worker list and current session task state.',
    limitations: 'Dispatch attempts, including denied attempts; not active concurrency. Workflow call sites are checked separately. Issues are historical, not current health.'
  }, null, 2) + '\n');
} catch { process.stdout.write(JSON.stringify({ status: 'unavailable' }) + '\n'); }
