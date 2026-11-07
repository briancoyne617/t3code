import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  acquireLock,
  act,
  actAsync,
  ask,
  currentLog,
  DRY_RUN,
  flipPointer,
  ForkError,
  type ForkConfig,
  type Lock,
  log,
  NODE_BIN,
  P,
  readJson,
  readPointer,
  releaseLock,
  runStep,
  sleep,
  timestamp,
  TOOLING_REPO,
  useLog,
  VP_BIN,
  warn,
  writeJsonAtomic,
} from "../lib/core.ts";
import { applyHooks, footprint } from "../lib/hooks.ts";
import {
  buildRelease,
  currentBranch,
  git,
  isAncestor,
  isClean,
  makeClone,
  type Manifest,
  newReleaseId,
  prune,
  readManifest,
  readState,
  recordHistory,
  releaseDir,
  restoreSnapshot,
  revParse,
  sealRelease,
  snapshotMeta,
  takeSnapshot,
  upstreamBase,
  writeState,
} from "../lib/release.ts";
import {
  dbMigration,
  describeRuns,
  descriptor,
  detach,
  ownerPids,
  readTurns,
  systemctl,
  unitStatus,
  waitHealthy,
  waitNoOwners,
  waitUnitInactive,
} from "../lib/server.ts";

function stableRunning(cfg: ForkConfig): boolean {
  return unitStatus(cfg).activeState === "active";
}

/** Wait until stable has no live or waiting turns for a quiet period. The calling thread is ignored. */
async function waitForIdle(
  cfg: ForkConfig,
  options: { timeoutMinutes: number; quietSeconds: number },
): Promise<boolean> {
  const exclude = process.env.T3CODE_THREAD_ID;
  if (exclude)
    log(
      `ignoring the thread this command runs in (${exclude}); restart continuation will resume it`,
    );
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let quietSince: number | undefined;
  let lastReport = "";
  while (Date.now() < deadline) {
    const turns = readTurns(cfg.stableHome, exclude);
    const busy = [...turns.live, ...turns.waiting];
    if (busy.length === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= options.quietSeconds * 1000) return true;
    } else {
      quietSince = undefined;
      const report = describeRuns(busy);
      if (report !== lastReport) log(`waiting for stable to go idle: ${report}`);
      lastReport = report;
    }
    await sleep(2000);
  }
  return false;
}

export interface PromoteOptions {
  branch?: string;
  noMerge: boolean;
  force: boolean;
  skipTests: boolean;
  fullTests: boolean;
  timeoutMinutes?: number;
}

