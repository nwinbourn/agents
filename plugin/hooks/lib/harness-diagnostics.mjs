// Last issue per component, written silently. No prompts, scripts or transcript data.
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths } from './harness-config.mjs';

export const COMPONENTS = ['counter', 'dispatch', 'workflow', 'core'];
export function recordIssue(component, code) {
  if (!COMPONENTS.includes(component)) return;
  let tmp;
  try {
    const { dir } = paths();
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, component + '-issue.json');
    tmp = dest + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify({ component, code, at: new Date().toISOString() }));
    renameSync(tmp, dest);
  } catch { /* diagnostics must never affect a hook */ }
  finally { if (tmp) { try { unlinkSync(tmp); } catch {} } }
}
export function readIssues() {
  return COMPONENTS.flatMap(component => {
    try {
      const item = JSON.parse(readFileSync(join(paths().dir, component + '-issue.json'), 'utf8'));
      return item.component === component && typeof item.code === 'string' && typeof item.at === 'string' ? [item] : [];
    } catch { return []; }
  });
}
