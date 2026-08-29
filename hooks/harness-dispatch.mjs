#!/usr/bin/env node
/**
 * harness-dispatch — PreToolUse hook on Task|Agent.
 *
 * Costs a dispatch before it runs and says so. The point is NOT to police how
 * many workers exist — it's to make "what will this fan-out cost" a number the
 * user sees at the moment they can still restructure it.
 *
 * BURST ESTIMATION is the core idea. A fan-out is N separate Agent calls, each
 * comfortably under any sane per-call threshold, so a per-call gate never fires
 * on the exact case that matters. Summing this session's recent dispatches turns
 * eight 250k workers into one 2M number and asks ONCE. Approving records a
 * window so the rest of that burst doesn't re-prompt.
 *
 * MISSING `model` is handled by measurement, not assumption. The payload carries
 * transcript_path, so the session's own model can be read: inheriting on a cheap
 * main loop is correct and gets silence; inheriting on an expensive one gets a
 * note, or an ask when the burst is already big. It NEVER denies — a false
 * positive that wedges valid tooling is worse than the tokens it saves.
 *
 * It also never emits permissionDecision "allow": that would override the user's
 * own permission settings for a tool call we were only asked to comment on.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { basename } from "node:path";
import { activeConfig, tierOf } from "./lib/harness-config.mjs";
import { loadLedger, saveLedger, prune, recordDispatch, burstEstimate, reuseCandidates, isBurstApproved, approveBurst } from "./lib/harness-ledger.mjs";
import { bootTax, typicalRun, readTally, fmt, localDate } from "./lib/harness-estimate.mjs";

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

/** Read the tail of the transcript and return the most recent assistant model, or null. */
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
    const text = buf.toString("utf8");
    // Last "model":"..." wins; the tail may start mid-line, which is fine.
    let last = null;
    for (const m of text.matchAll(/"model"\s*:\s*"([^"]+)"/g)) last = m[1];
    return last ? last.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Normalize a model id like "claude-opus-5" or "opus[1m]" to a tier keyword. */
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
  if (!/^(Task|Agent)$/.test(String(evt.tool_name ?? ""))) process.exit(0);

  const input = evt.tool_input ?? {};
  const cwd = evt.cwd || process.cwd();
  const session = evt.session_id ?? "?";
  const now = Date.now();

  const agentType = input.subagent_type ?? "general-purpose";
  const declared = input.model;
  const tally = readTally(cfg);

  // ---- resolve the effective tier -----------------------------------------
  let tier = tierOf(declared, cfg);
  let inheritNote = null;
  if (tier === "inherit") {
    const resolved = normalizeModel(sessionModel(evt.transcript_path), cfg);
    if (resolved) {
      tier = tierOf(resolved, cfg);
      if (tier === "expensive") {
        inheritNote = `This dispatch names no \`model\`, so it inherits the session model (${resolved}) and is costed as your top tier. If this is execution from a clear spec, set \`model: "sonnet"\`.`;
      }
    } else {
      tier = "unknown"; // transcript unreadable — cost it conservatively, say nothing extra
    }
  }

  // ---- estimate ------------------------------------------------------------
  const boot = bootTax(cwd, cfg, agentType);
  const run = typicalRun(tier, agentType, cfg, tally);
  const mine = boot + run.tokens;

  const ledger = prune(loadLedger(), cfg, now);
  const estFn = (e) => {
    const t = tierOf(e.model, cfg);
    const r = typicalRun(t === "inherit" ? "unknown" : t, e.agentType, cfg, tally);
    return bootTax(cwd, cfg, e.agentType) + r.tokens;
  };
  const burst = burstEstimate(ledger, { session, cfg, now, incomingEst: mine, estFn });

  // ---- reuse hint ----------------------------------------------------------
  const candidates = reuseCandidates(ledger, { session, now, cfg });
  const reuseLine = candidates.length
    ? ` Reuse candidates (ledger's guess — verify with ListAgents): ${candidates
        .slice(0, 3)
        .map((c) => `${c.label || c.desc || c.id} (${c.model}, idle ${Math.round((now - (c.settledTs ?? c.ts ?? now)) / 60000)}m)`)
        .join(", ")}.`
    : "";

  // ---- today's spend (advisory only, never asks) ---------------------------
  const today = localDate();
  const todayTokens = tally.filter((r) => r.date === today && Number.isFinite(r.tokens)).reduce((s, r) => s + r.tokens, 0);
  const unmeasured = tally.filter((r) => r.date === today && !Number.isFinite(r.tokens)).length;
  const dailyLine =
    todayTokens > cfg.dailyAdvisoryTokens
      ? ` Today: ~${fmt(todayTokens)} logged, past the ${fmt(cfg.dailyAdvisoryTokens)} advisory mark${unmeasured ? ` (${unmeasured} rows unmeasured)` : ""}.`
      : "";

  // ---- record the dispatch as pending -------------------------------------
  recordDispatch(ledger, {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    session,
    model: declared ?? "inherit",
    agentType,
    bg: input.run_in_background === true,
    desc: input.description ?? "",
    label: input.description ?? "",
    now,
  });

  // ---- decide --------------------------------------------------------------
  const breakdown = `${fmt(boot)} boot + ~${fmt(run.tokens)} typical ${tier} ${agentType} run [${run.provenance}]`;
  const over = burst.sum > cfg.askThresholdTokens && !isBurstApproved(ledger, now);

  if (over) approveBurst(ledger, now, cfg); // one ask per burst, not one per worker
  saveLedger(ledger);

  const base =
    `[harness] ${basename(cwd)}: this worker ≈ ${fmt(mine)} (${breakdown}).` +
    (burst.parts.length > 1 ? ` Session burst: ${burst.parts.length} dispatches in the last ${cfg.burstWindowSeconds}s ≈ ${fmt(burst.sum)}.` : "") +
    reuseLine +
    dailyLine +
    (inheritNote ? ` ${inheritNote}` : "");

  if (over) {
    emit(
      base,
      "ask",
      `harness: this fan-out is estimated at ~${fmt(burst.sum)} tokens — ${burst.parts.length} dispatches × (${breakdown}), past your ${fmt(cfg.askThresholdTokens)} threshold.` +
        (inheritNote ? ` ${inheritNote}` : "") +
        ` Approve to run it, or restructure: batch related tasks onto one worker (pays boot once), route execution work to sonnet, or reuse an existing worker.` +
        ` Approving covers the rest of this burst.`,
    );
  }

  emit(
    base +
      ` Pre-dispatch: self-contained order · exact input paths · objective done-when · return shape (raw data, not prose) · verification trigger set now · foreground if it writes · one browser inspector, never scroll/animation checks.`,
  );
} catch {
  /* never wedge a dispatch on our own bug */
}
process.exit(0);