export async function promote(cfg: ForkConfig, options: PromoteOptions): Promise<void> {
  const lock = acquireLock("promote");
  let handedOff = false;
  try {
    const repo = cfg.repo;
    if (currentBranch(repo) !== "custom")
      throw new ForkError(`${repo} must have \`custom\` checked out`);
    if (!isClean(repo))
      throw new ForkError(`${repo} has uncommitted changes; commit or stash them first`);

    let feature: string | undefined;
    if (!options.noMerge) {
      feature = options.branch ?? currentBranch(cfg.devWorktree);
      if (!feature)
        throw new ForkError(
          `Cannot tell which branch to promote; pass one (fork promote <branch>)`,
        );
      if (feature === "custom") feature = undefined;
      else if (!options.branch && !isClean(cfg.devWorktree)) {
        throw new ForkError(
          `${cfg.devWorktree} has uncommitted changes; commit them on ${feature} first (only commits are promoted)`,
        );
      }
    }
    const state = readState();
    const deployedServer = state.server ? readManifest(state.server.release) : undefined;
    const deployedClient = state.client ? readManifest(state.client.release) : undefined;
    const customSha = revParse(repo, "custom")!;
    if (feature && !revParse(repo, feature))
      throw new ForkError(`Branch ${feature} not found in ${repo}`);
    if (feature && isAncestor(repo, feature, "custom")) {
      log(`${feature} is already merged into custom`);
      feature = undefined;
    }
    log(
      feature
        ? `promoting ${feature} into custom (${customSha.slice(0, 8)})`
        : `building custom as is (${customSha.slice(0, 8)})`,
    );

    // 1. Clone + merge in a fresh release folder. `custom` itself only moves after a successful deploy.
    NodeFS.mkdirSync(P.releases, { recursive: true });
    const building = NodePath.join(P.releases, `.building-${timestamp()}`);
    const src = NodePath.join(building, "src");
    let sha = customSha;
    act(`create a clean clone for the new release in ${building}`, () => {
      NodeFS.mkdirSync(building, { recursive: true });
      makeClone(repo, src, "custom");
      if (feature) {
        const merged = git(
          src,
          [
            "merge",
            "--no-ff",
            "--no-edit",
            "-m",
            `Merge ${feature} into custom (fork promote)`,
            `origin/${feature}`,
          ],
          true,
        );
        if (merged.code !== 0) {
          const conflicts = git(src, ["diff", "--name-only", "--diff-filter=U"], true).stdout;
          NodeFS.rmSync(building, { recursive: true, force: true });
          throw new ForkError(
            `Merging ${feature} into custom conflicts in:\n${conflicts || merged.stderr}\nMerge custom into ${feature} in ${cfg.devWorktree}, resolve, commit, then promote again.`,
          );
        }
      }
      sha = git(src, ["rev-parse", "HEAD"]).stdout;
    });
    if (deployedServer?.sha === sha && deployedClient?.sha === sha && !options.force) {
      if (!DRY_RUN) NodeFS.rmSync(building, { recursive: true, force: true });
      log(`commit ${sha.slice(0, 8)} is already deployed; nothing to do (pass --force to rebuild)`);
      return;
    }
    const id = newReleaseId(sha);
    const dir = releaseDir(id);
    act(`name the release ${id}`, () => NodeFS.renameSync(building, dir));
    const releaseSrc = NodePath.join(dir, "src");

    // 2. Build and check.
    buildRelease(dir);
    const checkBase = deployedServer?.sha ?? upstreamBase(repo, "custom");
    if (options.skipTests) {
      warn("skipping tests (--skip-tests)");
    } else if (DRY_RUN) {
      log(
        `[dry-run] would check fork hooks + footprint, then run vp run ${options.fullTests ? "typecheck + test" : `check:changed ${checkBase.slice(0, 8)}`}`,
      );
    } else {
      await checks(releaseSrc, checkBase, options.fullTests);
    }
    let manifest: Manifest | undefined;
    act("seal the release (own Node binary, UI copy, live-swappable client link)", () => {
      manifest = sealRelease(dir, {
        sha,
        branch: feature ?? "custom",
        tests: options.skipTests ? "skipped" : options.fullTests ? "full" : "changed",
        carryFrom: readPointer(P.clientCurrent),
      });
    });

    // 3. What changed? Decided from build outputs, not file names.
    const serverChanged =
      !deployedServer ||
      !manifest ||
      manifest.serverFingerprint !== deployedServer.serverFingerprint;
    const clientChanged =
      !deployedClient ||
      !manifest ||
      manifest.clientFingerprint !== deployedClient.clientFingerprint;
    explainChanges(releaseSrc, deployedServer?.sha, sha, serverChanged, clientChanged);

    if (!serverChanged && !clientChanged) {
      log(
        "no runtime change (only tooling, docs or tests changed); moving custom without touching stable",
      );
      finalizeGit(cfg, sha);
      if (!DRY_RUN) NodeFS.rmSync(dir, { recursive: true, force: true });
      recordHistory({
        at: new Date().toISOString(),
        kind: "client",
        result: "ok",
        sha,
        note: "no runtime change",
      });
      return;
    }

    if (!serverChanged) {
      // 4a. UI only: repoint the served UI. The server and every agent keep running.
      const before = state.client?.release;
      act(`switch the stable UI to ${id} (no server restart)`, () =>
        flipPointer(P.clientCurrent, NodePath.join(dir, "web")),
      );
      const next = readState();
      next.client = { release: id, sha, at: new Date().toISOString() };
      next.history.push({
        at: new Date().toISOString(),
        kind: "client",
        result: "ok",
        sha,
        fromClient: before,
        toClient: id,
      });
      writeState(next);
      finalizeGit(cfg, sha);
      prune(cfg);
      log(
        `UI updated. Reload the T3 Code tab (http://localhost:${cfg.stablePort}). Agents were not interrupted.`,
      );
      return;
    }

    // 4b. Server changed: wait for idle, then restart from a detached job.
    if (stableRunning(cfg) && !options.force) {
      const idle = await waitForIdle(cfg, {
        timeoutMinutes: options.timeoutMinutes ?? cfg.idleTimeoutMinutes,
        quietSeconds: cfg.idleQuietSeconds,
      });
      if (!idle) {
        throw new ForkError(
          `stable still has running turns after ${options.timeoutMinutes ?? cfg.idleTimeoutMinutes} minutes. The release is built (${id}); run \`fork promote --no-merge --force\` to restart anyway (restart continuation resumes cut turns), or try again later.`,
        );
      }
    } else if (options.force && stableRunning(cfg)) {
      const turns = readTurns(cfg.stableHome);
      if (turns.live.length + turns.waiting.length > 0)
        warn(
          `--force: restarting with running turns (${describeRuns([...turns.live, ...turns.waiting])})`,
        );
    }
    const plan: SwapPlan = {
      token: lock.token,
      mode: "promote",
      toServer: id,
      toClient: id,
      fromServer: state.server?.release,
      fromClient: state.client?.release,
      sha,
      force: options.force,
      excludeThread: process.env.T3CODE_THREAD_ID,
      takeSnapshot: true,
      log: currentLog() ?? NodePath.join(P.logs, `${timestamp()}-swap.log`),
    };
    handedOff = (await launchSwap(cfg, plan)) ?? false;
  } finally {
    if (!handedOff) releaseLock(lock);
  }
}

