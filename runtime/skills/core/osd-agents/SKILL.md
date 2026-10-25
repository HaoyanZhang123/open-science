---
name: osd-agents
description: Use when the user hands you an "[OSD session]", "[OSD terminal]" or "[OSD screen]" reference, or asks you to look at, ask, or coordinate with another conversation, another agent, or a terminal (Claude Code, Codex, a shell) on this workbench — "see what the other agent is doing", "ask session X", "tell the Claude Code in that terminal to…". Reads them and messages them with the `osd` command.
---

# Other sessions and terminals

Everything on this workbench can be read and messaged with `osd`, which is on
your PATH. The user copies a reference from the app (right-click → "Copy
reference for an agent") and pastes it to you; it names the thing and the
commands for it:

```
[OSD session] Fold proteins · ses_e97a59758ffe… · /Users/me/OpenScience/sessions/2026-10-22-2058
  read: osd session show ses_e97a59758ffe…
  send and wait for the reply: osd session send ses_e97a59758ffe… "<message>" --wait

[OSD terminal] Claude Code · p585 · /Users/me/repo
  read: osd term read p585
  send and wait for the reply: osd term send p585 "<message>" --wait
```

Without a reference, `osd screen ls` lists every Screen and what is in it, with
the same ids.

## Read before you write

Always read first. Writing into something you have not looked at lands in the
middle of someone else's work.

| You have | Read it | Send to it |
|---|---|---|
| a session `ses_…` | `osd session show <id>` | `osd session send <id> "<message>" --wait` |
| a terminal running Claude Code or Codex | `osd term read <id>` (add `--turns 3` for more history) | `osd term send <id> "<message>" --wait` |
| a terminal running a plain shell | `osd term read <id>` (its last 40 lines; `--lines N`) | `osd term send <id> "<command>"` — **this runs the command** |

`osd term read` on an agent shows its own conversation and whether it is busy:

```
Claude Code · working · /Users/me/repo

--- user
fix the build

  → Bash: cargo build
```

`working` means it has not finished its turn. A message sent now waits in its
queue until it does, so `--wait` takes longer; it does not interrupt.

## Writing a message to another agent

The other agent does not know you exist. Every message says who you are, what
you need and what to send back, in one go:

> I'm the agent in the "Fold proteins" session. I need the path of the
> AlphaFold outputs you produced today. Reply with the path only.

- One question per message; ask for a short, specific reply.
- `--wait` prints its answer. Without it the message is sent and you get
  nothing back — read it later with the read command.
- Relay what you learned to the user in your own words. Do not paste a whole
  transcript.
- A file of the other conversation lives in ITS folder, not yours: when you
  name one to the user, write the full path (the folder from the reference +
  the path), so it opens with a click.

## Limits

- **Five messages per ten minutes.** Past that `osd` fails with "stop and ask
  the user". Do exactly that: tell the user what you have done and ask whether
  to continue. Never work around the limit.
- Never send a plain shell a command the user has not asked for: it runs as
  the user, outside your workspace and your approvals.
- `no gateway found`: remote access is off. Ask the user to turn it on in
  Settings › Remote access. `terminals are off`: the same page, "Allow
  terminal".
