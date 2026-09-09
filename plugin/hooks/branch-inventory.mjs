#!/usr/bin/env node
// Read-only inventory of leftover branches and worktrees, for the clean-branches skill
// and for anyone who wants the list. Never fetches, switches, prunes or deletes.
import { inspectProject } from './lib/project-inspection.mjs';
import { branchInventory, describeInventory } from './lib/branch-inventory.mjs';

try {
  const args = process.argv.slice(2);
  let project = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('--')) project = args[++i];
    else throw Error('Usage: node branch-inventory.mjs [--project <directory>]');
  }
  const info = inspectProject(project);
  if (!info.isGit) {
    process.stdout.write(JSON.stringify({ status: 'unknown', summary: 'Not a Git working tree.' }) + '\n');
    process.exitCode = 2;
  } else {
    const inventory = branchInventory(info.root, info.workflow);
    const summary = describeInventory(inventory) || `Only the working branch (${inventory.working}) exists; nothing to clean up.`;
    process.stdout.write(JSON.stringify({ project: info.root, workflow: info.workflow, ...inventory, summary }, null, 2) + '\n');
  }
} catch {
  process.stdout.write(JSON.stringify({ status: 'unknown', summary: 'Inventory failed or arguments were invalid. Use --project <directory>.' }) + '\n');
  process.exitCode = 2;
}
