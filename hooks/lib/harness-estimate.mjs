// harness-estimate — cost estimation and the tally.
//
// Two jobs:
//   1. Estimate what a dispatch or a fan-out will cost, so the harness can warn
//      before a big burst instead of policing worker counts.
//   2. Read/append the tally at <harness>/tally.md — the measured record that both
//      calibrates the estimator and feeds the kill-switch metric in `/harness status`.
//
// Boot tax = the fixed cost every worker re-pays: system prompt + tool schemas
// (unmeasurable, a constant) plus the project's CLAUDE.md @import chain (measured
// by walking it). This is the number that decides whether a task is even worth
// delegating — a worker cheaper than its own boot cost should run inline.
//
// The estimator LEARNS: once the tally has enough real token counts for a
// (tier, agentType) pair it uses the user's own median instead of a shipped
// default. Median, not mean — real tally data has 5x outliers.
//
// bytes/4 ≈ tokens is deliberately crude. Refining it past ~15% buys nothing a
// permission prompt would act on.

import { readFileSync, existsSync, statSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { paths, tierOf } from "./harness-config.mjs";

// ---- boot tax --------------------------------------------------------------

/**
 * Measure the boot tax for a worker launched with cwd `projectDir`: the global
 * ~/.claude/CLAUDE.md plus the project CLAUDE.md and its @import chain (depth 3),
 * divided by bytesPerToken, plus the baseBootTokens constant for the unmeasurable
 * system-prompt/tool-schema part. `agentType` "Explore" halves the doc component
 * (lean subagents don't ingest the full project memory).
 */
export function bootTax(projectDir, cfg, agentType) {
  const bpt = cfg.bytesPerToken || 4;
  let bytes = 0;
  const seen = new Set();
  const walk = (file, depth) => {
    if (depth > 3 || seen.has(file)) return;
    seen.add(file);
    let text;
    try {
      if (!existsSync(file)) return;
      bytes += statSync(file).size;
      if (depth === 3) return;
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    for (const m of text.matchAll(/^@([^\s].*)$/gm)) {
      walk(resolve(dirname(file), m[1].trim()), depth + 1);
    }
  };
  try {
    walk(join(homedir(), ".claude", "CLAUDE.md"), 1); // global loader, counts but isn't walked for @imports here
  } catch {}
  try {
    walk(join(projectDir, "CLAUDE.md"), 0);
  } catch {}
  let docTokens = Math.round(bytes / bpt);
  if (String(agentType) === "Explore") docTokens = Math.round(docTokens / 2);
  return (cfg.baseBootTokens || 12000) + docTokens;
}

// ---- typical-run estimate (learned or default) -----------------------------

/**
 * Estimate a single worker's output (excluding boot tax) for a (tier, agentType).
 * Returns { tokens, provenance } where provenance is "learned (n=N)" or "default".
 * "Explore" agentType always maps to the Explore default/learned bucket.
 */
export function typicalRun(tier, agentType, cfg, tallyRows) {
  const key = String(agentType) === "Explore" ? "Explore" : tier === "cheap" ? "cheap" : tier === "expensive" ? "expensive" : "unknown";

  if (cfg.learnFromTally && Array.isArray(tallyRows)) {
    const samples = tallyRows
      .filter((r) => Number.isFinite(r.tokens))
      .filter((r) => (key === "Explore" ? r.agentType === "Explore" : bucketOfRow(r, cfg) === key))
      .map((r) => r.tokens);
    if (samples.length >= (cfg.minSamplesToLearn || 5)) {
      return { tokens: median(samples), provenance: `learned (n=${samples.length})` };
    }
  }
  return { tokens: cfg.defaultEstimates[key] ?? cfg.defaultEstimates.unknown, provenance: "default" };
}

function bucketOfRow(row, cfg) {
  if (row.agentType === "Explore") return "Explore";
  const t = tierOf(row.model, cfg);
  return t === "cheap" ? "cheap" : t === "expensive" ? "expensive" : "unknown";
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---- the tally -------------------------------------------------------------

const TALLY_HEADER =
  "# harness tally (auto-written by hooks/harness-settle.mjs)\n" +
  "# localdate · project · tier · agentType · tokens · description\n" +
  "# `rework` lines are appended by the orchestrator when delegated work needed redoing.\n";

/** Local YYYY-MM-DD — NOT UTC. A row written at 11pm local belongs to today, not tomorrow. */
export function localDate(d = new Date()) {
  return d.toLocaleDateString("en-CA"); // en-CA renders as YYYY-MM-DD, zero deps
}

/** Parse the tally, bounded to the last `maxBytes` and `days`. Returns [{date, project, model, agentType, tokens|NaN, desc}]. */
export function readTally(cfg, { maxBytes = 200000, days = 30, now = new Date() } = {}) {
  const { tally } = paths();
  let text;
  try {
    if (!existsSync(tally)) return [];
    const size = statSync(tally).size;
    const fd = readFileSync(tally, "utf8");
    text = size > maxBytes ? fd.slice(fd.length - maxBytes) : fd;
  } catch {
    return [];
  }
  const cutoff = new Date(now.getTime() - days * 86400000);
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(" · ");
    if (parts.length < 5) continue;
    const [date, project, model, agentType, tokRaw] = parts.map((p) => p.trim());
    if (model === "rework") continue; // rework lines aren't cost samples
    // Date filter (string compare works for YYYY-MM-DD); tolerate unparseable dates by keeping them.
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < localDate(cutoff)) continue;
    const m = /(\d+)/.exec(tokRaw || "");
    rows.push({ date, project, model, agentType, tokens: m ? parseInt(m[1], 10) : NaN, desc: parts.slice(5).join(" · ") });
  }
  return rows;
}

/** Append one tally row. Creates the file with a header if missing. */
export function appendTally({ project, tier, agentType, tokens, desc }) {
  const { dir, tally } = paths();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(tally)) writeFileSync(tally, TALLY_HEADER);
    const tok = Number.isFinite(tokens) ? `${tokens} tok` : "? tok";
    const line = `${localDate()} · ${project} · ${tier} · ${agentType} · ${tok} · ${String(desc ?? "").replace(/\s+/g, " ").slice(0, 60)}\n`;
    appendFileSync(tally, line);
  } catch {
    /* never block on tally write */
  }
}

