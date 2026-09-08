// Counts dispatch attempts in a fixed burst window, not live workers.
// Includes denied attempts; workflows are checked separately. Fail-open on I/O errors.
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { paths } from './harness-config.mjs';
import { recordIssue } from './harness-diagnostics.mjs';

export function readCounts(cfg, now = Date.now()) {
  try {
    const c = JSON.parse(readFileSync(paths().counts, 'utf8'));
    if (!Number.isFinite(c.windowStart) || !c.tiers || Array.isArray(c.tiers) || typeof c.tiers !== 'object') throw Error('invalid state');
    if (Object.values(c.tiers).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('invalid count');
    const expired = now < c.windowStart || now - c.windowStart >= cfg.capWindowSeconds * 1000;
    return { windowStart: expired ? now : c.windowStart, tiers: expired ? {} : c.tiers, state: expired ? 'expired' : 'current' };
  } catch (e) {
    return { windowStart: now, tiers: {}, state: e.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

export function addAndCheck(additions, cfg) {
  const { dir, counts } = paths();
  const lock = counts + '.lock';
  let held = false;
  let tmp;
  try {
    mkdirSync(dir, { recursive: true });
    const deadline = performance.now() + 1500;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!held) {
      try { mkdirSync(lock); held = true; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (performance.now() >= deadline) {
          recordIssue('counter', 'lock-timeout');
          return { totals: {}, exceeded: [] };
        }
        Atomics.wait(pause, 0, 0, 10);
      }
    }
    // Never reclaim a lock by age: a paused owner could still resume and write.
    // Sample after acquiring the lock: waiters can acquire out of arrival order.
    const state = readCounts(cfg);
    if (state.state === 'unreadable') recordIssue('counter', 'state-reset');
    for (const [tier, n] of Object.entries(additions)) {
      if (!Number.isSafeInteger(n) || n < 0) throw Error('invalid addition');
      if (!n) continue;
      const total = (Object.hasOwn(state.tiers, tier) ? state.tiers[tier] : 0) + n;
      if (!Number.isSafeInteger(total)) throw Error('count overflow');
      Object.defineProperty(state.tiers, tier, { value: total, enumerable: true, configurable: true, writable: true });
    }
    tmp = counts + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify({ windowStart: state.windowStart, tiers: state.tiers }));
    renameSync(tmp, counts);
    const exceeded = Object.entries(state.tiers).flatMap(([tier, count]) => {
      const cap = cfg.caps?.[tier];
      return Number.isFinite(cap) && count > cap ? [{ tier, count, cap }] : [];
    });
    return { totals: state.tiers, exceeded };
  } catch {
    recordIssue('counter', 'update-failed');
    return { totals: {}, exceeded: [] };
  } finally {
    if (tmp) { try { unlinkSync(tmp); } catch {} }
    if (held) { try { rmdirSync(lock); } catch { recordIssue('counter', 'lock-release-failed'); } }
  }
}
