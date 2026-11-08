import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";

export const HOME = NodeOS.homedir();
export const FORK_ROOT = process.env.T3_FORK_ROOT ?? NodePath.join(HOME, ".t3-fork");
/** The checkout this CLI runs from: the stable `custom` checkout unless T3_FORK_LOCAL_TOOLING is set. */
export const TOOLING_REPO = NodePath.resolve(import.meta.dirname, "../../..");

export const P = {
  config: NodePath.join(FORK_ROOT, "config.json"),
  state: NodePath.join(FORK_ROOT, "state.json"),
  lock: NodePath.join(FORK_ROOT, "lock.json"),
  releases: NodePath.join(FORK_ROOT, "releases"),
  current: NodePath.join(FORK_ROOT, "current"),
  clientCurrent: NodePath.join(FORK_ROOT, "client-current"),
  snapshots: NodePath.join(FORK_ROOT, "snapshots"),
  logs: NodePath.join(FORK_ROOT, "logs"),
  work: NodePath.join(FORK_ROOT, "work"),
  plans: NodePath.join(FORK_ROOT, "plans"),
  stableEnv: NodePath.join(FORK_ROOT, "stable.env"),
};

export interface ForkConfig {
  repo: string;
  devWorktree: string;
  devBranch: string;
  stableHome: string;
  devHome: string;
  stableHost: string;
  stablePort: number;
  devPortOffset: number;
  unitName: string;
  keep: number;
  upstreamTarget: "stable-tag" | "main";
  push: boolean;
  idleQuietSeconds: number;
  idleTimeoutMinutes: number;
  healthTimeoutSeconds: number;
  /** Parallel typecheck/test jobs in promote checks; this machine has ~8 GB, so keep it low. */
  checkConcurrency: number;
}

export const DEFAULT_CONFIG: ForkConfig = {
  repo: NodePath.join(HOME, "ide", "t3code"),
  devWorktree: NodePath.join(HOME, "ide", "t3code-dev"),
  devBranch: "feat/dev-sandbox",
  stableHome: NodePath.join(HOME, ".t3-stable"),
  devHome: NodePath.join(HOME, ".t3-dev"),
  stableHost: "127.0.0.1",
  stablePort: 3773,
  devPortOffset: 100,
  unitName: "t3-fork-stable.service",
  keep: 3,
  upstreamTarget: "stable-tag",
  push: true,
  idleQuietSeconds: 30,
  idleTimeoutMinutes: 30,
  healthTimeoutSeconds: 240,
  checkConcurrency: 2,
};

export class ForkError extends Error {}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  NodeFS.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  NodeFS.renameSync(tmp, file);
}

export function loadConfig(): ForkConfig {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<ForkConfig>>(P.config) };
}

let logFile: string | undefined;
export let DRY_RUN = false;

export function setDryRun(value: boolean): void {
  DRY_RUN = value;
}

export function startLog(command: string): string {
  NodeFS.mkdirSync(P.logs, { recursive: true });
  logFile = NodePath.join(P.logs, `${timestamp()}-${command}.log`);
  return logFile;
}

let toConsole = true;

export function useLog(file: string, options: { console?: boolean } = {}): void {
  logFile = file;
  toConsole = options.console ?? true;
}

export function currentLog(): string | undefined {
  return logFile;
}

export function log(message: string): void {
  const line = `[fork ${new Date().toISOString().slice(11, 19)}] ${message}`;
  if (toConsole || !logFile) console.log(line);
  if (logFile) NodeFS.appendFileSync(logFile, `${line}\n`);
}

export function warn(message: string): void {
  log(`WARNING: ${message}`);
}

/** Every state-changing step goes through here so --dry-run can describe it instead. */
export function act<T>(description: string, fn: () => T): T | undefined {
  if (DRY_RUN) {
    log(`[dry-run] would ${description}`);
    return undefined;
  }
  log(`→ ${description}`);
  return fn();
}

export async function actAsync<T>(
  description: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (DRY_RUN) {
    log(`[dry-run] would ${description}`);
    return undefined;
  }
  log(`→ ${description}`);
  return fn();
}

export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

export const NODE_BIN = process.execPath;
export const VP_BIN = NodePath.join(HOME, ".local/share/vite-plus/bin/vp");

/** PATH for children: this Node first so `vp`, `node scripts/*.ts` and tests use the repo's Node. */
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [NodePath.dirname(NODE_BIN), NodePath.dirname(VP_BIN), process.env.PATH ?? ""].join(":"),
    ...extra,
  };
  // A shell inside T3 Code carries the server's launcher context; never leak it into builds or dev.
  delete env.T3_SERVICE_LAUNCHER_CONTEXT;
  delete env.T3_BOOT_SERVICE_UNIT;
  delete env.T3CODE_HOME;
  for (const [key, value] of Object.entries(extra)) if (value === undefined) delete env[key];
  return env;
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFail?: boolean;
  /** Stream output to the console instead of only the log file. */
  inherit?: boolean;
  input?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command and capture its output. Throws on a non-zero exit unless allowFail. */
