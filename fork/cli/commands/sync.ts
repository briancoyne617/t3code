import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  acquireLock,
  act,
  DRY_RUN,
  ForkError,
  type ForkConfig,
  log,
  P,
  releaseLock,
  runStep,
  timestamp,
  VP_BIN,
  warn,
} from "../lib/core.ts";
import { applyHooks, footprint, resolveHookConflict } from "../lib/hooks.ts";
import {
  currentBranch,
  git,
  isAncestor,
  isClean,
  latestStableTag,
  makeClone,
  revParse,
} from "../lib/release.ts";

export interface SyncOptions {
  to?: string;
  continueDir?: string;
  skipTests: boolean;
}

/**
 * Bring upstream into `custom`: mirror main, merge the target into a throwaway clone, auto-resolve the
 * fork's hook files, check, then fast-forward custom. Never deploys. --dry-run still fetches (it only
 * updates upstream/* tracking refs) so it can report real conflicts; it moves no branch and pushes nothing.
 */
export async function syncUpstream(cfg: ForkConfig, options: SyncOptions): Promise<void> {
  const lock = acquireLock("sync-upstream");
  try {
    const repo = cfg.repo;
    if (currentBranch(repo) !== "custom" || !isClean(repo))
      throw new ForkError(`${repo} must be a clean checkout of custom`);

    let work: string;
    let targetLabel: string;
    let targetSha: string;
    if (options.continueDir) {
      work = NodePath.resolve(options.continueDir);
      if (git(work, ["diff", "--name-only", "--diff-filter=U"], true).stdout)
        throw new ForkError(`${work} still has unresolved conflicts`);
      if (NodeFS.existsSync(NodePath.join(work, ".git/MERGE_HEAD")))
        throw new ForkError(`Finish the merge first: git -C ${work} commit --no-edit`);
      targetSha = NodeFS.readFileSync(
        NodePath.join(work, ".git", "fork-sync-target"),
        "utf8",
      ).trim();
      targetLabel = targetSha.slice(0, 8);
    } else {
      log("fetching upstream (main + tags)");
      git(repo, ["fetch", "--quiet", "--tags", "upstream"]);
      const upstreamMain = revParse(repo, "refs/remotes/upstream/main")!;
      mirrorMain(cfg, upstreamMain);

      targetLabel =
        options.to === "main"
          ? "upstream/main"
          : (options.to ??
            (cfg.upstreamTarget === "main" ? "upstream/main" : latestStableTag(repo)));
      const target = revParse(repo, targetLabel);
      if (!target) throw new ForkError(`Unknown target ${targetLabel}`);
      targetSha = target;
      const behind = Number(git(repo, ["rev-list", "--count", `custom..${target}`]).stdout);
      log(`target ${targetLabel} (${target.slice(0, 8)}): custom is ${behind} commit(s) behind it`);
      if (isAncestor(repo, target, "custom")) {
        log("custom already contains the target; nothing to sync");
        return;
      }

      work = NodePath.join(P.work, `sync-${timestamp()}`);
      NodeFS.mkdirSync(P.work, { recursive: true });
      makeClone(repo, work, "custom");
      NodeFS.writeFileSync(NodePath.join(work, ".git", "fork-sync-target"), `${target}\n`);
      const merge = git(
        work,
        [
          "merge",
          "--no-ff",
          "--no-edit",
          "-m",
          `Merge upstream ${targetLabel} into custom (fork sync-upstream)`,
          target,
        ],
        true,
      );
      if (merge.code !== 0) {
        const conflicts = git(work, ["diff", "--name-only", "--diff-filter=U"], true)
          .stdout.split("\n")
          .filter(Boolean);
        const remaining: string[] = [];
        for (const file of conflicts) {
          if (await resolveHookConflict(work, file, target))
            log(`  auto-resolved fork hook ${file}`);
          else remaining.push(file);
        }
        if (remaining.length > 0) {
          log(`merge conflicts in ${remaining.length} file(s):`);
          for (const file of remaining) log(`  ${file}`);
          if (DRY_RUN) {
            NodeFS.rmSync(work, { recursive: true, force: true });
            log(
              "[dry-run] nothing changed; a real sync would stop here for you (or an agent) to resolve these",
            );
            return;
          }
          throw new ForkError(
            `Resolve the conflicts in ${work} (git status there shows them), \`git add\` them, \`git commit --no-edit\`, then run: fork sync-upstream --continue ${work}`,
          );
        }
        git(work, ["commit", "--quiet", "--no-edit"]);
      }
    }

    // Re-apply hooks (upstream may have changed t3.json or AGENTS.md without a conflict).
    const hooks = await applyHooks(work, { write: true });
    if (hooks.some((hook) => hook.changed)) {
      git(work, ["add", "t3.json", "AGENTS.md"]);
      git(work, [
        "commit",
        "--quiet",
        "-m",
        "chore(fork): re-apply fork hooks after upstream sync",
      ]);
      log("re-applied fork hooks to t3.json / AGENTS.md");
    }
    const problems = footprint(work).filter((row) => row.problem);
    for (const row of problems) warn(`footprint: ${row.file}: ${row.problem}`);
    if (problems.length > 0 && !DRY_RUN)
      throw new ForkError(`Footprint check failed in ${work}; fix it there and run --continue`);

    if (DRY_RUN) {
      const sha = git(work, ["rev-parse", "HEAD"]).stdout;
      log(
        `[dry-run] the merge would succeed (${sha.slice(0, 8)}); custom was not moved and nothing was pushed`,
      );
      NodeFS.rmSync(work, { recursive: true, force: true });
      return;
    }
    if (options.skipTests) warn("skipping checks (--skip-tests)");
    else {
      runStep("install dependencies", VP_BIN, ["i", "--frozen-lockfile"], { cwd: work });
      runStep(
        "typecheck + tests for the fork's changes (vp run check:changed)",
        VP_BIN,
        ["run", "check:changed", targetSha],
        { cwd: work },
      );
    }
    const merged = git(work, ["rev-parse", "HEAD"]).stdout;
    act(`fast-forward custom to ${merged.slice(0, 8)}`, () => {
      git(repo, ["fetch", "--quiet", work, `HEAD:refs/fork/synced`]);
      git(repo, ["merge", "--ff-only", "--quiet", merged]);
      git(repo, ["update-ref", "-d", "refs/fork/synced"]);
    });
    if (cfg.push) {
      act("push custom to origin", () => {
        const pushed = git(repo, ["push", "--quiet", "origin", "custom"], true);
        if (pushed.code !== 0) warn(`push failed: ${pushed.stderr}`);
      });
    }
    act(`remove ${work}`, () => NodeFS.rmSync(work, { recursive: true, force: true }));
    log(
      `custom now includes ${targetLabel}. Stable is unchanged: run \`fork promote --no-merge\` when you want to deploy it.`,
    );
    log(`Feature branches: run \`git merge custom\` in ${cfg.devWorktree} to pick this up.`);
  } finally {
    releaseLock(lock);
  }
}

function mirrorMain(cfg: ForkConfig, upstreamMain: string): void {
  const repo = cfg.repo;
  const main = revParse(repo, "refs/heads/main");
  if (main === upstreamMain) return;
  if (main && !isAncestor(repo, main, upstreamMain)) {
    warn(
      "local main has commits upstream does not; main is a mirror, so it was left alone. Investigate before syncing again.",
    );
    return;
  }
  act(`update main to upstream (${upstreamMain.slice(0, 8)}) and push it to origin`, () => {
    git(repo, ["update-ref", "refs/heads/main", upstreamMain]);
    if (cfg.push) {
      const pushed = git(repo, ["push", "--quiet", "origin", "main"], true);
      if (pushed.code !== 0) warn(`pushing main failed: ${pushed.stderr}`);
    }
  });
}
