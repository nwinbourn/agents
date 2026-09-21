#!/usr/bin/env node
// branch-guard-override — a one-shot, project-scoped relaxation of the branch guard.
//
// Why this exists: on a shared-dev project the guard REFUSES a commit made off `dev`
// outright — a hard deny the user is never even prompted for. That is right almost
// always, but it leaves no way to land a genuine hotfix straight on `main` while `dev`
// holds a big, unfinished change. `/override` arms this bypass for the current project.
//
// While armed, the guard turns its hard refusals for that ONE project into ordinary
// permission prompts (see branch-guard.mjs). Nothing is silenced: switching to `main`,
// committing and pushing each still prompt, and the user approves each one. The bypass
// is scoped to a single repository, self-expires after a short window, and is meant to
// be cleared the moment the fix lands.
//
// The guard imports readActiveOverride(); `/override` runs the CLI (arm | status | clear).
// Zero dependencies, cross-platform, fail-silent: nothing here may break the guard.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProject } from './lib/project-inspection.mjs';

const FILE = join(homedir(), '.claude', 'branch-guard-override.json');
const DEFAULT_MINUTES = 15;
const MAX_MINUTES = 120;

// Appended to a refusal the override has downgraded to a prompt, so the user sees WHY
// they are being asked instead of refused.
export const OVERRIDE_NOTE =
  'branch-guard override is active for this project — this is normally refused outright. ' +
  'Approve only if you meant to write here (e.g. a deliberate hotfix on main); clear the override when the fix is in.';

function readToken() {
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.project !== 'string' || typeof raw.expiresAt !== 'number') return null;
    return raw;
  } catch {
    return null; // missing, unreadable or invalid: treated as no override
  }
}

function deleteToken() {
  try { unlinkSync(FILE); } catch { /* already gone */ }
}

/**
 * The active override for `root`, or null. Called by the branch guard on every run.
 * An expired token is deleted so it never lingers. Any error yields null — fail-safe,
 * because "no override" means the guard enforces normally.
 * @param {string} root absolute repository root of the operation being judged
 * @param {number} [now]
 */
export function readActiveOverride(root, now = Date.now()) {
  try {
    const token = readToken();
    if (!token) return null;
    if (now >= token.expiresAt) { deleteToken(); return null; }
    if (!root || resolve(token.project) !== resolve(root)) return null;
    return token;
  } catch {
    return null;
  }
}

function rootFor(dir) {
  try { return resolveProject(dir).root; } catch { return resolve(dir); }
}

function minutesLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m <= 1 ? 'under a minute' : `about ${m} minutes`;
}

function arm(dir, rawMinutes, reason, self) {
  const root = rootFor(dir);
  let minutes = Number(rawMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = DEFAULT_MINUTES;
  minutes = Math.min(minutes, MAX_MINUTES);
  const now = Date.now();
  const token = { project: root, armedAt: now, expiresAt: now + minutes * 60000 };
  if (typeof reason === 'string' && reason.trim()) token.reason = reason.trim().slice(0, 200);
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(token, null, 2) + '\n');
  } catch (e) {
    return `branch-guard override: could NOT arm (${e.code || 'write failed'}). The guard is unchanged; nothing was bypassed.`;
  }
  return [
    'branch-guard override ARMED for this project:',
    `  ${root}`,
    `For ${minutesLeft(minutes * 60000)}, operations the guard normally REFUSES here become ordinary`,
    'approve-prompts instead of flat refusals — most importantly, committing on main while a dev branch',
    'exists. Everything still prompts you; nothing is silenced. It covers only this one repository and',
    'expires on its own.',
    `Clear it the moment the fix is in:  node "${self.replace(/\\/g, '/')}" clear`,
  ].join('\n');
}

function status(dir) {
  const root = rootFor(dir);
  const now = Date.now();
  const active = readActiveOverride(root, now);
  if (active) {
    return `branch-guard override is ACTIVE for this project (${root}); ${minutesLeft(active.expiresAt - now)} left. ` +
      "The guard's hard refusals here are approve-prompts until then, or until you clear it.";
  }
  const token = readToken();
  if (token && resolve(token.project) !== resolve(root)) {
    return `branch-guard override is OFF for this project. (One is armed for a different project: ${token.project}.)`;
  }
  return 'branch-guard override is OFF. The guard is enforcing normally.';
}

function clearOverride() {
  const existed = Boolean(readToken());
  deleteToken();
  return existed
    ? 'branch-guard override CLEARED. The guard is enforcing normally again.'
    : 'branch-guard override was already off. Nothing to clear.';
}

function cli(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--minutes') opts.minutes = argv[++i];
    else if (a === '--reason') opts.reason = argv[++i];
    else opts._.push(a);
  }
  const cmd = opts._[0] || 'status';
  const dir = opts.project || process.cwd();
  const self = process.argv[1] || 'branch-guard-override.mjs';
  if (cmd === 'arm') return arm(dir, opts.minutes, opts.reason, self);
  if (cmd === 'clear') return clearOverride();
  if (cmd === 'status') return status(dir);
  return `branch-guard-override: unknown command '${cmd}'. Use: arm [--minutes N] [--reason "..."] | status | clear.`;
}

// Run only when invoked directly (never on import by the guard).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(cli(process.argv.slice(2)) + '\n'); }
  catch (e) { process.stdout.write(`branch-guard-override: ${e?.message || 'error'}\n`); }
  process.exit(0);
}
