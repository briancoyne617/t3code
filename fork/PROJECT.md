# Project: personal T3 Code fork

What this project is, what's been built, what lives on the host outside git, and how to rebuild it all on a fresh machine. Day-to-day commands and recovery are in [README.md](README.md); rules for agents are in [AGENTS.md](AGENTS.md).

Last updated 2026-11-18.

## What it is

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code), kept at github.com/briancoyne617/t3code on branch `custom`. It runs inside WSL2 (Ubuntu) on a Windows PC:

- **Stable** (http://localhost:3773) is the build used every day. Real threads and settings live in `~/.t3-stable`. It changes only through `fork promote` or `fork rollback`.
- **Dev** (web http://127.0.0.1:5833, server port 13873) is a separate checkout that agents edit. Its data lives in `~/.t3-dev`, which is throwaway.

Both run on one machine without sharing a home, a port or login cookies. Dev uses 127.0.0.1 and stable uses localhost, so the browser treats them as different sites.

`custom` is upstream's latest stable tag (v0.1.7 nightlies as of early Nov 2026) plus the fork's changes. Every feature branch below is merged into `custom` and pushed.

## Features the fork adds

Fork code lives in new files: `fork/` (tooling, todo service), `apps/web/src/fork/` (UI) and a few server files. Upstream files carry only one- or two-line hooks, recorded in `fork/footprint.json`.

| Area | What it does | Branch |
| --- | --- | --- |
| Stable/dev split | The `fork` CLI (`status`, `dev`, `promote`, `rollback`, `sync-upstream`, `setup`, `hooks`, `footprint`), immutable releases, DB snapshots before each server swap, automatic restore when a swap fails, and a `t3` shim that refuses self-updates | feat/dev-sandbox |
| Todo lists | General, project and chat lists in their own service (127.0.0.1:3775). Quick-add syntax, recurring todos, server-side undo, ▶ to start a chat from a todo, and the `t3-todo` CLI for agents | feat/todos-poc, feat/todos-general, feat/todo-dupes, fix/todo-recovery, fix/todos-reachable |
| Todoist mirror | Two-way sync with the Todoist project "T3" every 2 minutes, with duplicates folded together | feat/todoist-todos, feat/no-autofill |
| Dev ↔ Stable panel | Shows what dev branches have that stable lacks, with a Pull in button per branch. A timer refreshes it every 2 minutes | feat/dev-stable-panel |
| Hammer menu | Shows which instance you're on, switches to the other one, and runs the fork's dev tools | feat/dev-menu |
| Chat header, top right | Provider usage limits (one row per provider; a Codex row without numbers hides when another has them), host CPU/RAM bars, the hammer, and the general Todo button (Alt+G) | feat/header-tools-right, feat/codex-managed-limits, feat/header-resources, feat/codex-limits-wait-indicator |
| Composer | Inline reasoning-effort slider and keyword pin, a context-window bar showing used/total tokens, and a mic button that opens Voice setup when voice can't start yet | feat/composer-effort-slider, feat/composer-effort-keyword, feat/composer-context-bar, feat/header-resources |
| Voice | Backport of upstream's environment dictation fixes | feat/upstream-voice |
| Wait countdowns | Live countdown for chats waiting on a timer or background command. The sidebar dot fills like a pie | feat/wait-countdown |
| Terminal | Ctrl+V pastes, Ctrl+C copies a selection, no popup on select (right-click still offers Add to chat) | feat/terminal-ctrl-v-paste, fix/terminal-copy-context, fix/no-terminal-selection-popup |
| Hide UI | Alt+right-click any element to hide it. Settings → Appearance lists everything hidden, each with a way back | feat/hide-ui |
| Shortcuts | `?` opens every shortcut, with search and rebinding. It warns about keys the browser keeps | feat/hide-ui |
| No password-manager popups | Text inputs become search inputs so Bitwarden skips them | feat/no-autofill |

## Where everything lives

### In git (safe on GitHub)

- `~/ide/t3code`: main checkout, always on `custom`. Stable is built from it.
- `~/ide/t3code-dev`: dev worktree on a feature branch.
- Other `~/ide/t3code-*` folders: old feature worktrees. Each branch is merged and pushed, so they can be deleted.

### On the host only (not in git)

| Path | What | Replaceable? |
| --- | --- | --- |
| `~/.t3-stable/userdata/statev2.sqlite` (+ `-wal`) | Every stable thread and message (~260 MB) | **No.** Back it up. |
| `~/.t3-stable/userdata/settings.json`, `keybindings.json` | Stable settings, provider instances, rebound keys | Small. Back it up. |
| `~/.t3-stable/userdata/secrets/` | Provider credentials stored by T3 | Re-enter them in Settings |
| `~/.t3-stable/projects`, `worktrees`, `tools` | Per-project data, agent worktrees, downloaded provider CLIs (e.g. Codex 0.166.0) | Mostly re-created; worktrees hold uncommitted agent work |
| `~/.t3-fork/todos.json` | Every todo list (~650 KB). A daily copy goes to `~/.t3-fork/todo-backups/` | **No.** Back it up (Todoist holds a partial mirror of the "T3" project) |
| `~/.t3-fork/todoist.json` | Todoist sync state (which todo maps to which task) | Back it up, or the first sync may duplicate |
| `~/.t3-fork/todoist-token` | Todoist API token, 40 hex chars, mode 600 | Re-enter it via a secure prompt. Don't commit it |
| `~/.t3-fork/config.json`, `state.json`, `releases/`, `snapshots/`, `logs/` | Fork tooling config, deploy history, builds (~15 GB), DB snapshots | `config.json` is small (defaults in `fork/cli/lib/core.ts`); the rest is rebuilt |
| `~/.t3-fork/stable.env` | PATH and LANG for the stable service | Re-written by `fork setup` |
| `~/.config/systemd/user/t3-fork-{stable,todos,pending}.*` | The three user services and the timer | Re-written by `fork setup` |
| `~/.local/bin/t3`, `~/.local/bin/t3-todo` | CLI shims | Re-written by `fork setup` |
| `~/.codex/` | Direct ChatGPT login for the built-in Codex instance (real usage limits) | Run `codex login --device-auth` again |
| `~/.claude/` | Claude Code config, global CLAUDE.md, memory | Back it up separately |
| Windows: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\t3-fork-wsl-keepalive.vbs` | Starts WSL at logon and keeps it running | Re-written by `fork setup` |
| Windows: `C:\Users\brian\.wslconfig` | `networkingMode=mirrored` | Keep it; it's on the Windows side |
| `/etc/wsl.conf` | `[boot] systemd=true` | Needed for the user services |
| Linger | `loginctl enable-linger brian` (currently on) | Run it once with sudo |

## Backing up before wiping the host

Stop nothing. Copy while stable runs, using SQLite's backup API in read-only mode so the live database is never opened for writing:

```sh
B=/mnt/c/Users/brian/Documents/dev/t3-backup-$(date +%Y%m%d) && mkdir -p $B
~/.local/share/vite-plus/js_runtime/node/26.12.1/bin/node -e 'const {DatabaseSync,backup}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});backup(db,process.argv[2]).then(()=>console.log("ok"))' ~/.t3-stable/userdata/statev2.sqlite $B/statev2.sqlite
cp ~/.t3-stable/userdata/{settings.json,keybindings.json} ~/.t3-fork/{todos.json,todoist.json,config.json,state.json} $B/
```

To restore on the new host, put these files back in the same places **before** stable's first start. Leave out `statev2.sqlite-wal` and `-shm`.

## Rebuilding on a fresh host

1. **WSL.** Ubuntu with `/etc/wsl.conf` containing `[boot]` and `systemd=true`. Keep `networkingMode=mirrored` in `C:\Users\brian\.wslconfig`.
2. **Tools.** git, `gh` (logged in as briancoyne617), and Vite+ (`vp`, which brings Node 26) as upstream's [CONTRIBUTING.md](../CONTRIBUTING.md) describes. Builds must happen on the WSL disk (`~/ide`), not `/mnt/c`; it's about 80× faster.
3. **Clone.**
   ```sh
   mkdir -p ~/ide && git clone -b custom git@github.com:briancoyne617/t3code.git ~/ide/t3code
   cd ~/ide/t3code && git remote add upstream https://github.com/pingdotgg/t3code.git && git remote set-url --push upstream DISABLED-no-pushes-to-upstream
   ```
4. **Restore data** from the backup above into `~/.t3-stable/userdata/` and `~/.t3-fork/`.
5. **Install.** `./fork/bin/fork setup` creates the dev worktree, homes, services, timer, shims and Startup `.vbs`. It prints the one `sudo loginctl enable-linger` line to run yourself.
6. **First deploy.** `./fork/bin/fork promote --no-merge` builds `custom` and starts stable. Open http://localhost:3773 and pair with `t3 pair`.
7. **Reconnect.**
   - Todoist: write the token to `~/.t3-fork/todoist-token` (mode 600), then check `curl http://127.0.0.1:3775/api/todoist` shows `lastError: null`.
   - Codex: run `codex login --device-auth`. Enable the built-in Codex instance in Settings with binary path `~/.t3-stable/tools/codex/<version>/bin/codex`, since `codex` isn't on PATH.
   - Claude and other providers: sign in again in Settings.
8. **Dev.** Add `~/ide/t3code-dev` as a project in stable, then start dev (below).

## Known quirks

- **Dev doesn't survive a WSL restart.** `fork dev` runs in the foreground, so it runs as a transient unit:
  ```sh
  systemctl --user reset-failed t3-fork-dev; systemd-run --user --unit=t3-fork-dev --setenv=PATH=$HOME/.local/share/vite-plus/js_runtime/node/26.12.1/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin -p WorkingDirectory=$HOME/ide/t3code-dev $HOME/ide/t3code/fork/bin/fork dev
  ```
  Get its pairing link with `journalctl --user -u t3-fork-dev --no-pager | grep -o 'pairingUrl: .*' | tail -1`. Making this a permanent service is an open decision.
- **Windows can't reach a port.** WSL only forwards a port it saw bound. If a Windows `netsh interface portproxy` rule held the port when the service started, restart the service after removing the rule. An old rule list is saved at `Documents\dev\ide\t3-portproxy-before-todo-recovery.txt`.
- **Codex limits.** The managed ChatGPT token-sharing instance never reports usage limits (upstream hard-codes "unsupported"). The built-in Codex instance with its own `~/.codex` login does.
- **Context bar.** Upstream's meter is off by default (Settings → Legacy → "Context window indicator"). The setting is per browser origin. "Compact 330k / Keep" next to it is upstream's toggle for compacting after a provider switch.
- **Todoist auth errors.** The token file is trimmed, but stray characters inside it break auth (once it had "ls" appended). The sync logs only errors, to `journalctl --user -u t3-fork-todos`.
- **Docs-only commits** can land on `custom` with plain git (no promote), because they don't change the build.

## Open items

- Decide whether dev should start at boot (a permanent user service).
- Finish or drop the scan of other T3 Code forks for ideas (~108 left).
- Demo `fork rollback` and `fork sync-upstream --dry-run` once.
- Optional: install `fork/policy.json` to `/etc/t3code/policy.json` to refuse T3 Code self-updates machine-wide.
- Optional cleanup: delete the merged feature worktrees and branches.