async function checks(src: string, base: string, full: boolean): Promise<void> {
  log("checking fork hooks and footprint");
  const hooks = await applyHooks(src, { write: false });
  const stale = hooks.filter((hook) => hook.changed);
  if (stale.length > 0)
    throw new ForkError(
      `Fork hook files are out of date: ${stale.map((h) => h.file).join(", ")}. Run \`fork hooks\` and commit.`,
    );
  const problems = footprint(src).filter((row) => row.problem);
  if (problems.length > 0) {
    throw new ForkError(
      `Fork footprint check failed:\n${problems.map((row) => `  ${row.file}: ${row.problem}`).join("\n")}`,
    );
  }
  if (full) {
    runStep("typecheck everything (vp run typecheck)", VP_BIN, ["run", "typecheck"], { cwd: src });
    runStep("run every test (vp run test)", VP_BIN, ["run", "test"], { cwd: src });
  } else {
    runStep(
      `checks for changes since ${base.slice(0, 8)} (vp run check:changed)`,
      VP_BIN,
      ["run", "check:changed", base],
      { cwd: src },
    );
  }
}

function explainChanges(
  src: string,
  fromSha: string | undefined,
  toSha: string,
  server: boolean,
  client: boolean,
): void {
  if (fromSha && !DRY_RUN) {
    const files = git(src, ["diff", "--name-only", fromSha, toSha], true)
      .stdout.split("\n")
      .filter(Boolean);
    const areas = new Map<string, number>();
    for (const file of files) {
      const parts = file.split("/");
      const area =
        ["apps", "packages"].includes(parts[0]!) && parts[1]
          ? `${parts[0]}/${parts[1]}`
          : parts[0]!;
      areas.set(area, (areas.get(area) ?? 0) + 1);
    }
    log(
      `source changes since ${fromSha.slice(0, 8)}: ${[...areas].map(([area, n]) => `${area} (${n})`).join(", ") || "none"}`,
    );
  }
  log(
    `build output: server ${server ? "CHANGED" : "unchanged"}, UI ${client ? "CHANGED" : "unchanged"}`,
  );
}

/** Fast-forward `custom` to the deployed commit and push it. Never forces. */
export function finalizeGit(cfg: ForkConfig, sha: string): void {
  const repo = cfg.repo;
  act(`fast-forward custom to ${sha.slice(0, 8)}`, () => {
    if (currentBranch(repo) !== "custom" || !isClean(repo)) {
      warn(
        `${repo} is not a clean checkout of custom; custom was NOT moved. Run: git -C ${repo} merge --ff-only ${sha}`,
      );
      return;
    }
    const release = NodeFS.readdirSync(P.releases).find((name) => name.endsWith(sha.slice(0, 8)));
    if (release && !revParse(repo, sha))
      git(repo, ["fetch", "--quiet", NodePath.join(P.releases, release, "src"), sha]);
    git(repo, ["merge", "--ff-only", "--quiet", sha]);
  });
  if (cfg.push) {
    act("push custom to origin", () => {
      const pushed = git(repo, ["push", "--quiet", "origin", "custom"], true);
      if (pushed.code !== 0) warn(`push failed (deploy is fine): ${pushed.stderr}`);
    });
  }
}

