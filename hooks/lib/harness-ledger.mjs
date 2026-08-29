// harness-ledger — the live/idle worker ledger at <harness>/fleet.json.
//
// This is a HINT, never truth. SubagentStop can't say which worker stopped;
// background completions arrive as model notifications, not hook events; two
// sessions share one file. So every consumer treats the ledger as "what we think
// is out there" and the doctrine tells the model that ListAgents is authoritative.
//
// What it's for:
//   - burst estimation: sum this session's recent dispatches so a fan-out is costed
//     as one number instead of N invisible-under-threshold calls
//   - reuse hints: surface finished ("idle") workers that SendMessage could resume
//     without re-paying the boot tax
//   - the one-ask-per-burst window: remember that the user approved a big burst
//
// Entry shape:
//   { id, ts, session, model, agentType, bg, state: "pending"|"live"|"idle",
//     desc, label, settledTs? }
//
// Atomic writes (tmp + rename) and fail-open reads, lifted from fable-fleet-guard.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { paths } from "./harness-config.mjs";

const PENDING_TTL_MS = 3 * 60 * 1000; // a dispatch that never settled — call denied or hook died
const LIVE_TTL_MS = 2 * 60 * 60 * 1000; // a live worker we never saw stop

export function loadLedger() {
  try {
    const { ledger } = paths();
    if (!existsSync(ledger)) return { live: [], burstApprovedUntil: 0 };
    const data = JSON.parse(readFileSync(ledger, "utf8"));
    return {
      live: Array.isArray(data.live) ? data.live : [],
      burstApprovedUntil: Number(data.burstApprovedUntil) || 0,
    };
  } catch {
    return { live: [], burstApprovedUntil: 0 };
  }
}

export function saveLedger(ledger) {
  const { dir, ledger: ledgerPath } = paths();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = ledgerPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  renameSync(tmp, ledgerPath);
}

/**
 * Prune stale entries. `reuseWindowMinutes` bounds how long an idle worker stays a
 * reuse candidate; pending/live have their own TTLs. Mutates and returns the ledger.
 */
export function prune(ledger, cfg, now) {
  const reuseTtl = (cfg?.reuseWindowMinutes ?? 45) * 60 * 1000;
  ledger.live = ledger.live.filter((e) => {
    const age = now - (e.ts ?? 0);
    if (e.state === "pending") return age < PENDING_TTL_MS;
    if (e.state === "idle") return now - (e.settledTs ?? e.ts ?? 0) < reuseTtl;
    return age < LIVE_TTL_MS; // live
  });
  return ledger;
}

/** Append a pending dispatch. Caller saves. */
export function recordDispatch(ledger, { id, session, model, agentType, bg, desc, label, now }) {
  ledger.live.push({
    id,
    ts: now,
    session,
    model: model ?? "inherit",
    agentType: agentType ?? "general-purpose",
    bg: bg === true,
    state: "pending",
    desc: String(desc ?? "").slice(0, 60),
    label: label ? String(label).slice(0, 40) : undefined,
  });
  return ledger;
}

/**
 * Sum of estimated cost for THIS session's pending/live entries started within the
 * burst window, plus the incoming dispatch's own estimate. `estFn(entry)` returns
 * a token estimate for a ledger entry.
 */
export function burstEstimate(ledger, { session, cfg, now, incomingEst, estFn }) {
  const windowMs = (cfg?.burstWindowSeconds ?? 120) * 1000;
  let sum = incomingEst;
  const parts = [{ label: "this", est: incomingEst }];
  for (const e of ledger.live) {
    if (e.session !== session) continue;
    if (e.state === "idle") continue; // finished — not part of an in-flight burst
    if (now - (e.ts ?? 0) > windowMs) continue;
    const est = estFn(e);
    sum += est;
    parts.push({ label: e.label || e.desc || e.id, est });
  }
  return { sum, parts };
}

/** Idle (finished) workers from this session that SendMessage could resume. Newest first. */
export function reuseCandidates(ledger, { session, now, cfg }) {
  const reuseTtl = (cfg?.reuseWindowMinutes ?? 45) * 60 * 1000;
  return ledger.live
    .filter((e) => e.state === "idle" && e.session === session && now - (e.settledTs ?? e.ts ?? 0) < reuseTtl)
    .sort((a, b) => (b.settledTs ?? b.ts ?? 0) - (a.settledTs ?? a.ts ?? 0));
}

export function isBurstApproved(ledger, now) {
  return (ledger.burstApprovedUntil ?? 0) > now;
}

export function approveBurst(ledger, now, cfg) {
  ledger.burstApprovedUntil = now + (cfg?.burstWindowSeconds ?? 120) * 1000;
  return ledger;
}
