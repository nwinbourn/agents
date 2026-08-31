#!/usr/bin/env node
/**
 * harness-workflow — PreToolUse hook on the Workflow tool.
 *
 * The one place where tier routing can be checked mechanically instead of hoped
 * for. A workflow script's `agent()` calls are dispatched inside the tool, so no
 * per-dispatch hook ever sees them — but the script is right there as text, and
 * each call's `model:` can be read statically before anything runs.
 *
 * What it flags, and why each is waste:
 *   - sites with NO model on an expensive session → they inherit it, so an
 *     unannotated fan-out is silently an expensive fan-out. The single most
 *     costly mistake, and invisible without this check.
 *   - a fan-out where most workers are top tier → fan-outs are parallel
 *     execution; the judgment happened when the split was chosen. Occasionally
 *     deliberate, usually not.
 *   - `fable` sites in a fleet → it's the main loop's model and the verifier of
 *     last resort, not a worker model.
 *
 * The flags above become a PERMISSION PROMPT ("ask"), not a note. The model that
 * wrote the wasteful script is the wrong party to adjudicate it — history shows
 * a remembered rule does not stop a fleet. The USER approves or denies, with the
 * findings in front of them. It never denies outright, and never emits "allow"
 * (that would override the user's own permission settings).
 *
 * Verdict "unknown" — opts by reference, spread, or built by a helper — is never
 * flagged. The scanner can't read those, and a false positive that wedges a valid
 * workflow is worse than the tokens it would save.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { activeConfig, tierOf } from "./lib/harness-config.mjs";
import { analyzeScript } from "./lib/workflow-scan.mjs";

/** Most sites expensive is worth a word; a couple is normal. */
const TOP_HEAVY_MIN_SITES = 4;
const TOP_HEAVY_RATIO = 0.6;

function emit(context, ask) {
  const out = { hookSpecificOutput: { hookEventName: "PreToolUse" } };
  if (context) out.hookSpecificOutput.additionalContext = context;
  if (ask) {
    out.hookSpecificOutput.permissionDecision = "ask";
    out.hookSpecificOutput.permissionDecisionReason = ask;
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

/** The session's own model, read from the tail of its transcript. Null if unreadable. */
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

try {
  const cfg = activeConfig();
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  const input = evt.tool_input ?? {};

  // A saved workflow invoked by name carries no script — not this session's to police.
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

  const inherited = sessionModel(evt.transcript_path);
  const inheritedTier = inherited ? tierOf(inherited, cfg) : "unknown";

  const missing = [];
  const fable = [];
  let expensive = 0;
  let readable = 0;

  for (const s of sites) {
    if (s.verdict === "missing") {
      missing.push(`line ${s.line}`);
      readable++;
      if (inheritedTier === "expensive") expensive++;
    } else if (s.verdict === "present" && s.value) {
      readable++;
      if (tierOf(s.value, cfg) === "expensive") {
        expensive++;
        if (s.value === "fable") fable.push(`line ${s.line}`);
      }
    }
    // "unknown" verdicts are deliberately not counted — unreadable is not a finding.
  }

  const askReasons = []; // expensive-model waste → the USER decides, not the model
  const notes = [];      // informational only

  if (missing.length && inheritedTier === "expensive") {
    const shown = missing.slice(0, 8).join(", ") + (missing.length > 8 ? ", …" : "");
    askReasons.push(
      `${missing.length} of ${sites.length} agent() sites set no model (${shown}), so every one inherits this session's ${inherited} — an unannotated fan-out is silently an all-${inherited} fan-out`,
    );
  } else if (missing.length) {
    // Cheap or unknown session: inheriting is probably fine — note, don't interrupt.
    notes.push(`${missing.length} agent() site(s) set no \`model\` and will inherit the session model. Set it deliberately.`);
  }

  if (fable.length) {
    askReasons.push(
      `${fable.length} site(s) route workers to fable (${fable.join(", ")}) — the main loop's model and the verifier of last resort, not a fleet model`,
    );
  }

  if (readable >= TOP_HEAVY_MIN_SITES && expensive / readable >= TOP_HEAVY_RATIO) {
    askReasons.push(
      `${expensive} of ${readable} readable sites run top-tier models — fan-outs are usually parallel execution from a split that already happened, which is cheap-tier work`,
    );
  }

  if (askReasons.length) {
    emit(
      undefined,
      `harness: this workflow looks like expensive-model waste — ${askReasons.join("; ")}. ` +
        `Deny it and the script gets re-routed (sonnet for execution sites, top tier only where the judgment genuinely needs it). ` +
        `Approve only if the expensive routing is deliberate.`,
    );
  }

  if (!notes.length) process.exit(0); // routing looks deliberate; say nothing

  emit(`[harness] ${notes.join(" ")}`);
} catch {
  /* never wedge a workflow on our own bug */
}
process.exit(0);
