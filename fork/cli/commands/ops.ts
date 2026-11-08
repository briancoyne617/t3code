import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import {
  childEnv,
  DRY_RUN,
  ForkError,
  type ForkConfig,
  HOME,
  log,
  P,
  pidAlive,
  readPointer,
  VP_BIN,
} from "../lib/core.ts";
import { applyHooks, footprint, writeFootprint } from "../lib/hooks.ts";
import {
  currentBranch,
  git,
  isClean,
  latestStableTag,
  readManifest,
  readState,
  revParse,
} from "../lib/release.ts";
import {
  dbMigration,
  describeRuns,
  descriptor,
  ownerPids,
  readTurns,
  releaseOfPid,
  runtimeState,
  unitStatus,
} from "../lib/server.ts";

const tilde = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

export async function status(
  cfg: ForkConfig,
  options: { fetch: boolean; json: boolean },
): Promise<void> {
  const repo = cfg.repo;
  if (options.fetch) git(repo, ["fetch", "--quiet", "--tags", "upstream"], true);
  const state = readState();
  const unit = unitStatus(cfg);
  const health = await descriptor(cfg.stableHost, cfg.stablePort);
  const turns = readTurns(cfg.stableHome);
  const stableOwners = ownerPids(cfg.stableHome);
  const devOwners = ownerPids(cfg.devHome);
  const devRuntime = runtimeState(cfg.devHome);
  const custom = revParse(repo, "custom");
  const upstreamMain = revParse(repo, "refs/remotes/upstream/main");
  const stableTag = (() => {
    try {
      return latestStableTag(repo);
    } catch {
      return undefined;
    }
  })();
  const count = (range: string) =>
    Number(git(repo, ["rev-list", "--count", range], true).stdout || 0);

  const report = {
    stable: {
      unit: `${cfg.unitName}: ${unit.activeState}/${unit.subState}${unit.mainPid ? `, pid ${unit.mainPid}` : ""}`,
      runningRelease: unit.mainPid ? releaseOfPid(unit.mainPid) : undefined,
      current: readPointer(P.current),
      clientCurrent: readPointer(P.clientCurrent),
      health: health
        ? `ok (version ${health.serverVersion}, protocol ${health.orchestrationProtocolVersion}, db migration ${health.databaseMigration})`
        : "not answering",
      url: `http://localhost:${cfg.stablePort}`,
      server: state.server
        ? { ...state.server, manifest: readManifest(state.server.release)?.branch }
        : undefined,
      client: state.client,
      turns: turns.available
        ? {
            running: turns.live.length,
            waiting: turns.waiting.length,
            queued: turns.queued.length,
            detail: describeRuns([...turns.live, ...turns.waiting]),
          }
        : "no database yet",
      dbMigration: health?.databaseMigration ?? dbMigration(cfg.stableHome),
      home: tilde(cfg.stableHome),
      owners: stableOwners,
    },
    dev: {
      worktree: NodeFS.existsSync(cfg.devWorktree)
        ? `${tilde(cfg.devWorktree)} on ${currentBranch(cfg.devWorktree)}${isClean(cfg.devWorktree) ? " (clean)" : " (uncommitted changes)"}`
        : "missing (run fork setup)",
      server:
        devRuntime && pidAlive(devRuntime.pid) && devOwners.length > 0
          ? `running, pid ${devRuntime.pid}, open ${(devRuntime.devUrl ?? devRuntime.origin).replace("localhost", "127.0.0.1")}`
          : "not running",
      home: tilde(cfg.devHome),
      owners: devOwners,
    },
    git: {
      custom: custom?.slice(0, 8),
      deployedServerSha: state.server?.sha.slice(0, 8),
      customAheadOfDeployed:
        custom && newestDeployedSha(state)
          ? count(`${newestDeployedSha(state)}..custom`)
          : undefined,
      behindUpstreamMain: upstreamMain ? count(`custom..${upstreamMain}`) : undefined,
      latestStableTag: stableTag,
      containsLatestStableTag: stableTag
        ? git(repo, ["merge-base", "--is-ancestor", stableTag, "custom"], true).code === 0
        : undefined,
    },
    officialHome: NodeFS.existsSync(NodePath.join(HOME, ".t3"))
      ? "~/.t3 EXISTS (something official ran here)"
      : "~/.t3 absent",
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const s = report.stable;
  const ownerLine = (owners: number[]) =>
    owners.length === 1
      ? `owner pid ${owners[0]} (exactly one ✓)`
      : owners.length === 0
        ? "no owner (stopped)"
        : `MULTIPLE OWNERS: ${owners.join(", ")} ✗`;
  const lines = [
    "Stable",
    `  service    ${s.unit}${s.runningRelease ? ` → release ${s.runningRelease}` : ""}`,
    `  health     ${s.health}  ${s.url}`,
    `  server     ${state.server ? `${state.server.release} (deployed ${state.server.at})` : "never deployed"}`,
    `  UI         ${state.client ? `${state.client.release} (deployed ${state.client.at})` : "never deployed"}`,
    `  turns      ${typeof s.turns === "string" ? s.turns : `${s.turns.running} running, ${s.turns.waiting} waiting, ${s.turns.queued} queued${s.turns.detail ? ` — ${s.turns.detail}` : ""}`}`,
    `  home       ${s.home}: ${ownerLine(s.owners)}`,
    "Dev",
    `  worktree   ${report.dev.worktree}`,
    `  server     ${report.dev.server}`,
    `  home       ${report.dev.home}: ${ownerLine(report.dev.owners)}`,
    "Git",
    `  custom     ${report.git.custom}${report.git.customAheadOfDeployed ? ` (${report.git.customAheadOfDeployed} commit(s) not deployed)` : report.git.deployedServerSha ? " (deployed)" : ""}`,
    `  upstream   custom is ${report.git.behindUpstreamMain ?? "?"} commit(s) behind upstream main; latest stable tag ${report.git.latestStableTag ?? "?"} ${report.git.containsLatestStableTag ? "is merged ✓" : "is NOT merged (fork sync-upstream)"}`,
    `             (as of the last fetch; pass --fetch to refresh)`,
    "Other",
    `  official   ${report.officialHome}`,
  ];
  console.log(lines.join("\n"));
}

export function devPorts(cfg: ForkConfig): { server: number; web: number } {
  return { server: 13773 + cfg.devPortOffset, web: 5733 + cfg.devPortOffset };
}

/** Run upstream's dev stack against the isolated dev home. Open it at 127.0.0.1 so its cookies stay apart from stable's. */
export async function dev(cfg: ForkConfig, extraArgs: ReadonlyArray<string>): Promise<void> {
  if (!NodeFS.existsSync(cfg.devWorktree))
    throw new ForkError(`${cfg.devWorktree} is missing; run fork setup`);
  const running = runtimeState(cfg.devHome);
  if (running && pidAlive(running.pid) && ownerPids(cfg.devHome).length > 0) {
    log(
      `dev is already running (pid ${running.pid}): ${(running.devUrl ?? running.origin).replace("localhost", "127.0.0.1")}`,
    );
    return;
  }
  const ports = devPorts(cfg);
  const args = [
    "run",
    "dev",
    "--home-dir",
    cfg.devHome,
    ...(DRY_RUN ? ["--dry-run"] : []),
    ...extraArgs,
  ];
  log(
    `starting dev in ${tilde(cfg.devWorktree)} with home ${tilde(cfg.devHome)} (expected web port ${ports.web}, server port ${ports.server})`,
  );
  const child = NodeChildProcess.spawn(VP_BIN, args, {
    cwd: cfg.devWorktree,
    env: childEnv({
      T3CODE_PORT_OFFSET: String(cfg.devPortOffset),
      T3CODE_DEV_ALLOWED_ORIGINS: `http://127.0.0.1:${ports.web}`,
      T3CODE_THREAD_ID: undefined,
    }),
    stdio: ["inherit", "pipe", "pipe"],
    // Own process group: upstream's dev runner does not pass signals down its chain, so stop the whole group.
    detached: true,
  });
  const rewrite = (chunk: Buffer) =>
    chunk.toString().replace(/http:\/\/localhost:(\d+)/g, "http://127.0.0.1:$1");
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(rewrite(chunk)));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(rewrite(chunk)));
  const stopGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      // already gone
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => stopGroup("SIGINT"));
  process.on("exit", () => stopGroup("SIGTERM"));
  await new Promise<void>((resolve) =>
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    }),
  );
}