export interface SwapPlan {
  token: string;
  mode: "promote" | "rollback";
  toServer: string;
  toClient: string;
  fromServer?: string;
  fromClient?: string;
  sha: string;
  force: boolean;
  excludeThread?: string;
  takeSnapshot: boolean;
  restoreSnapshot?: string;
  log: string;
}

const RESULT_MARK = "SWAP RESULT:";

/** Hand the restart to a transient systemd unit, then follow its log until it reports a result. */
async function launchSwap(cfg: ForkConfig, plan: SwapPlan): Promise<boolean | undefined> {
  const planFile = NodePath.join(P.plans, `${timestamp()}-${plan.mode}.json`);
  const unit = `t3-fork-swap-${timestamp().replace(/-/g, "")}`;
  return actAsync(`hand the restart to detached unit ${unit} (log: ${plan.log})`, async () => {
    writeJsonAtomic(planFile, plan);
    const offset = NodeFS.existsSync(plan.log) ? NodeFS.statSync(plan.log).size : 0;
    detach(unit, plan.log, [
      NODE_BIN,
      NodePath.join(TOOLING_REPO, "fork/cli/main.ts"),
      "swap",
      "--plan",
      planFile,
    ]);
    log(
      "the swap now runs on its own; it keeps going even if this terminal closes when the server restarts",
    );
    const deadline = Date.now() + (cfg.healthTimeoutSeconds * 2 + 180) * 1000;
    let position = offset;
    while (Date.now() < deadline) {
      await sleep(1000);
      if (!NodeFS.existsSync(plan.log)) continue;
      const size = NodeFS.statSync(plan.log).size;
      if (size > position) {
        const fd = NodeFS.openSync(plan.log, "r");
        const chunk = Buffer.alloc(size - position);
        NodeFS.readSync(fd, chunk, 0, chunk.length, position);
        NodeFS.closeSync(fd);
        position = size;
        const text = chunk.toString();
        process.stdout.write(
          text
            .split("\n")
            .map((line) => (line ? `  | ${line}` : line))
            .join("\n"),
        );
        if (text.includes(RESULT_MARK)) {
          if (!text.includes(`${RESULT_MARK} ok`)) process.exitCode = 1;
          return true;
        }
      }
    }
    warn(`stopped following the swap; it may still be running. Check: fork status, ${plan.log}`);
    return true;
  });
}

