# Branch guard

One hook keeps a project on its working branch. It runs before every command the agent
sends through the Bash or PowerShell tool, and before Claude Code's own worktree
features. It stays silent in projects that have not adopted the memory protocol, and
silent under the rules.

## Which projects

- **Not adopted** (no `STATE.md` or `CONTEXT.md`, no `origin/dev`): the guard does nothing.
- **Local workflow** (memory files, no `origin/dev`): work happens on `main`. Only branch
  and worktree creation is guarded.
- **Shared workflow** (`origin/dev` exists): `dev` is the only working branch, `main` is
  production, and merging `dev` into `main` is a release.

## What it does

| Action | Local workflow | Shared workflow |
|---|---|---|
| Create a branch (`checkout -b`, `switch -c`, `branch <name>`, `stash branch`, branch copy) | Refused | Refused; `wip/…` asks (the conflict-parking exception in AGENTS.md) |
| Create `dev` | Asks | Allowed (it is the working branch) |
| Check out a branch that only exists on the remote | Refused (git would create a local branch) | Refused, except `dev` |
| `git worktree add`, `EnterWorktree`, an agent with worktree isolation | Refused | Refused |
| Switch to `main` or another existing branch, or check out a commit | Allowed | Asks; switching to `main` is described as the release step |
| Commit, cherry-pick or revert while not on `dev` | Allowed | Refused; asks instead when a merge is in progress |
| Merge while not on `dev` | Allowed | Asks |
| Push `dev` | Allowed | Allowed |
| Push `main`, `--all`, or any other branch | Allowed | Asks |
| Force-push, delete a remote branch | Allowed | Asks |
| Rebase, `reset --hard`, `branch -d`, rename a branch | Allowed | Asks |
| Force-delete a branch (`branch -D`), `worktree remove --force` | Asks | Asks |
| `worktree remove` (no force), `worktree prune` | Allowed | Allowed |
| `gh pr merge` | Allowed | Asks |

"Refused" tells the model why and what to do instead; the user never sees it. "Asks" is
an ordinary permission prompt carrying the reason. Everything else passes in silence.

Chained commands are followed in order: `git checkout main && git merge dev && git push
origin main` is one release prompt, and `git switch -c feature && git commit -m x` is
refused at the first step. Text inside quotes, heredocs and comments is ignored. `cd`
and `git -C` move the check to that directory, and a subfolder resolves to its
repository root.

## Settings

The two refusals can be softened per person, never per project, in
`~/.claude/branch-guard.json`:

```json
{ "taskBranches": "deny", "worktrees": "deny" }
```

Each value is `deny` (the default), `ask` (a permission prompt carrying the reason) or
`allow`. `taskBranches` covers creating any branch other than `dev` or the `wip/`
exception; `worktrees` covers `git worktree add`, `EnterWorktree` and agents run with
worktree isolation. The release prompts for `main` and the prompts for force-push,
rebase, hard reset and branch deletion are protocol, not strictness, and stay as they
are. A missing or invalid file means the defaults.

## Leftovers

The guard stops new stray branches; it does not delete old ones. Session start lists
what exists besides the working branch (see [session memory](SESSION-MEMORY.md)), the
wrap-up verifier stays incomplete while an unmerged branch is not named in STATE.md, and
the `clean-branches` skill ("clean up the branches") walks through them: merged ones
deleted after a yes, unmerged ones shown so the user picks merge, keep or delete. The
prompts for force-delete and forced worktree removal apply there too.

## Limits

- It sees commands run through the Bash and PowerShell tools. Git run through another
  tool or an MCP server, other agents, and the user's own terminal are not covered.
  GitHub branch protection on `main` remains the hard backstop.
- It reads the command as text. Git aliases, scripts that call git, and unusual
  spellings are not analyzed.
- It never changes the repository and never prompts on its own behalf; an internal
  error fails open and silent.