/** Copy a small read-only snapshot of stable's data into dev (dev must be stopped). */
export function seedDevFromStable(cfg: ForkConfig): void {
  if (ownerPids(cfg.devHome).length > 0) throw new ForkError("Stop dev before seeding it");
  const source = NodePath.join(cfg.stableHome, "userdata", "statev2.sqlite");
  if (!NodeFS.existsSync(source)) throw new ForkError(`${source} does not exist yet`);
  const result = NodeChildProcess.spawn(
    process.execPath,
    ["apps/server/scripts/migrate-dev-db.ts", "--base-dir", cfg.devHome, "--source", source],
    {
      cwd: cfg.devWorktree,
      env: childEnv(),
      stdio: "inherit",
    },
  );
  result.on("exit", (code) => (process.exitCode = code ?? 1));
}

const REFUSED = new Set(["update", "service", "uninstall", "up"]);

/** The stable server's own CLI, pointed at the stable home. Update and service commands would replace the fork with upstream. */
export function t3(cfg: ForkConfig, args: ReadonlyArray<string>): void {
  if (args[0] && REFUSED.has(args[0])) {
    throw new ForkError(
      `\`t3 ${args[0]}\` is disabled in this fork: it would install upstream's runtime or service over it. Use fork promote / fork rollback / fork status.`,
    );
  }
  const bin = NodePath.join(P.current, "src/apps/server/dist/bin.mjs");
  if (!NodeFS.existsSync(bin))
    throw new ForkError("No stable release is deployed yet (fork promote)");
  const child = NodeChildProcess.spawn(NodePath.join(P.current, "bin/node"), [bin, ...args], {
    env: { ...childEnv(), T3CODE_HOME: cfg.stableHome },
    stdio: "inherit",
  });
  child.on("exit", (code) => (process.exitCode = code ?? 1));
}

