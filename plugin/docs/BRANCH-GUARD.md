# Branch guard

One hook keeps a project on its working branch, and on a `dev` project lets parallel work
happen on short-lived `feature/` and `fix/` branches without turning into a pile of stray
ones. It runs before every command the agent sends through the Bash or PowerShell tool,
and before Claude Code's own worktree features. It stays silent in projects that have not
adopted the memory protocol, and silent under the rules.

## Which projects

- **Not adopted** (no `STATE.md` or `CONTEXT.md`, no `origin/dev`): the guard does nothing.
- **Local workflow** (memory files, no `origin/dev`): work happens on `main`. Only branch
  and worktree creation is guarded.
- **Shared workflow** (`origin/dev` exists): `dev` is the working branch, `main` is
  production, and merging `dev` into `main` is a release. Parallel work goes on a task
  branch, below.

## Task branches (shared workflow)

A task branch is `feature/<task>` or `fix/<task>` — lowercase words joined by dashes, like
`feature/mobile-nav`. It is made off `dev`, lives in its own folder at
`.claude/worktrees/<task>` so the project folder never leaves `dev`, and merges back into
`dev` at wrap-up. Opening one is a single command, and the user approves it:

```sh
git worktree add .claude/worktrees/mobile-nav -b feature/mobile-nav dev
```

The session then moves in with `EnterWorktree` and that path. `.claude/worktrees/` must be
ignored by Git; if it is not, the guard says to add it to `.git/info/exclude` first, so a
branch folder never shows up as untracked work on `dev`. Any other name (`claude/…-867d9f`),
a start point other than `dev`, a folder elsewhere, or a branch created in place (which
would move a folder another session may be using) is refused with the command to use
instead.

## What it does

| Action | Local workflow | Shared workflow |
|---|---|---|
| Open a task branch off `dev` in its folder (`git worktree add .claude/worktrees/<task> -b feature/<task> dev`, or `git branch feature/<task>` on `dev`) | Refused | Asks |
| Create a task branch in place (`checkout -b`, `switch -c`, `stash branch`), or off anything but `dev` | Refused | Refused, with the command to use instead |
| Create any other branch (`checkout -b`, `switch -c`, `branch <name>`, `stash branch`, branch copy) | Refused | Refused; `wip/…` asks (the conflict-parking exception in AGENTS.md) |
| Create `dev` | Asks | Allowed (it is the working branch) |
| Check out a branch that only exists on the remote | Refused (git would create a local branch) | Refused, except `dev` |
| Reopen an existing task branch in its folder (`git worktree add .claude/worktrees/<task> feature/<task>`) | Refused | Allowed |
| Any other `git worktree add`, `EnterWorktree` without a path, an agent with worktree isolation | Refused | Refused |
| `EnterWorktree` with the path of an existing folder | Allowed | Allowed |
| Switch to a task branch | — | Refused; it lives in its own folder |
| Switch to `main` or another existing branch, or check out a commit | Allowed | Asks; switching to `main` is described as the release step |
| Commit, cherry-pick or revert on `dev` or a task branch | Allowed | Allowed |
| Commit, cherry-pick or revert anywhere else | Allowed | Refused; asks instead when a merge is in progress |
| Merge `dev` or `origin/dev` into a task branch | Allowed | Allowed |
| Any other merge while not on `dev` | Allowed | Asks |
| Push `dev` | Allowed | Allowed |
| Push `main`, `--all`, or any other branch | Allowed | Asks |
| Force-push, delete a remote branch | Allowed | Asks |
| `branch -d` of a task branch (git refuses it unless merged) | Allowed | Allowed |
| Rebase, `reset --hard`, `branch -d` of any other branch, rename a branch | Allowed | Asks |
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
`allow`. `taskBranches` covers the branch refusals: other names, task branches made in
place or off anything but `dev`, and switching to a task branch; `worktrees` covers the
worktree refusals: `git worktree add` outside the task-branch shape, `EnterWorktree`
without a path and agents run with worktree isolation. The release prompts for `main`,
the prompt for opening a task branch, and the prompts for force-push, rebase, hard reset
and branch deletion are protocol, not strictness, and stay as they are; so does the
refusal of a branch folder Git would not ignore. A missing or invalid file means the
defaults.

## One-time override

The refusals above are the guard doing its job, but one case needs an escape hatch: a genuine
hotfix that has to land on `main` while `dev` holds a big, unfinished change. A commit off `dev`
is a hard refusal the user never sees a prompt for, so there is otherwise no way through.

`/override` arms a one-shot, project-scoped relaxation. While it is armed, every hard refusal for
that one repository becomes an ordinary permission prompt instead — the wall becomes an
approve-click. Nothing is silenced: switching to `main`, committing and pushing each still prompt,
and the user approves each one. It is scoped to a single repository, expires on its own after a
short window (15 minutes by default), and the command clears it as soon as the fix is in.

```sh
node "<plugin-root>/hooks/branch-guard-override.mjs" arm     # turn this repo's refusals into prompts
node "<plugin-root>/hooks/branch-guard-override.mjs" status  # is it on, and for how long
node "<plugin-root>/hooks/branch-guard-override.mjs" clear   # back to normal now
```

It relaxes only the hard refusals (commit off `dev`, task-branch and worktree creation). The
prompts that are already prompts — the `main` release prompt, force-push, rebase, hard reset,
branch deletion — stay exactly as they are; the override never widens them and never makes
anything silent. State lives in `~/.claude/branch-guard-override.json`; a missing or expired file
means no override, and like everything else here an internal error fails safe to no override.

## Leftovers

The guard stops new stray branches; it does not delete old ones. Session start lists
what exists besides the working branch (see [session memory](SESSION-MEMORY.md)): open
task branches in their folders as parallel work, everything else as leftovers. The
wrap-up verifier stays incomplete while an unmerged leftover is not named in STATE.md —
an open task branch never fails another session's wrap-up, because its own wrap-up merges
it back. The `clean-branches` skill ("clean up the branches") walks through the
leftovers: merged ones deleted after a yes, unmerged ones shown so the user picks merge,
keep or delete. The prompts for force-delete and forced worktree removal apply there too.

## Limits

- It sees commands run through the Bash and PowerShell tools. Git run through another
  tool or an MCP server, other agents, and the user's own terminal are not covered.
  GitHub branch protection on `main` remains the hard backstop.
- It reads the command as text. Git aliases, scripts that call git, and unusual
  spellings are not analyzed.
- It never changes the repository and never prompts on its own behalf; an internal
  error fails open and silent.
