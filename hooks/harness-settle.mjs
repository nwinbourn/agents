#!/usr/bin/env node
/**
 * harness-settle — PostToolUse hook on Task|Agent|SendMessage.
 *
 * Two jobs, both accounting:
 *
 *   1. TALLY. One row per dispatch in <harness>/tally.md — the measured record
 *      that calibrates the estimator and feeds `/harness status`. Token counts
 *      come from the parsed tool response, falling back to response length /
 *      bytesPerToken. (The predecessor's regexes never matched anything, so ~72%
 *      of its rows read "? tok" — extraction here walks the object instead.)
 *
 *   2. LEDGER SETTLE. The dispatch that harness-dispatch recorded as `pending`
 *      is promoted to `live` when the worker was backgrounded (the tool returned
 *      before it finished) or marked `idle` when it ran in the foreground (the
 *      tool returned BECAUSE it finished). Idle entries stay as reuse candidates
 *      — SendMessage can resume a finished worker from its transcript.
 *
 * A SendMessage to a name the ledger knows is logged as a `reuse` row, which is
 * how the reuse rate gets measured instead of self-reported.
 *
 * Runs when enabled, and also in shadow mode (tallyWhenDisabled) so the
 * kill-switch metric has a baseline. Never writes stdout. Never throws.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { activeConfig } from "./lib/harness-config.mjs";
import { loadLedger, saveLedger, prune } from "./lib/harness-ledger.mjs";
import { appendTally, extractTokens } from "./lib/harness-estimate.mjs";

try {
  const cfg = activeConfig("measure");
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  const tool = String(evt.tool_name ?? "");
  if (!/^(Task|Agent|SendMessage)$/.test(tool)) process.exit(0);

  const input = evt.tool_input ?? {};
  const project = basename(evt.cwd ?? process.cwd());
  const tokens = extractTokens(evt.tool_response, cfg);
  const now = Date.now();
  const session = evt.session_id;

  const ledger = prune(loadLedger(), cfg, now);

  if (tool === "SendMessage") {
    // Reuse only counts when it continued a worker we dispatched — a message to
    // another session or an unknown name isn't a boot-tax saving.
    const to = String(input.to ?? "");
    const known = ledger.live.find((e) => e.label === to || e.id === to || e.desc === to);
    if (known) {
      appendTally({ project, tier: "reuse", agentType: known.agentType ?? "-", tokens, desc: `continued ${to}` });
      known.settledTs = now;
      known.state = "idle"; // still resumable after the follow-up
      saveLedger(ledger);
    }
    process.exit(0);
  }

  // Task|Agent
  const model = input.model ?? "inherit";
  const agentType = input.subagent_type ?? "general-purpose";
  appendTally({
    project,
    tier: model,
    agentType,
    tokens,
    desc: input.description ?? "",
  });

  // Settle the newest pending entry for this session — that's this call.
  let idx = -1;
  for (let i = ledger.live.length - 1; i >= 0; i--) {
    const e = ledger.live[i];
    if (e.state === "pending" && (!session || e.session === session)) {
      idx = i;
      break;
    }
  }
  if (idx !== -1) {
    const entry = ledger.live[idx];
    entry.settledTs = now;
    entry.state = input.run_in_background === true ? "live" : "idle";
    if (Number.isFinite(tokens)) entry.actualTokens = tokens;
    // Remember what it was called so reuse hints can name it.
    if (!entry.label && typeof input.description === "string") entry.label = input.description.slice(0, 40);
    saveLedger(ledger);
  }
} catch {
  /* never block the session */
}
process.exit(0);