export async function hooksCommand(
  cfg: ForkConfig,
  options: { check: boolean; repo?: string },
): Promise<void> {
  const repo = options.repo ?? process.cwd();
  const results = await applyHooks(repo, { write: !options.check && !DRY_RUN });
  for (const result of results)
    log(
      `${result.file}: ${result.changed ? (options.check || DRY_RUN ? "OUT OF DATE" : "updated") : "up to date"}`,
    );
  if (options.check && results.some((r) => r.changed)) process.exitCode = 1;
  void cfg;
}

export function footprintCommand(options: { write: boolean; repo?: string }): void {
  const repo = options.repo ?? process.cwd();
  if (options.write && !DRY_RUN) {
    const budgets = writeFootprint(repo);
    log(`recorded budgets in fork/footprint.json: ${JSON.stringify(budgets)}`);
    return;
  }
  const rows = footprint(repo);
  if (rows.length === 0) log("the fork edits no upstream files");
  for (const row of rows)
    log(
      `${row.problem ? "✗" : "✓"} ${row.file}: ${row.lines} line(s), budget ${row.budget ?? "none"}${row.problem ? ` — ${row.problem}` : ""}`,
    );
  if (rows.some((row) => row.problem)) process.exitCode = 1;
}

export interface PendingBranch {
  branch: string;
  head: string;
  commits: string[];
  behindCustom: number;
  areas: string[];
  restartsServer: boolean;
  files: number;
}

