#!/usr/bin/env node
/**
 * harness-workflow — PreToolUse hook on the Workflow tool.
 *
 * A workflow script's agent() calls are dispatched inside the tool, so the
 * per-dispatch hook never sees them. This is the only chance to cost a scripted
 * fan-out before it runs: statically scan the script, resolve each site's model,
 * and total it up.
 *
 * The estimate is a FLOOR, always labelled as one — a site inside a loop
 * dispatches many times, and no static read can know how many.
 *
 * Missing `model` follows the same escalating policy as harness-dispatch:
 * measured from the session's own transcript, silent when inheriting is correct
 * (cheap main loop), a note when it isn't, an ask only when the total is already
 * past threshold. It NEVER denies. The predecessor denied here, which was right
 * for one machine that was always Opus and wrong for anyone else.
 *
 * Verdict "unknown" (opts by reference, spread, helper-built) is always allowed
 * with at most a note — the scanner cannot read those, and a false positive that
 * wedges a valid workflow is worse than the tokens it would save.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { activeConfig, tierOf } from "./lib/harness-config.mjs";
import { analyzeScript } from "./lib/workflow-scan.mjs";
import { bootTax, typicalRun, readTally, fmt } from "./lib/harness-estimate.mjs";

function emit(context, decision, reason) {
  const out = { hookSpecificOutput: { hookEventName: "PreToolUse" } };
  if (context) out.hookSpecificOutput.additionalContext = context;
  if (decision) {
    out.hookSpecificOutput.permissionDecision = decision;
    out.hookSpecificOutput.permissionDecisionReason = reason;
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function sessionModel(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const size = statSync(transcriptPath).size;
    const want = Math.min(size, 65536);
    const buf = Buffer.alloc(want);
    const fd = openSync(transcriptPath, "r");
    try {
      readSync(fd, buf, 0, want, size - want);
    } finally {
      closeSync(fd);
    }
    let last = null;
    for (const m of buf.toString("utf8").matchAll(/"model"\s*:\s*"([^"]+)"/g)) last = m[1];
    return last ? last.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normalizeModel(raw, cfg) {
  const m = String(raw || "").toLowerCase();
  for (const name of [...cfg.expensiveModels, ...cfg.cheapModels]) {
    if (m.includes(name)) return name;
  }
  return null;
}

try {
  const cfg = activeConfig("inject");
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  const input = evt.tool_input ?? {};

  // A saved workflow invoked by name carries no script — its definition isn't
  // this session's to police.
  if (!input.script && !input.scriptPath) process.exit(0);

  let src = input.script;
  if (typeof src !== "string" && input.scriptPath) {
    try {
      src = readFileSync(String(input.scriptPath), "utf8");
    } catch {
      process.exit(0);
    }
  }
  if (typeof src !== "string" || !src.trim()) process.exit(0);

  const sites = analyzeScript(src);
  if (!sites.length) process.exit(0);

  const cwd = evt.cwd || process.cwd();
  const tally = readTally(cfg);

  // Resolve what a site with no explicit model would inherit.
  const inherited = normalizeModel(sessionModel(evt.transcript_path), cfg);
  const inheritedTier = inherited ? tierOf(inherited, cfg) : "unknown";

  let total = 0;
  const missing = [];
  const unreadable = [];
  const byTier = { expensive: 0, cheap: 0, unknown: 0 };

  for (const s of sites) {
    let tier;
    if (s.verdict === "present" && s.value) {
      tier = tierOf(s.value, cfg);
    } else if (s.verdict === "missing") {
      missing.push(`line ${s.line}`);
      tier = inheritedTier;
    } else {
      unreadable.push(`line ${s.line}`);
      tier = "unknown";
    }
    if (tier === "inherit") tier = inheritedTier;
    byTier[tier === "expensive" ? "expensive" : tier === "cheap" ? "cheap" : "unknown"]++;
    total += bootTax(cwd, cfg) + typicalRun(tier, "general-purpose", cfg, tally).tokens;
  }

  const shape =
    `${sites.length} agent() site(s) — ${byTier.expensive} top-tier, ${byTier.cheap} cheap, ${byTier.unknown} unresolved`;
  const floorNote = `≈ ${fmt(total)} at minimum (a FLOOR: a site inside a loop dispatches many times)`;

  const notes = [];
  if (missing.length && inheritedTier === "expensive") {
    notes.push(
      `${missing.length} site(s) set no \`model\` (${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}) and inherit the session model (${inherited}) — costed as top tier. Add \`model: 'sonnet'\` to the execution ones.`,
    );
  }
  if (unreadable.length) {
    notes.push(`${unreadable.length} site(s) set their model somewhere static analysis can't read (${unreadable.slice(0, 6).join(", ")}) — not checked.`);
  }

  const context = `[harness] Workflow: ${shape}. ${floorNote}.${notes.length ? " " + notes.join(" ") : ""}`;

  if (total > cfg.askThresholdTokens) {
    emit(
      context,
      "ask",
      `harness: this workflow is estimated at ${fmt(total)} tokens minimum — ${shape} — past your ${fmt(cfg.askThresholdTokens)} threshold. ` +
        (notes.length ? notes.join(" ") + " " : "") +
        `Approve to run it, or restructure: route execution sites to sonnet, shrink the fan-out, or split it into phases. Remember this is a floor if any site sits inside a loop.`,
    );
  }

  emit(context);
} catch {
  /* never wedge a workflow on our own bug */
}
process.exit(0);
