#!/usr/bin/env node
/**
 * harness-stop — SubagentStop hook.
 *
 * A background worker finishing is the one moment the ledger can learn that a
 * seat freed up. SubagentStop doesn't say WHICH worker stopped, so this settles
 * the oldest `live` entry for the session (or any session when the id is
 * unknown) — approximate by design, which is why the doctrine tells the model
 * that ListAgents is the truth and the ledger only a hint.
 *
 * It marks the entry `idle`, never deletes it. A finished worker is still a
 * reuse candidate: SendMessage resumes it from its transcript with its context
 * intact, so dropping it here would throw away the cheapest dispatch available.
 * Idle entries age out via reuseWindowMinutes in the ledger's prune.
 *
 * Fail-open: any error exits 0 silently, never blocks a stop.
 */
import { readFileSync } from "node:fs";
import { activeConfig } from "./lib/harness-config.mjs";
import { loadLedger, saveLedger, prune } from "./lib/harness-ledger.mjs";

try {
  const cfg = activeConfig("measure");
  if (!cfg) process.exit(0);

  let evt = {};
  try {
    evt = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    /* an unreadable payload still lets us age the ledger */
  }

  const now = Date.now();
  const ledger = prune(loadLedger(), cfg, now);
  const session = evt.session_id;

  let idx = ledger.live.findIndex((e) => e.state === "live" && (!session || e.session === session));
  if (idx === -1) idx = ledger.live.findIndex((e) => e.state === "live");
  if (idx !== -1) {
    ledger.live[idx].state = "idle";
    ledger.live[idx].settledTs = now;
  }
  saveLedger(ledger);
} catch {
  /* never block */
}
process.exit(0);