/** A UI-only promote still ships a full release built from custom, so the newest deploy is what is live. */
function newestDeployedSha(state: {
  server?: { sha: string; at: string };
  client?: { sha: string; at: string };
}): string | undefined {
  const deploys = [state.server, state.client].filter((d) => d !== undefined);
  deploys.sort((a, b) => b.at.localeCompare(a.at));
  return deploys[0]?.sha;
}

export interface PendingReport {
  generatedAt: string;
  deployed: { server?: string; ui?: string; custom?: string };
  customUndeployed: string[];
  branches: PendingBranch[];
  devWorktree: { branch: string; uncommitted: number };
}

function areasOf(files: ReadonlyArray<string>): { areas: string[]; restartsServer: boolean } {
  const areas = new Set<string>();
  let restartsServer = false;
  for (const file of files) {
    if (file.startsWith("apps/web/")) areas.add("UI");
    else if (
      file.startsWith("apps/server/") ||
      file === "pnpm-lock.yaml" ||
      file === "package.json"
    ) {
      areas.add("server");
      restartsServer = true;
    } else if (file.startsWith("packages/")) {
      areas.add("shared code (UI + server)");
      restartsServer = true;
    } else if (file.startsWith("fork/")) areas.add("fork tooling");
    else if (file.startsWith("apps/desktop/") || file.startsWith("apps/mobile/"))
      areas.add("desktop/mobile (not used)");
    else if (file.startsWith("docs/") || file.endsWith(".md")) areas.add("docs");
    else areas.add("other");
  }
  return { areas: [...areas], restartsServer };
}

/** What dev has that stable does not: every unmerged local branch, classified by what pulling it touches. */
export function pending(
  cfg: ForkConfig,
  options: { json: boolean; write: boolean },
): PendingReport {
  const repo = cfg.repo;
  const state = readState();
  const lines = (args: string[]) => git(repo, args, true).stdout.split("\n").filter(Boolean);
  const branches: PendingBranch[] = [];
  for (const branch of lines(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])) {
    if (branch === "custom" || branch === "main") continue;
    if (git(repo, ["merge-base", "--is-ancestor", branch, "custom"], true).code === 0) continue;
    const files = lines(["diff", "--name-only", `custom...${branch}`]);
    const { areas, restartsServer } = areasOf(files);
    branches.push({
      branch,
      head: git(repo, ["rev-parse", "--short", branch]).stdout,
      commits: lines(["log", "--no-merges", "--format=%s", `custom..${branch}`]),
      behindCustom: Number(
        git(repo, ["rev-list", "--count", `${branch}..custom`], true).stdout || 0,
      ),
      areas,
      restartsServer,
      files: files.length,
    });
  }
  const report: PendingReport = {
    generatedAt: new Date().toISOString(),
    deployed: {
      ...(state.server ? { server: state.server.sha.slice(0, 8) } : {}),
      ...(state.client ? { ui: state.client.sha.slice(0, 8) } : {}),
      custom: revParse(repo, "custom")?.slice(0, 8),
    },
    customUndeployed: newestDeployedSha(state)
      ? lines(["log", "--no-merges", "--format=%s", `${newestDeployedSha(state)}..custom`])
      : [],
    branches,
    devWorktree: NodeFS.existsSync(cfg.devWorktree)
      ? {
          branch: currentBranch(cfg.devWorktree),
          uncommitted: git(cfg.devWorktree, ["status", "--porcelain"], true)
            .stdout.split("\n")
            .filter(Boolean).length,
        }
      : { branch: "", uncommitted: 0 },
  };
  if (options.write && !DRY_RUN) {
    const tmp = `${P.pending}.tmp`;
    NodeFS.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
    NodeFS.renameSync(tmp, P.pending);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else if (!options.write) {
    for (const b of report.branches) {
      log(
        `${b.branch} (${b.head}): ${b.commits.length} commit(s), touches ${b.areas.join(", ")}${b.restartsServer ? " — restarts stable" : ""}`,
      );
      for (const c of b.commits) console.log(`    • ${c}`);
    }
    if (report.branches.length === 0) log("dev has nothing that stable lacks");
  }
  return report;
}