// ---- token extraction from a tool response ---------------------------------

/**
 * Pull a token count out of a subagent's tool_response, whatever shape it takes.
 * Order: walk the parsed object for any key ending in "tokens" (output/total/
 * subagent), else fall back to response-text length / bytesPerToken — which is
 * actually the metric we care about (what landed in the main context). Returns a
 * finite number or NaN.
 */
export function extractTokens(toolResponse, cfg) {
  if (toolResponse == null) return NaN;

  // 1. Structured: find the most specific *_tokens key anywhere in the object.
  const found = { output: NaN, total: NaN, other: NaN };
  const visit = (v, depth) => {
    if (depth > 6 || v == null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "number" && /tokens?$/i.test(k)) {
        if (/output/i.test(k)) found.output = val;
        else if (/total/i.test(k)) found.total = val;
        else if (Number.isNaN(found.other)) found.other = val;
      } else if (val && typeof val === "object") {
        visit(val, depth + 1);
      }
    }
  };
  try {
    visit(typeof toolResponse === "string" ? JSON.parse(toolResponse) : toolResponse, 0);
  } catch {
    /* not JSON — fall through to text length */
  }
  if (Number.isFinite(found.output)) return found.output;
  if (Number.isFinite(found.total)) return found.total;
  if (Number.isFinite(found.other)) return found.other;

  // 2. Fallback: bytes of the response text / bytesPerToken.
  const bpt = cfg?.bytesPerToken || 4;
  const text = typeof toolResponse === "string" ? toolResponse : safeStringify(toolResponse);
  if (text && text.length > 0) return Math.round(text.length / bpt);
  return NaN;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

// ---- formatting ------------------------------------------------------------

/** 1234567 → "1.2M", 47000 → "47k", 800 → "800". */
export function fmt(n) {
  if (!Number.isFinite(n)) return "?";
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}
