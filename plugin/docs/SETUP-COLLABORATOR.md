# Setup — non-technical collaborator

**If you're the human:** you don't need to read past this paragraph. Open Claude Code,
and tell it: *"Read docs/SETUP-COLLABORATOR.md from the agents plugin and set me up."*
Claude will do the work and ask you a few plain questions along the way. The only things
Claude will ever ask YOU to type are passwords and sign-in codes — it must never handle
those for you.

---

**Claude: everything below is addressed to you.** You are setting up a collaborator who
does not code and does not know git. They should never need to. Your job is to get their
machine to the point where the daily rhythm is: open Claude in the project folder → ask
"what's next?" → work → say "wrap up." Nothing else.

## Ground rules for this setup and forever after

- **Plain words only.** Say "I saved your work and shared it with the team," never
  "committed and pushed to origin/dev." Don't show commands or output unless they ask.
- **Never ask them to run anything.** You run it. They answer questions and type their
  own passwords.
- **Credentials are theirs alone.** For any sign-in (GitHub, etc.), open the sign-in
  flow and hand control to them — you never see, type, store, or ask for passwords,
  codes, or tokens.
- **Their machine, their pace.** Verify each step worked before moving on. If something
  fails, say what's stuck in one plain sentence and what you'll try next.

## Steps

### 1. Check the basics

Verify `git` and `node` are available. On macOS, running `git` for the first time may
pop up an "install command line developer tools" window — tell them to click Install and
wait; that's normal. On Windows, install Git for Windows if missing (with their OK).

### 2. Who are they? (git identity)

Ask their name and email, then set:

```bash
git config --global user.name "Their Name"
git config --global user.email "their@email.com"
```

Explain in one line: "this signs your work with your name, so the team can see who did
what." This matters even on a shared GitHub account — the name on each change comes from
this setting, not from the login.

### 3. GitHub access

Ask which they're using — their own GitHub account or a shared team account. Either
works. Run `gh auth login` (choosing the browser flow) if `gh` exists, or let git's
credential helper prompt on first use — **and hand the keyboard/browser to them for the
sign-in itself.** If the account has two-factor codes they don't have, they need to get
the code from whoever owns the account; wait, don't work around it.

### 4. Install this plugin on their machine

If you're reading this file, the plugin may already be installed — check before
re-installing. If not:

```
/plugin marketplace add nwinbourn/agents
/plugin install agents@agents
```

The hooks prompt for approval — explain in one line: "this is the automation that keeps
your work synced with the team; approve it."

### 5. Their personal layer

- Copy the plugin's `templates/outputs.md` to `~/.claude/outputs.md` so they have their
  own voice settings (theirs to tune later — `default` is already plain-language).
- Create or extend `~/.claude/CLAUDE.md` with a short personal block. Draft it WITH
  them — ask what they do (copywriting? design? operations?) and write, in this shape:

  ```markdown
  # Working agreement

  - <Name> — <what they do>. Not technical: Claude handles ALL git, code, and
    terminal mechanics, always, without being asked.
  - Plain words only. No jargon, no commands, no file paths unless asked.
  - Never show raw terminal output; say what it means instead.
  - Anything that needs the technical partner's decision or help goes in the
    project's STATE.md under "Open questions" — then tell <Name> it's flagged.
  - Never touch the live site (main branch) — all work happens on the shared
    working branch.
  ```

  Read it back to them and adjust until it sounds right.

### 6. Get the project

Ask for the project link (their partner has it — a GitHub address). Clone it into a
sensible folder (e.g. `~/Projects/<name>`), then `git switch dev` so they're on the
shared working branch.

### 7. Prove it works

Open a session in the project folder. The sync hook should report the state of the
shared branch. Then run the loop once end-to-end:

1. Ask-and-answer "what's next?" from `STATE.md`.
2. Make one tiny real change (whatever's genuinely next, however small).
3. Say the wrap-up is being run, run `/wrap-up`, and walk through it in plain words.
4. Confirm the work is shared (the wrap-up's final verify step passes).

If all four happen, setup is done.

### 8. Teach the rhythm (last thing, keep it short)

Tell them the whole system is four phrases:

- **"What's next?"** — I'll tell you where the project stands and what's yours to do.
- **"Wrap up."** — I'll save everything and share it with the team. Say it every time
  you finish working — unsaved work is invisible to everyone else.
- **"/voice"** — changes how I talk (more detail, less detail).
- **"Plain words, please."** — if I ever slip into jargon, say this and I'll fix it.

## Ongoing rules for every future session with this person

The personal CLAUDE.md block from step 5 carries these, but to be explicit: all git
mechanics are yours, silently. Sync at start (the hook does it), wrap up at end
(insist on it gently if they forget — offer it when they say goodbye or go quiet).
If a sync problem needs their partner (a conflict in code, a rejected push), don't
troubleshoot at them — park the work safely (`wip/` branch, per AGENTS.md), write it
up in `STATE.md` under Open questions, and tell them: "your work is safe; <partner>
needs to untangle one thing on their side."
