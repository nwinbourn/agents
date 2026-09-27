// Shared project discovery. Never walks into unrelated ancestor memory directories.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';

export function runGit(cwd, args, timeout = 5000) {
  try {
    return { ok: true, output: execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) };
  } catch (e) {
    // Raw stderr can contain credential-bearing URLs; callers get only status.
    return { ok: false, code: e.status ?? null };
  }
}

export function resolveProject(cwd = process.cwd()) {
  const requested = resolve(cwd);
  const top = runGit(requested, ['rev-parse', '--show-toplevel']);
  return { root: top.ok ? resolve(top.output.trim()) : requested, isGit: top.ok };
}

// The main checkout's root. A linked worktree (a branch in its own folder) resolves to
// the project folder it was made from; anything unusual falls back to its own root.
export function mainProjectRoot(cwd = process.cwd()) {
  const project = resolveProject(cwd);
  if (!project.isGit) return project.root;
  const common = runGit(project.root, ['rev-parse', '--git-common-dir']);
  if (!common.ok) return project.root;
  const dir = resolve(project.root, common.output.trim());
  return basename(dir) === '.git' ? dirname(dir) : project.root;
}

export function findMemoryFile(root, name) {
  if (!['CONTEXT', 'STATE', 'PITFALLS', 'DESIGN'].includes(name)) throw Error('Unknown memory file');
  return [join(root, name + '.md'), join(root, 'docs', name + '.md')].find(p => existsSync(p)) ?? null;
}

export function inspectProject(cwd = process.cwd()) {
  const project = resolveProject(cwd);
  const dev = project.isGit ? runGit(project.root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/dev']) : null;
  const workflow = !dev ? 'unknown' : dev.ok ? 'shared-dev' : dev.code === 1 ? 'local' : 'unknown';
  const memory = Object.fromEntries(['STATE', 'CONTEXT', 'PITFALLS', 'DESIGN'].map(name => [name, findMemoryFile(project.root, name)]));
  // STATE or CONTEXT adopts memory; shared dev also warrants reporting missing memory.
  const adopted = Boolean(memory.STATE || memory.CONTEXT || workflow === 'shared-dev');
  return { ...project, workflow, memory, adopted };
}