/** Runs inside the detached unit. Stop → snapshot → flip → start → health check → roll back on failure. */
export async function swap(cfg: ForkConfig, planFile: string): Promise<void> {
  const plan = readJson<SwapPlan>(planFile);
  if (!plan) throw new ForkError(`Plan ${planFile} is unreadable`);
  useLog(plan.log);
  let lock: Lock | undefined;
  let result = "failed";
  try {
    lock = acquireLock(`swap (${plan.mode})`, plan.token);
    log(`swap: ${plan.mode} server ${plan.fromServer ?? "(none)"} → ${plan.toServer}`);
    if (!NodeFS.existsSync(NodePath.join(releaseDir(plan.toServer), "manifest.json")))
      throw new ForkError(`Release ${plan.toServer} is missing`);

    if (!plan.force && unitStatus(cfg).activeState === "active") {
      const turns = readTurns(cfg.stableHome, plan.excludeThread);
      const busy = [...turns.live, ...turns.waiting];
      if (busy.length > 0) {
        log(
          `swap aborted before stopping anything: a turn started in the meantime (${describeRuns(busy)})`,
        );
        result = "aborted";
        return;
      }
    }
    const migrationBefore =
      (await descriptor(cfg.stableHost, cfg.stablePort))?.databaseMigration ??
      dbMigration(cfg.stableHome);

    log("stopping the stable server");
    systemctl(["stop", cfg.unitName], true);
    if (!(await waitUnitInactive(cfg, 120_000)))
      throw new ForkError("stable did not stop within 120s");
    const owners = await waitNoOwners(cfg.stableHome, 30_000);
    if (owners.length > 0)
      throw new ForkError(
        `something else still owns ${cfg.stableHome}: pid(s) ${owners.join(", ")}. Refusing to continue.`,
      );

    let snapshot: string | undefined;
    if (plan.takeSnapshot) {
      snapshot = takeSnapshot(cfg.stableHome, `${timestamp()}-before-${plan.toServer}`, {
        release: plan.fromServer,
        dbMigration: dbMigration(cfg.stableHome),
        reason: `${plan.mode} to ${plan.toServer}`,
      });
      log(`snapshot of userdata: ${snapshot}`);
    }
    if (plan.restoreSnapshot) {
      log(`restoring database snapshot ${plan.restoreSnapshot}`);
      restoreSnapshot(cfg.stableHome, plan.restoreSnapshot);
    }

    flipPointer(P.current, releaseDir(plan.toServer));
    flipPointer(P.clientCurrent, NodePath.join(releaseDir(plan.toClient), "web"));
    const restartedAt = Date.now();
    log(`starting stable from ${plan.toServer}`);
    systemctl(["start", cfg.unitName]);
    const health = await waitHealthy(cfg, {
      sinceMs: restartedAt,
      expectRelease: plan.toServer,
      timeoutSeconds: cfg.healthTimeoutSeconds,
    });

    if (health.ok) {
      log(
        `stable is healthy: pid ${health.pid}, version ${health.descriptor?.serverVersion}, db migration ${health.descriptor?.databaseMigration}`,
      );
      const state = readState();
      state.server = { release: plan.toServer, sha: plan.sha, at: new Date().toISOString() };
      state.client = {
        release: plan.toClient,
        sha: readManifest(plan.toClient)?.sha ?? plan.sha,
        at: new Date().toISOString(),
      };
      state.history.push({
        at: new Date().toISOString(),
        kind: plan.mode === "promote" ? "server" : "rollback-server",
        result: "ok",
        sha: plan.sha,
        fromServer: plan.fromServer,
        toServer: plan.toServer,
        fromClient: plan.fromClient,
        toClient: plan.toClient,
        ...(snapshot ? { snapshot } : {}),
        ...(migrationBefore !== undefined ? { dbMigrationBefore: migrationBefore } : {}),
        ...(health.descriptor?.databaseMigration !== undefined
          ? { dbMigrationAfter: health.descriptor.databaseMigration }
          : {}),
      });
      writeState(state);
      if (plan.mode === "promote") finalizeGit(cfg, plan.sha);
      prune(cfg);
      result = "ok";
      return;
    }

    log(`stable is NOT healthy: ${health.reason}`);
    if (!plan.fromServer) {
      systemctl(["stop", cfg.unitName], true);
      log(
        "no previous release to fall back to; stable is stopped. See the server log: ~/.t3-fork/logs/stable-server.log",
      );
      return;
    }
    log(`rolling back to ${plan.fromServer}`);
    systemctl(["stop", cfg.unitName], true);
    await waitUnitInactive(cfg, 120_000);
    await waitNoOwners(cfg.stableHome, 30_000);
    // The failed release may have migrated the schema; put the pre-swap database back.
    if (snapshot) restoreSnapshot(cfg.stableHome, snapshot);
    flipPointer(P.current, releaseDir(plan.fromServer));
    if (plan.fromClient)
      flipPointer(P.clientCurrent, NodePath.join(releaseDir(plan.fromClient), "web"));
    const again = Date.now();
    systemctl(["start", cfg.unitName]);
    const back = await waitHealthy(cfg, {
      sinceMs: again,
      expectRelease: plan.fromServer,
      timeoutSeconds: cfg.healthTimeoutSeconds,
    });
    recordHistory({
      at: new Date().toISOString(),
      kind: plan.mode === "promote" ? "server" : "rollback-server",
      result: back.ok ? "rolled-back" : "failed",
      sha: plan.sha,
      fromServer: plan.fromServer,
      toServer: plan.toServer,
      ...(snapshot ? { snapshot } : {}),
      note: health.reason,
    });
    log(
      back.ok
        ? `rolled back; stable runs ${plan.fromServer} again`
        : `ROLLBACK FAILED TOO: ${back.reason}. See fork/README.md → Recovery.`,
    );
    result = back.ok ? "rolled-back" : "failed";
  } catch (error) {
    log(`swap error: ${(error as Error).message}`);
    if (unitStatus(cfg).activeState !== "active" && readPointer(P.current)) {
      log("starting stable again with whatever `current` points at");
      systemctl(["start", cfg.unitName], true);
    }
  } finally {
    log(`${RESULT_MARK} ${result}`);
    if (lock) releaseLock(lock);
  }
}

