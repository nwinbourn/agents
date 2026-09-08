// Preserve normal test output and publish actionable failure evidence in check annotations.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const run = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url))], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 8 * 60 * 1000,
});
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
  const details = [run.error?.message, (run.stdout || '').slice(-2000), (run.stderr || '').slice(-10000)].filter(Boolean).join('\n');
  const escaped = details.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::error title=Regression suite failed::${escaped}\n`);
  process.exitCode = run.status || 1;
}
