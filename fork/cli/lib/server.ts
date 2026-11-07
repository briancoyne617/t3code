import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { capture, childEnv, type ForkConfig, P, readJson, sleep } from "./core.ts";

export interface RuntimeState {
  pid: number;
  port: number;
  origin: string;
  startedAt: string;
  serverVersion?: string;
  devUrl?: string;
}

export function runtimeState(home: string): RuntimeState | undefined {
  return readJson<RuntimeState>(NodePath.join(home, "userdata", "server-runtime.json"));
}

export interface Descriptor {
  environmentId: string;
  serverVersion: string;
  orchestrationProtocolVersion?: number;
  databaseMigration?: number;
}

export async function descriptor(host: string, port: number): Promise<Descriptor | undefined> {
  try {
    const response = await fetch(`http://${host}:${port}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? ((await response.json()) as Descriptor) : undefined;
  } catch {
    return undefined;
  }
}

/** PIDs holding the home's ownership lock open. Read from /proc; never opens the lock itself. */
export function ownerPids(home: string): number[] {
  const lock = NodePath.join(home, "userdata", "server-owner.sqlite");
  const pids: number[] = [];
  for (const entry of NodeFS.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[];
    try {
      fds = NodeFS.readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (NodeFS.readlinkSync(`/proc/${entry}/fd/${fd}`) === lock) {
          pids.push(Number(entry));
          break;
        }
      } catch {
        // fd closed while scanning
      }
    }
  }
  return pids;
}

export interface ActiveRun {
  runId: string;
  threadId: string;
  status: string;
  title: string;
  requestedAt: string;
}

export interface TurnReport {
  available: boolean;
  live: ActiveRun[];
  waiting: ActiveRun[];
  queued: ActiveRun[];
}

/** Live = the server's own isLiveRun (preparing/starting/running). Waiting runs still lose background work on restart. */
export function readTurns(home: string, excludeThreadId?: string): TurnReport {
  const dbPath = NodePath.join(home, "userdata", "statev2.sqlite");
  const empty: TurnReport = { available: false, live: [], waiting: [], queued: [] };
  if (!NodeFS.existsSync(dbPath)) return empty;
  let db: NodeSqlite.DatabaseSync | undefined;
  try {
    db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true, timeout: 3000 });
    const rows = db
      .prepare(
        `SELECT r.run_id AS runId, r.thread_id AS threadId, r.status AS status,
                COALESCE(t.title, '') AS title, r.requested_at AS requestedAt
           FROM orchestration_v2_projection_runs r
           LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
          WHERE r.status IN ('preparing', 'starting', 'running', 'waiting', 'queued')
            AND t.deleted_at IS NULL`,
      )
      .all() as unknown as ActiveRun[];
    const kept = rows.filter((row) => row.threadId !== excludeThreadId);
    return {
      available: true,
      live: kept.filter((row) => ["preparing", "starting", "running"].includes(row.status)),
      waiting: kept.filter((row) => row.status === "waiting"),
      queued: kept.filter((row) => row.status === "queued"),
    };
  } catch {
    return empty;
  } finally {
    db?.close();
  }
}

/** Highest applied migration, read offline. Matches the descriptor's databaseMigration. */
export function dbMigration(home: string): number | undefined {
  const dbPath = NodePath.join(home, "userdata", "statev2.sqlite");
  if (!NodeFS.existsSync(dbPath)) return undefined;
  let db: NodeSqlite.DatabaseSync | undefined;
  try {
    db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true, timeout: 3000 });
    const row = db.prepare("SELECT MAX(migration_id) AS id FROM effect_sql_migrations").get() as
      | { id: number | null }
      | undefined;
    return row?.id ?? undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export function describeRuns(runs: ReadonlyArray<ActiveRun>): string {
  return runs.map((run) => `${run.status} "${run.title || run.threadId}"`).join(", ");
}

export function systemctl(args: ReadonlyArray<string>, allowFail = false) {
  return capture("systemctl", ["--user", ...args], { allowFail });
}

export interface UnitStatus {
  activeState: string;
  subState: string;
  mainPid: number;
  loaded: boolean;
}

export function unitStatus(cfg: ForkConfig): UnitStatus {
  const out = systemctl(
    ["show", cfg.unitName, "--property=ActiveState,SubState,MainPID,LoadState"],
    true,
  ).stdout;
  const props = Object.fromEntries(
    out.split("\n").map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  return {
    activeState: props.ActiveState ?? "unknown",
    subState: props.SubState ?? "unknown",
    mainPid: Number(props.MainPID ?? 0),
    loaded: props.LoadState === "loaded",
  };
}

export function processExe(pid: number): string | undefined {
  try {
    return NodeFS.readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return undefined;
  }
}

/** Which release a PID runs from, judged by the node binary it exec'd (each release has its own bin/node). */
export function releaseOfPid(pid: number): string | undefined {
  const exe = processExe(pid);
  const match = exe ? /\/releases\/([^/]+)\/bin\/node$/.exec(exe) : null;
  return match?.[1];
}

export function renderUnit(cfg: ForkConfig): string {
  const current = P.current;
  const log = NodePath.join(P.logs, "stable-server.log");
  return [
    "# Managed by fork/cli (fork setup). Runs the stable T3 Code server from ~/.t3-fork/current.",
    "[Unit]",
    "Description=T3 Code personal fork (stable)",
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h",
    `EnvironmentFile=${P.stableEnv}`,
    `ExecStart=${current}/bin/node ${current}/src/apps/server/dist/bin.mjs serve --base-dir ${cfg.stableHome} --host ${cfg.stableHost} --port ${cfg.stablePort}`,
    // Same policy as upstream's boot service (apps/server/src/cloud/bootService.ts).
    "KillMode=mixed",
    "TimeoutStopSec=90",
    "OOMPolicy=continue",
    "Restart=always",
    "RestartSec=5",
    "CPUWeight=1000",
    "IOWeight=1000",
    "MemoryLow=1536M",
    "OOMScoreAdjust=100",
    "ManagedOOMPreference=avoid",
    "LimitNOFILE=65536",
    `StandardOutput=append:${log}`,
    `StandardError=append:${log}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function unitPath(cfg: ForkConfig): string {
  return NodePath.join(
    process.env.XDG_CONFIG_HOME ?? NodePath.join(process.env.HOME ?? "", ".config"),
    "systemd/user",
    cfg.unitName,
  );
}

export async function waitUnitInactive(cfg: ForkConfig, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = unitStatus(cfg);
    if (status.activeState === "inactive" || status.activeState === "failed") return true;
    await sleep(1000);
  }
  return false;
}

export async function waitNoOwners(home: string, timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let owners = ownerPids(home);
  while (owners.length > 0 && Date.now() < deadline) {
    await sleep(1000);
    owners = ownerPids(home);
  }
  return owners;
}

export interface HealthResult {
  ok: boolean;
  reason: string;
  descriptor?: Descriptor;
  pid?: number;
}

/**
 * Healthy means: the unit's main process is the one that wrote server-runtime.json after we
 * restarted it, it runs from the expected release, and the environment descriptor answers.
 */
export async function waitHealthy(
  cfg: ForkConfig,
  options: { sinceMs: number; expectRelease: string; timeoutSeconds: number },
): Promise<HealthResult> {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let reason = "not started";
  while (Date.now() < deadline) {
    const status = unitStatus(cfg);
    if (status.activeState === "failed")
      return { ok: false, reason: `unit failed (${status.subState})` };
    const state = runtimeState(cfg.stableHome);
    const started = state ? Date.parse(state.startedAt) : 0;
    if (status.mainPid <= 0)
      reason = `unit ${status.activeState}/${status.subState}, no main process`;
    else if (releaseOfPid(status.mainPid) !== options.expectRelease)
      reason = `main process ${status.mainPid} runs ${releaseOfPid(status.mainPid) ?? "an unknown binary"}, expected ${options.expectRelease}`;
    else if (!state || state.pid !== status.mainPid || started < options.sinceMs - 1000)
      reason =
        "waiting for the new process to publish server-runtime.json (migrations can take a while)";
    else {
      const d = await descriptor(cfg.stableHost, cfg.stablePort);
      if (d) return { ok: true, reason: "healthy", descriptor: d, pid: status.mainPid };
      reason = "process is up but /.well-known/t3/environment does not answer yet";
    }
    await sleep(2000);
  }
  return { ok: false, reason: `timed out after ${options.timeoutSeconds}s: ${reason}` };
}

/** Start a command in its own transient systemd unit so it survives the stable server (and its terminals) stopping. */
export function detach(unit: string, logFile: string, command: ReadonlyArray<string>): void {
  const env = childEnv();
  capture("systemd-run", [
    "--user",
    "--collect",
    "--quiet",
    `--unit=${unit}`,
    `--property=StandardOutput=append:${logFile}`,
    `--property=StandardError=append:${logFile}`,
    `--setenv=PATH=${env.PATH}`,
    `--setenv=HOME=${process.env.HOME}`,
    ...(process.env.T3_FORK_ROOT ? [`--setenv=T3_FORK_ROOT=${process.env.T3_FORK_ROOT}`] : []),
    ...command,
  ]);
}
