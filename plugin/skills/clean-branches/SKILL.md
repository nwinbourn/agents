---
name: clean-branches
description: Resolve leftover branches and worktrees so the project is back to its one working branch. Use when the user says "clean up the branches", "resolve the stray branches", "get the repo down to dev" (or "down to main"), or asks what to do about the [branches] line from session start. Merged leftovers are deleted after a yes; unmerged ones are shown and the user decides; nothing is deleted without the user's yes.
user-invocable: true
---

Bring the repository back to one working branch (`dev` on a shared project, `main`
otherwise) without losing anything. Every deletion is a question first. The branch guard
prompts for the risky ones anyway; this skill asks before that, in plain words.

## 1. Take the inventory

Run the plugin's command, resolving its root from this skill's location:

```sh
node "<plugin-root>/hooks/branch-inventory.mjs" --project "<project-directory>"
```

Read-only. It lists local branches besides the working branch and main, leftover
worktrees, and remote branches other than main and dev, each with: commits not on the
working branch, whether STATE.md names it, its last commit date, and for worktrees whether
the directory is clean. Show the user the summary line, then work through the lists in
this order.

## 2. Local branches

- **Merged (nothing beyond the working branch):** clutter. List them together and ask
  once: "These branches have nothing that isn't already on dev. Delete them?" On yes,
  `git branch -d <name>` for each. Never `-D` here; if `-d` refuses, the branch is not
  merged after all, so treat it as unmerged.
- **Unmerged:** show what it holds before saying anything else:

  ```sh
  git log --oneline <working>..<name>
  git diff --stat <working>...<name>
  ```

  Then offer exactly three choices. **Merge:** on the working branch, `git merge <name>`,
  resolve any conflict with the user, then `git branch -d <name>`. **Keep:** write it into
  STATE.md under Mid-flight (what it holds, who decides); the verifier treats an unnamed
  unmerged branch as an incomplete handoff. **Delete:** `git branch -D <name>` only after
  the user has seen the commits and said yes; the guard asks again, and that is expected.
- **The branch that is checked out right now** cannot be deleted. If it is not the
  working branch, that is the first problem: finish or park the work, switch back, then
  continue.

## 3. Worktrees

Claude Code's worktree feature and `git worktree add` leave directories under
`.claude/worktrees/` or beside the repository.

- **Clean and merged:** `git worktree remove <path>` after a yes, then `git worktree prune`
  to drop entries whose directory is already gone.
- **Uncommitted changes or unmerged commits:** show them (`git -C <path> status --short`,
  `git log --oneline <working>..<head>`), then merge, keep or delete as above. Never
  `git worktree remove --force` without the user's explicit yes; the guard asks for it.

## 4. Remote leftovers

Branches on origin other than main and dev, usually from a merged pull request or a
remote session.

- **Merged:** `git push origin --delete <name>` after a yes. On a shared project the guard
  asks again.
- **Unmerged:** the commits are not on this machine's working branch. Fetch the branch,
  show the log, and merge, keep or delete as above. If the remote refuses deletions (a
  scoped token), say so and leave it for the user.

## 5. Check and report

Run the inventory again. Report in plain words: what was deleted, what was merged, what
is kept and now named in STATE.md, and what remains and why. The goal state is one line:
"Local branches: dev and main. No worktrees. Nothing stray on origin." If STATE.md
changed, that edit is part of this session's wrap-up like any other.

## Never

- Delete `main`, `master` or `dev`.
- Delete anything the user has not said yes to in this conversation.
- Force-delete or force-remove without showing what is lost first.
- Rebase, reset or rewrite the working branch to make a merge "cleaner".
- Touch another person's remote branch that has unmerged work; name it in STATE.md and
  tell the user whose it is.
