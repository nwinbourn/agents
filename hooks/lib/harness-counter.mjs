// harness-counter — a rolling per-tier count of dispatched workers.
//
// The one piece of state the caps need: how many workers of each tier have been
// launched in the current burst. A "burst" is just dispatches inside a time
// window; once the window goes stale the count resets, so a paced sequence never
// accumulates into a false alarm — only an actual fan-out does.
//
// This deliberately does NOT track completions. The previous ledger tried to,
// and a review showed SubagentStop can't say which worker stopped, so the count
// drifted. Counting launches within a window needs none of that: it never
// decrements, so there's nothing to get wrong. Worst case a lost read-modify-
// write race means the prompt fires at 16 instead of 15 — harmless for a guard.
//
// Zero dependencies, atomic writes, fail-open: any throw leaves the caller to
// treat it as "no cap tripped" rather than blocking a dispatch.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { paths } from "./harness-config.mjs";

function load(now, windowMs) {
  try {
    const c = JSON.parse(readFileSync(paths().counts, "utf8"));
    if (!c || typeof c !== "object") throw new Error("bad");
    if (typeof c.windowStart !== "number" || now - c.windowStart > windowMs) {
      return { windowStart: now, tiers: {} }; // stale window → fresh burst
    }
    return { windowStart: c.windowStart, tiers: c.tiers && typeof c.tiers === "object" ? c.tiers : {} };
  } catch {
    return { windowStart: now, tiers: {} };
  }
}

function save(state) {
  const { dir, counts } = paths();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = counts + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, counts);
}

/**
 * Add `additions` ({tier: n, …}) to the current window and persist. Returns
 * { totals, exceeded } where totals is the per-tier count after adding and
 * exceeded is [{tier, count, cap}] for every tier now over its cap.
 *
 * A tier with no cap configured is counted but never flagged. Fail-open: on any
 * error returns empty totals and no exceedances, so the caller does nothing.
 */
export function addAndCheck(additions, cfg, now) {
  try {
    const windowMs = (cfg.capWindowSeconds || 120) * 1000;
    const state = load(now, windowMs);
    for (const [tier, n] of Object.entries(additions)) {
      if (!n) continue;
      state.tiers[tier] = (state.tiers[tier] || 0) + n;
    }
    save(state);

    const exceeded = [];
    for (const [tier, count] of Object.entries(state.tiers)) {
      const cap = cfg.caps?.[tier];
      if (Number.isFinite(cap) && count > cap) exceeded.push({ tier, count, cap });
    }
    return { totals: state.tiers, exceeded };
  } catch {
    return { totals: {}, exceeded: [] };
  }
}
