// harness-config — load + validate ~/.claude/harness.json, apply defaults.
//
// Every harness hook calls loadConfig() first. It returns null when the file is
// absent or unreadable, and a config object with `enabled:false` is treated the
// same as absent by callers: silent, no state written. A stranger who installs
// the plugin and never runs `/harness on` pays one node spawn per dispatch and
// nothing else.
//
// HARNESS_HOME overrides the state directory (used by tests). Everything lives
// under <home>/harness/ except the config file itself, which sits at
// <home>/harness.json next to the other ~/.claude top-level config files.
//
// Zero dependencies. Any throw here must be caught by the caller and turned into
// a silent exit — this module never decides to block anything.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  enabled: false,
  askThresholdTokens: 400000,
  dailyAdvisoryTokens: 3000000,
  burstWindowSeconds: 120,
  reuseWindowMinutes: 45,
  baseBootTokens: 12000,
  bytesPerToken: 4,
  defaultEstimates: {
    Explore: 60000,
    cheap: 200000,
    expensive: 120000,
    unknown: 150000,
  },
  learnFromTally: true,
  minSamplesToLearn: 5,
  expensiveModels: ["opus", "fable"],
  cheapModels: ["sonnet", "haiku"],
  tallyWhenDisabled: false,
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
    ledger: join(dir, "fleet.json"),
    tally: join(dir, "tally.md"),
    coreOverride: join(home, "harness-core.md"),
  };
}

/** Shallow-merge user values over DEFAULTS; nested objects (defaultEstimates) merge one level. */
function withDefaults(raw) {
  const cfg = { ...DEFAULTS, ...raw };
  cfg.defaultEstimates = { ...DEFAULTS.defaultEstimates, ...(raw.defaultEstimates || {}) };
  // Coerce the tier lists to lowercase arrays so comparisons are case-insensitive.
  cfg.expensiveModels = (Array.isArray(cfg.expensiveModels) ? cfg.expensiveModels : DEFAULTS.expensiveModels).map((m) => String(m).toLowerCase());
  cfg.cheapModels = (Array.isArray(cfg.cheapModels) ? cfg.cheapModels : DEFAULTS.cheapModels).map((m) => String(m).toLowerCase());
  return cfg;
}

/**
 * Load config. Returns null if the file doesn't exist or can't be parsed — the
 * caller then exits silently. A present-but-partial file is merged over defaults.
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

/**
 * True when the harness should DO something this invocation. Enabled config, or
 * a config with tallyWhenDisabled for shadow-mode measurement. Returns the config
 * (truthy) or null so callers can `const cfg = activeConfig(); if (!cfg) exit`.
 * @param {"inject"|"measure"} need — "inject" wants enabled; "measure" also accepts shadow mode.
 */
export function activeConfig(need = "inject") {
  const cfg = loadConfig();
  if (!cfg) return null;
  if (cfg.enabled) return cfg;
  if (need === "measure" && cfg.tallyWhenDisabled) return cfg;
  return null;
}

/** Classify a model name into "expensive" | "cheap" | "unknown" using the config's tier lists. */
export function tierOf(model, cfg) {
  const m = String(model ?? "").toLowerCase();
  if (!m || m === "inherit") return "inherit"; // caller resolves via transcript
  if (cfg.cheapModels.includes(m)) return "cheap";
  if (cfg.expensiveModels.includes(m)) return "expensive";
  return "unknown";
}
