#!/usr/bin/env node
/**
 * harness-workflow — PreToolUse hook on the Workflow tool.
 *
 * A workflow is one atomic parallel fan-out: its `agent()` calls all dispatch
 * inside the tool, where no per-dispatch hook can see them. So this reads the
 * script as text first, resolves each call's tier (its explicit `model`, or the
 * session model it inherits when none is set), and counts them.
 *
 * If any tier's count exceeds its cap, the Workflow call becomes a permission
 * prompt naming the counts — the harness's one interruption. This catches the
 * classic accident: on a top-tier session, a script whose agent() calls omit
 * `model` is silently a whole fleet of that model. Under the caps it is
 * completely silent, and it never denies or allows on its own.
 *
 * A workflow is checked as its own snapshot — it does not touch the rolling
 * dispatch counter — so denying and re-submitting a re-routed script counts
 * fresh rather than stacking on the rejected version.
 *
 * "unknown" sites (model built by a helper, spread, or a variable) can't be
 * read and are never counted against a cap — a false positive that wedges a
 * valid workflow is worse than the tokens it might save.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync } from "node:fs";
import { activeConfig } from "./lib/harness-config.mjs";
import { analyzeScript } from "./lib/workflow-scan.mjs";
import { statSync, openSync, readSync, closeSync } from "node:fs";

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
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

/** Reduce a model name to a cap key ("fable"/"opus"/"sonnet"/…), or null if unknowable. */
function capKey(model, cfg) {
  const m = String(model ?? "").toLowerCase();
  for (const name of [...cfg.expensiveModels, ...cfg.cheapModels]) {
    if (m.includes(name)) return name;
  }
  return null;
}

try {
  const cfg = activeConfig();
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  const input = evt.tool_input ?? {};
  if (!input.script && !input.scriptPath) process.exit(0); // a named saved workflow carries no script

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

  const inheritedKey = capKey(sessionModel(evt.transcript_path), cfg);

  const counts = {}; // tier → number of sites
  let missing = 0;
  for (const s of sites) {
    let key = null;
    if (s.verdict === "present" && s.value) key = capKey(s.value, cfg);
    else if (s.verdict === "missing") {
      key = inheritedKey; // inherits the session model
      missing++;
    }
    // "unknown" verdicts are unreadable — never counted.
    if (key) counts[key] = (counts[key] || 0) + 1;
  }

  const exceeded = Object.entries(counts)
    .filter(([tier, n]) => Number.isFinite(cfg.caps?.[tier]) && n > cfg.caps[tier])
    .map(([tier, n]) => `${n} ${tier} (cap ${cfg.caps[tier]})`);

  if (!exceeded.length) process.exit(0); // under every cap — run it silently

  const inheritNote =
    missing && inheritedKey ? ` ${missing} of the sites set no model, so they inherit this session's ${inheritedKey}.` : "";

  ask(
    `harness: this workflow fans out ${exceeded.join(", ")} in parallel.${inheritNote} ` +
      `Approve to run it as-is, or deny and the fan-out gets re-routed (sonnet is the default for fan-out workers) or split into smaller phases.`,
  );
} catch {
  /* never wedge a workflow on our own bug */
}
process.exit(0);