export function capture(
  cmd: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): RunResult {
  const result = NodeChildProcess.spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? childEnv(),
    encoding: "utf8",
    input: options.input,
    maxBuffer: 256 * 1024 * 1024,
  });
  const out: RunResult = {
    code: result.status ?? (result.error ? 127 : 1),
    stdout: (result.stdout ?? "").toString().trim(),
    stderr: (result.stderr ?? result.error?.message ?? "").toString().trim(),
  };
  if (out.code !== 0 && !options.allowFail) {
    throw new ForkError(
      `${cmd} ${args.join(" ")} failed (exit ${out.code}): ${out.stderr || out.stdout}`,
    );
  }
  return out;
}

/** Run a long step. Output goes to the log file (and console with inherit); the tail is shown on failure. */
export function runStep(
  label: string,
  cmd: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): number {
  if (DRY_RUN) {
    log(
      `[dry-run] would run: ${label} (${cmd} ${args.join(" ")})${options.cwd ? ` in ${options.cwd}` : ""}`,
    );
    return 0;
  }
  log(`→ ${label}`);
  const started = Date.now();
  const spawnOptions: NodeChildProcess.SpawnSyncOptions = {
    cwd: options.cwd,
    env: options.env ?? childEnv(),
  };
  let fd: number | undefined;
  if (options.inherit || !logFile) {
    spawnOptions.stdio = "inherit";
  } else {
    fd = NodeFS.openSync(logFile, "a");
    spawnOptions.stdio = ["ignore", fd, fd];
  }
  // Builds and checks run at the lowest CPU/IO priority so they never starve the stable server's agents.
  const lowPriority = NodeOS.platform() === "linux";
  const result = lowPriority
    ? NodeChildProcess.spawnSync(
        "nice",
        ["-n", "19", "ionice", "-c", "3", cmd, ...args],
        spawnOptions,
      )
    : NodeChildProcess.spawnSync(cmd, args, spawnOptions);
  if (fd !== undefined) NodeFS.closeSync(fd);
  const code = result.status ?? 1;
  const seconds = Math.round((Date.now() - started) / 1000);
  if (code !== 0) {
    if (logFile && !options.inherit) {
      const tail = NodeFS.readFileSync(logFile, "utf8").split("\n").slice(-40).join("\n");
      console.log(tail);
    }
    if (!options.allowFail)
      throw new ForkError(`${label} failed (exit ${code}) after ${seconds}s. Full log: ${logFile}`);
  } else {
    log(`  done in ${seconds}s`);
  }
  return code;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Lock {
  owner: string;
  pid: number;
  since: string;
  token: string;
  log?: string;
}

export function acquireLock(owner: string, inheritToken?: string): Lock {
  NodeFS.mkdirSync(FORK_ROOT, { recursive: true });
  const existing = readJson<Lock>(P.lock);
  if (existing && existing.token !== inheritToken && pidAlive(existing.pid)) {
    throw new ForkError(
      `Another fork operation is running: ${existing.owner} (pid ${existing.pid}, since ${existing.since}).${existing.log ? ` Log: ${existing.log}` : ""}`,
    );
  }
  const lock: Lock = {
    owner,
    pid: process.pid,
    since: new Date().toISOString(),
    token: inheritToken ?? NodeCrypto.randomUUID(),
    ...(logFile ? { log: logFile } : {}),
  };
  if (!DRY_RUN) writeJsonAtomic(P.lock, lock);
  return lock;
}

export function releaseLock(lock: Lock): void {
  const existing = readJson<Lock>(P.lock);
  if (existing && existing.token === lock.token && existing.pid === process.pid) {
    NodeFS.rmSync(P.lock, { force: true });
  }
}

/** Atomically repoint a symlink (create beside it, then rename over it). */
export function flipPointer(link: string, target: string): void {
  const tmp = `${link}.tmp-${process.pid}`;
  NodeFS.rmSync(tmp, { force: true });
  NodeFS.symlinkSync(target, tmp);
  NodeFS.renameSync(tmp, link);
}

export function readPointer(link: string): string | undefined {
  try {
    return NodeFS.readlinkSync(link);
  } catch {
    return undefined;
  }
}

export function ask(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  const buffer = Buffer.alloc(256);
  let answer = "";
  try {
    const n = NodeFS.readSync(0, buffer, 0, buffer.length, null);
    answer = buffer.subarray(0, n).toString().trim().toLowerCase();
  } catch {
    return false;
  }
  return answer === "y" || answer === "yes";
}
