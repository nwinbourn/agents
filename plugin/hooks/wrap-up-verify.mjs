#!/usr/bin/env node
// Explicit CLI used by the wrap-up skill; intentionally not an automatic hook.
import { verifyWrapUp } from './lib/wrap-up-verifier.mjs';
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check-remote') options.checkRemote = true;
    else if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('--')) options.project = args[++i];
    else throw Error('Usage: node wrap-up-verify.mjs [--project <directory>] [--check-remote]');
  }
  const report = verifyWrapUp(options);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'incomplete' ? 1 : 2;
} catch {
  process.stdout.write(JSON.stringify({ status: 'unknown', summary: 'Verification failed or arguments were invalid. Use --project <directory> and optional --check-remote.' }) + '\n');
  process.exitCode = 2;
}
