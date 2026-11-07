# Working in this fork

This repository is a personal fork of T3 Code. The owner uses a **stable** build of it every day. That build runs the agent reading this file. Breaking stable breaks the owner's work, including this conversation.

## What runs where

|         | Stable (live, do not touch)                                           | Dev (yours to break)                                                              |
| ------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Code    | `~/ide/t3code` on branch `custom`, built into `~/.t3-fork/releases/*` | `~/ide/t3code-dev` (feature branches off `custom`)                                |
| T3 home | `~/.t3-stable`                                                        | `~/.t3-dev`                                                                       |
| Server  | systemd user service `t3-fork-stable.service`, port 3773              | `./fork/bin/fork dev`: server port 13873, web port 5833 (`http://127.0.0.1:5833`) |

Rules:

- **Never start a server against `~/.t3-stable`, never open its database read-write, and never stop, restart or kill the stable service or anything on port 3773.**
  - The root AGENTS.md's warnings about `~/.t3/userdata` apply to `~/.t3-stable/userdata` here.
  - `~/.t3` is unused and should stay that way.
- Start dev with `./fork/bin/fork dev`, not `vp run dev`: plain `vp run dev` in a worktree uses the worktree's own `.t3` home and different ports. Stop dev only by the PID you started.
- Do not run `fork promote`, `fork rollback` or `fork sync-upstream` unless the owner asks. They deploy to or change stable. `fork status` is always safe.
- Commit on the feature branch in `~/ide/t3code-dev`. Never commit to `main` (a mirror of upstream). Promote is what lands work on `custom`.

## Keeping the fork easy to sync

Upstream lands about 150 commits a day, so fork changes must stay out of upstream's files as much as possible:

- Put fork features in **new files**, e.g. a new component or service. Wire them in with at most a line or two in the upstream file: an import plus one usage.
- `fork/footprint.json` lists every upstream file the fork edits and how many lines. `fork footprint` fails when an upstream file is edited without an entry, when an entry grows past its number, or when an entry's lines disappear (a sync dropped them).
  - After adding a deliberate small hook, run `./fork/bin/fork footprint --write` and commit `fork/footprint.json` with the change.
- `t3.json` and the fork block in `AGENTS.md` are generated. Edit `fork/t3.fork.json` instead, then run `./fork/bin/fork hooks`.
- Everything else from the root AGENTS.md applies: verify with `vp run check:changed`, and follow its test rules.
