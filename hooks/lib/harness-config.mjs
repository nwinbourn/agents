// harness-config — load ~/.claude/harness.json and resolve the harness's paths.
//
// The harness has exactly three jobs: reuse existing workers, route work to the
// right model tier, and (in `agents` mode) dispatch in the background while the
// user keeps talking. None of them need much configuration — the only knob that
// matters is which model names count as your top tier.
//
// Silent when the file is absent or `enabled` is false. A user who installs the
// plugin and never runs `/harness agents` pays one node spawn per turn and
// nothing else.
//
// HARNESS_HOME overrides the state directory (used by tests). Zero dependencies;
// every throw here is caught by the caller and turned into a silent exit.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  enabled: true,
  expensiveModels: ["opus", "fable"],
  cheapModels: ["sonnet", "haiku"],
  // Per-tier fan-out caps. A fan-out that would put MORE than this many workers
  // of a tier in flight within one burst window turns into a permission prompt —
  // the user decides, the harness never blocks on its own. Keyed by model name,
  // so a custom tier is capped by adding its name here.
  caps: { fable: 3, opus: 15, sonnet: 30, haiku: 30 },
  // Dispatches within this many seconds count as one fan-out for the caps. A
  // paced sequence spread wider than this never accumulates — it isn't a burst.
  capWindowSeconds: 120,
};

/** The ~/.claude directory (or HARNESS_HOME), where harness.json and harness/ live. */
export function harnessHome() {
  return process.env.HARNESS_HOME || join(homedir(), ".claude");
}

/** Absolute paths for every file the harness touches. */
export function paths() {
  const home = harnessHome();
  const dir = join(home, "harness");
  return {
    home,
    dir,
    config: join(home, "harness.json"),
    mode: join(dir, "mode"), // `/harness agents` writes the active posture here
    counts: join(dir, "counts.json"), // rolling per-tier fan-out counter
    coreOverride: join(home, "harness-core.md"),
  };
}

function withDefaults(raw) {
  const cfg = { ...DEFAULTS, ...raw };
  const list = (v, fallback) => (Array.isArray(v) ? v : fallback).map((m) => String(m).toLowerCase());
  cfg.expensiveModels = list(cfg.expensiveModels, DEFAULTS.expensiveModels);
  cfg.cheapModels = list(cfg.cheapModels, DEFAULTS.cheapModels);
  cfg.caps = { ...DEFAULTS.caps, ...(raw.caps && typeof raw.caps === "object" ? raw.caps : {}) };
  if (!Number.isFinite(cfg.capWindowSeconds) || cfg.capWindowSeconds <= 0) cfg.capWindowSeconds = DEFAULTS.capWindowSeconds;
  return cfg;
}

/**
 * Load config. Returns null when the file is missing or unparseable — the caller
 * then exits silently. A present-but-partial file merges over the defaults.
 */
export function loadConfig() {
  const { config } = paths();
  try {
    if (!existsSync(config)) return null;
    const raw = JSON.parse(readFileSync(config, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return withDefaults(raw);
  } catch {
    return null;
  }
}

/** The config if the harness should act this invocation, else null. */
export function activeConfig() {
  const cfg = loadConfig();
  return cfg && cfg.enabled ? cfg : null;
}

/** "expensive" | "cheap" | "unknown" | "inherit" (no model set — caller resolves). */
export function tierOf(model, cfg) {
  const m = String(model ?? "").toLowerCase();
  if (!m || m === "inherit") return "inherit";
  if (cfg.cheapModels.some((c) => m.includes(c))) return "cheap";
  if (cfg.expensiveModels.some((e) => m.includes(e))) return "expensive";
  return "unknown";
}