export interface RollbackOptions {
  yes: boolean;
  restoreDb?: boolean;
}

export async function rollback(cfg: ForkConfig, options: RollbackOptions): Promise<void> {
  const lock = acquireLock("rollback");
  let handedOff = false;
  try {
    const state = readState();
    // The deploy that produced what runs now. Repeating rollback keeps walking back through history.
    const last = [...state.history]
      .reverse()
      .find(
        (entry) =>
          entry.result === "ok" &&
          ((entry.kind === "server" && entry.toServer === state.server?.release) ||
            (entry.kind === "client" &&
              entry.toClient !== undefined &&
              entry.toClient === state.client?.release)),
      );
    if (!last)
      throw new ForkError("Nothing to roll back to (no earlier successful deploy recorded)");

    if (last.kind === "client") {
      if (!last.fromClient)
        throw new ForkError("The last deploy was the first UI; there is no earlier UI");
      act(`switch the stable UI back to ${last.fromClient} (no server restart)`, () =>
        flipPointer(P.clientCurrent, NodePath.join(releaseDir(last.fromClient!), "web")),
      );
      const next = readState();
      next.client = {
        release: last.fromClient,
        sha: readManifest(last.fromClient)?.sha ?? "",
        at: new Date().toISOString(),
      };
      next.history.push({
        at: new Date().toISOString(),
        kind: "rollback-client",
        result: "ok",
        sha: next.client.sha,
        fromClient: last.toClient,
        toClient: last.fromClient,
      });
      writeState(next);
      log("UI rolled back. Reload the T3 Code tab.");
      return;
    }

    if (!last.fromServer)
      throw new ForkError("The last server deploy was the first one; there is no earlier release");
    const target = last.fromServer;
    if (!NodeFS.existsSync(NodePath.join(releaseDir(target), "manifest.json")))
      throw new ForkError(`Release ${target} was pruned`);

    // Restoring the snapshot loses every thread and message since that deploy, so only do it when the schema moved.
    const live = await descriptor(cfg.stableHost, cfg.stablePort);
    const migrationNow = live?.databaseMigration ?? dbMigration(cfg.stableHome);
    const snapshotMigration = last.snapshot ? snapshotMeta(last.snapshot)?.dbMigration : undefined;
    const schemaMoved =
      migrationNow !== undefined &&
      snapshotMigration !== undefined &&
      migrationNow !== snapshotMigration;
    let restore = options.restoreDb ?? schemaMoved;
    if (restore) {
      if (!last.snapshot || !NodeFS.existsSync(last.snapshot))
        throw new ForkError("The matching database snapshot is gone; cannot restore it");
      log(
        schemaMoved
          ? `the database schema changed in that deploy (migration ${snapshotMigration} → ${migrationNow}); ${target} needs the snapshot from ${snapshotMeta(last.snapshot)?.takenAt}`
          : "restoring the database snapshot as requested",
      );
      log(
        "RESTORING LOSES every thread, message and setting change made since then. A safety copy of today's data is taken first.",
      );
      if (!options.yes && !DRY_RUN && !ask("Restore the snapshot?"))
        throw new ForkError("Cancelled (pass --yes to confirm non-interactively)");
    } else {
      log(
        `the database schema did not change since that deploy (migration ${migrationNow ?? "unknown"}); keeping today's data`,
      );
      restore = false;
    }
    const plan: SwapPlan = {
      token: lock.token,
      mode: "rollback",
      toServer: target,
      toClient: last.fromClient ?? target,
      fromServer: state.server?.release,
      fromClient: state.client?.release,
      sha: readManifest(target)?.sha ?? "",
      force: true,
      takeSnapshot: true,
      ...(restore && last.snapshot ? { restoreSnapshot: last.snapshot } : {}),
      log: currentLog() ?? NodePath.join(P.logs, `${timestamp()}-rollback.log`),
    };
    handedOff = (await launchSwap(cfg, plan)) ?? false;
    log(
      "custom was not changed. To drop the change from custom too: git revert -m 1 <merge commit> on a branch, then promote.",
    );
  } finally {
    if (!handedOff) releaseLock(lock);
  }
}

export function assertOneOwner(home: string): number[] {
  return ownerPids(home);
}
