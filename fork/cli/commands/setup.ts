import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  act,
  capture,
  DEFAULT_CONFIG,
  type ForkConfig,
  HOME,
  log,
  P,
  readJson,
  TOOLING_REPO,
  warn,
  writeJsonAtomic,
} from "../lib/core.ts";
import { git, revParse } from "../lib/release.ts";
import { renderUnit, systemctl, unitPath } from "../lib/server.ts";

/** One-time (and idempotent) install. Each step checks first and only acts when something is missing or stale. */
export async function setup(cfg: ForkConfig): Promise<void> {
  for (const dir of [P.releases, P.snapshots, P.logs, P.work, P.plans]) {
    if (!NodeFS.existsSync(dir))
      act(`create ${dir}`, () => NodeFS.mkdirSync(dir, { recursive: true }));
  }
  if (!NodeFS.existsSync(P.config))
    act(`write ${P.config}`, () => writeJsonAtomic(P.config, { ...DEFAULT_CONFIG, ...cfg }));

  for (const home of [cfg.stableHome, cfg.devHome]) {
    if (!NodeFS.existsSync(home))
      act(`create T3 home ${home}`, () => NodeFS.mkdirSync(home, { recursive: true, mode: 0o700 }));
  }

  // Dev worktree on its own branch off custom.
  if (!NodeFS.existsSync(cfg.devWorktree)) {
    act(`create dev worktree ${cfg.devWorktree} on ${cfg.devBranch}`, () => {
      const exists = revParse(cfg.repo, `refs/heads/${cfg.devBranch}`);
      git(cfg.repo, [
        "worktree",
        "add",
        ...(exists
          ? [cfg.devWorktree, cfg.devBranch]
          : ["-b", cfg.devBranch, cfg.devWorktree, "custom"]),
      ]);
    });
  } else {
    log(`dev worktree exists: ${cfg.devWorktree}`);
  }

  // Environment for the service: the PATH your interactive shell has, so provider CLIs resolve.
  const shellPath =
    capture("bash", ["-ic", 'printf "__PATH__%s" "$PATH"'], { allowFail: true })
      .stdout.split("__PATH__")
      .pop() ||
    process.env.PATH ||
    "";
  const envText = [`PATH=${shellPath}`, "LANG=C.UTF-8", ""].join("\n");
  if (!NodeFS.existsSync(P.stableEnv) || NodeFS.readFileSync(P.stableEnv, "utf8") !== envText) {
    act(`write ${P.stableEnv} (PATH for the stable server and its agents)`, () =>
      NodeFS.writeFileSync(P.stableEnv, envText, { mode: 0o600 }),
    );
  }

  // systemd user unit.
  const unitFile = unitPath(cfg);
  const unit = renderUnit(cfg);
  if (!NodeFS.existsSync(unitFile) || NodeFS.readFileSync(unitFile, "utf8") !== unit) {
    act(`install ${unitFile}`, () => {
      NodeFS.mkdirSync(NodePath.dirname(unitFile), { recursive: true });
      NodeFS.writeFileSync(unitFile, unit);
      systemctl(["daemon-reload"]);
      systemctl(["enable", cfg.unitName]);
    });
  } else {
    log(`service ${cfg.unitName} is installed and up to date`);
  }

  // `t3` on PATH, pointed at stable, with update/service commands refused.
  const t3Shim = NodePath.join(HOME, ".local/bin/t3");
  const shimText = `#!/bin/sh\n# T3 Code personal fork: runs the stable release's CLI against ${cfg.stableHome}.\nexec "${NodePath.join(cfg.repo, "fork/bin/fork")}" t3 "$@"\n`;
  const existingShim = NodeFS.existsSync(t3Shim) ? NodeFS.readFileSync(t3Shim, "utf8") : undefined;
  if (existingShim !== shimText) {
    if (existingShim !== undefined && !existingShim.includes("T3 Code personal fork")) {
      warn(`${t3Shim} exists and is not ours; leaving it alone`);
    } else {
      act(`install ${t3Shim}`, () => {
        NodeFS.mkdirSync(NodePath.dirname(t3Shim), { recursive: true });
        NodeFS.writeFileSync(t3Shim, shimText, { mode: 0o755 });
      });
    }
  }

  setupWindowsKeepAlive();

  const linger = capture("loginctl", ["show-user", process.env.USER ?? "", "--property=Linger"], {
    allowFail: true,
  }).stdout;
  const notes: string[] = [];
  if (!linger.includes("yes"))
    notes.push(
      `sudo loginctl enable-linger ${process.env.USER}   # start your user services at boot without a login`,
    );
  if (!NodeFS.existsSync("/etc/t3code/policy.json")) {
    notes.push(
      `sudo install -d -m 755 /etc/t3code && sudo install -m 644 ${NodePath.join(TOOLING_REPO, "fork/policy.json")} /etc/t3code/policy.json   # optional: refuse every T3 Code self-update on this machine`,
    );
  }
  if (notes.length > 0) {
    log("run these yourself (they need your sudo password):");
    for (const note of notes) console.log(`  ${note}`);
  }
}

/** WSL stops the distro when no Windows process holds it open; a hidden `sleep` started at logon keeps it (and the service) up. */
function setupWindowsKeepAlive(): void {
  const distro = process.env.WSL_DISTRO_NAME;
  if (!distro) return;
  const appData = capture("/mnt/c/Windows/System32/cmd.exe", ["/c", "echo %APPDATA%"], {
    allowFail: true,
  })
    .stdout.replace(/\r/g, "")
    .trim();
  if (!appData || appData.includes("%")) {
    warn("could not find the Windows Startup folder; WSL will not start on its own at logon");
    return;
  }
  const startup = capture("wslpath", [
    "-u",
    `${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`,
  ]).stdout;
  const file = NodePath.join(startup, "t3-fork-wsl-keepalive.vbs");
  const text = [
    "' T3 Code personal fork: keeps the WSL distro running so the stable server (a systemd user service) stays up.",
    "' Remove this file to stop that. Docs: ~/ide/t3code/fork/README.md",
    `CreateObject("WScript.Shell").Run "wsl.exe -d ${distro} --exec /bin/sh -c ""exec sleep infinity""", 0, False`,
    "",
  ].join("\r\n");
  if (NodeFS.existsSync(file) && NodeFS.readFileSync(file, "utf8") === text) {
    log("Windows logon keep-alive is installed");
    return;
  }
  act(`install Windows logon keep-alive ${file} and start it now`, () => {
    NodeFS.writeFileSync(file, text);
    capture(
      "/mnt/c/Windows/System32/cmd.exe",
      ["/c", "start", "", "wscript.exe", capture("wslpath", ["-w", file]).stdout],
      { allowFail: true, cwd: "/mnt/c" },
    );
  });
}

export function configSummary(cfg: ForkConfig): string {
  const saved = readJson<Partial<ForkConfig>>(P.config);
  return JSON.stringify({ ...cfg, savedAt: saved ? P.config : "defaults" }, null, 2);
}
