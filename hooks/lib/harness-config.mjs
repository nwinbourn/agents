// harness-config — the harness's single switch and its few knobs.
//
// The switch is ~/.claude/harness/mode: "on", "agents", or anything else means
// off. `/harness on|off|agents` writes it; every hook reads it first and exits
// silently when off. One state, one file — there is no enable flag anywhere
// else, and a legacy `enabled` field in harness.json is ignored.
//
// ~/.claude/harness.json is OPTIONAL and only overrides the knobs below (caps,
// burst window, model-name lists). Missing or corrupt → defaults, so a mangled
// override file can never take the guardrail down.
//
// HARNESS_HOME overrides the state directory (used by tests). Zero dependencies;
// every throw here is caught by the caller and turned into a silent exit.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  expensiveModels: ["opus", "fable"],
  cheapModels: ["sonnet", "haiku"],
  // Per-tier parallel fan-out caps — the harness's one interruption. MORE than
  // this many workers of a tier inside one burst window becomes a permission
  // prompt; the user decides, the harness never blocks on its own. haiku is
  // deliberately uncapped.
  caps: { fable: 3, opus: 15, sonnet: 30 },
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
    mode: join(dir, "mode"), // "on" | "agents" | anything else = off
    counts: join(dir, "counts.json"), // rolling per-tier fan-out counter
    coreOverride: join(home, "harness-core.md"),
  };
}

/** "on" | "agents" | "off". Missing file or anything unrecognized → "off". */
export function activeMode() {
  try {
    const m = readFileSync(paths().mode, "utf8").trim().toLowerCase();
    return m === "on" || m === "agents" ? m : "off";
  } catch {
    return "off";
  }
}

/** DEFAULTS merged with the optional ~/.claude/harness.json overrides. */
export function loadConfig() {
  let raw = {};
  try {
    const { config } = paths();
    if (existsSync(config)) {
      const parsed = JSON.parse(readFileSync(config, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
    }
  } catch {
    /* corrupt overrides → defaults; the guardrail stays up */
  }
  const cfg = { ...DEFAULTS, ...raw };
  const list = (v, fb) => (Array.isArray(v) ? v : fb).map((m) => String(m).toLowerCase());
  cfg.expensiveModels = list(cfg.expensiveModels, DEFAULTS.expensiveModels);
  cfg.cheapModels = list(cfg.cheapModels, DEFAULTS.cheapModels);
  cfg.caps = { ...DEFAULTS.caps, ...(raw.caps && typeof raw.caps === "object" ? raw.caps : {}) };
  if (!Number.isFinite(cfg.capWindowSeconds) || cfg.capWindowSeconds <= 0) cfg.capWindowSeconds = DEFAULTS.capWindowSeconds;
  delete cfg.enabled; // legacy field from pre-0.8 — the mode file is the only switch
  return cfg;
}

/** Config (with `mode` set) when the harness is on or in agents mode; null when off. */
export function activeConfig() {
  const mode = activeMode();
  if (mode === "off") return null;
  const cfg = loadConfig();
  cfg.mode = mode;
  return cfg;
}
