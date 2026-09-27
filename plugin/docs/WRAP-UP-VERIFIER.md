# Wrap-up verifier

This is an independent implementation of the agents repository's workflow requirements.
It includes no DeepSeek source code or runtime dependency. The repository's existing
license is unchanged.

It runs three times without anyone asking: the wrap-up skill runs it at its final
step, the Stop hook that fires after `/wrap-up` re-checks the Start here block on its
own, and the next session start runs the whole check again in tracking mode and
reports the result. You can also invoke it directly:

```sh
node "<plugin-root>/hooks/wrap-up-verify.mjs" --project "<project-directory>" --check-remote
```

In a source checkout, `<plugin-root>` is `plugin/`. Omit `--project` to inspect the
current directory; nested paths are resolved to the Git working-tree root.

## What it checks

| Check | Passing condition |
|---|---|
| Branch | On dev when origin/dev is recorded; otherwise an attached local branch. A `feature/` or `fix/` branch session is checked from the project folder after it merges back; its own folder never passes |
| Conflicts | No unmerged index entries |
| Operation | No unfinished merge, rebase, cherry-pick or revert markers |
| Commits | HEAD resolves to a commit |
| Worktree | No staged, unstaged or untracked changes, including submodule changes |
| Branches | No local branch or worktree carries commits that are not on the working branch unless STATE.md names it; merged leftovers are listed as safe to delete, and do not fail the check. On a dev project, an open `feature/` or `fix/` branch in its own folder is another session's parallel work: listed under `open`, never failing |
| Handoff | One Start here section with unique, nonempty Do this first, Waiting on you and Mid-flight fields; Do this first names a file, route or command (a path, a backticked command, a URL or a commit). A field is its label line plus the lines directly under it, up to a blank line, so a list under a label counts. Anything else in the block is reported as extra content |
| Shared memory | The selected STATE.md exists in HEAD on a shared project |
| Remote | For shared projects, HEAD equals live origin/dev, queried with git ls-remote |

Handoff discovery checks the repository's `STATE.md` first, then `docs/STATE.md`.
Comments, fenced examples, indented code and obvious empty placeholders do not
count as a real handoff. Field content can describe unfinished work; checking its
presence is not a semantic evaluation of whether the session is finished.

## Results

The command prints JSON with an overall status and individual check results:

- `passed` (exit 0): all mechanical checks passed.
- `incomplete` (exit 1): at least one known requirement remains unsatisfied.
- `unknown` (exit 2): no known incomplete check, but something could not be verified.

When incomplete and unknown checks coexist, the overall result is incomplete; the
individual unknown results remain visible. Never discard them.

Without `--check-remote`, shared projects receive an unknown remote result. With it,
the remote query times out after 15 seconds; failures remain unknown. `--remote
tracking` compares HEAD with the fetched `origin/dev` instead of querying the
network, which is what session start uses right after its own fetch; the message
says "as of the last fetch" so nobody mistakes it for a live check. A deleted remote
dev branch is incomplete. The query does not fetch objects or update tracking refs.
Different local/remote hashes mean the shared handoff needs reconciliation; they do
not alone establish whether work is ahead, behind or diverged.

Projects without a recorded `origin/dev` use local verification. Their remote check
is marked not required, and passing makes no publication claim. The verifier follows
the existing adoption rule; it does not discover or create dev on an unrelated remote.

## Boundaries

This is an explicit skill helper, not an automatic Stop hook or a write barrier.
It never stages, commits, fetches, pushes, merges, switches branches or writes a
project file. Git optional index writes and interactive terminal prompts are disabled.
The remote query can use already-configured Git authentication.

It checks the entire checkout because it cannot infer which files the user agreed to
commit. Ignored files are outside the clean-tree check; uncommitted STATE.md is also
checked for inclusion in HEAD on shared projects. The agent must review ignored work,
memory accuracy, intended commit scope and running workers separately.

Results describe a point in time. They do not lock the checkout or guarantee that
the remote stays unchanged. No raw Git stderr or remote URL is included in errors.
