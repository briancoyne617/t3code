import * as NodeUtil from "node:util";

import { DRY_RUN, ForkError, loadConfig, log, setDryRun, startLog } from "./lib/core.ts";
import { promote, rollback, swap } from "./commands/deploy.ts";
import {
  dev,
  footprintCommand,
  hooksCommand,
  seedDevFromStable,
  status,
  t3,
} from "./commands/ops.ts";
import { setup } from "./commands/setup.ts";
import { syncUpstream } from "./commands/sync.ts";

const HELP = `fork — tooling for the personal T3 Code fork (docs: fork/README.md)

  fork status [--fetch] [--json]     what is deployed, health, running turns, dev, git
  fork dev [--seed-from-stable]      run the isolated dev stack (home ~/.t3-dev); extra args go to the dev runner
  fork promote [branch]              merge branch (default: the dev worktree's) into custom, build, test, deploy
        --no-merge                   deploy custom as it is (e.g. after sync-upstream)
        --force                      restart even if stable has running turns (restart continuation resumes them)
        --timeout <minutes>          how long to wait for stable to go idle (default 30)
        --skip-tests | --full-tests  skip checks, or run the whole suite instead of checks for changed files
  fork rollback [--yes] [--restore-db | --keep-db]
                                     go back to the release before the current one
  fork sync-upstream [--to main|<tag>] [--continue <dir>] [--skip-tests]
                                     merge the latest upstream stable tag (or main) into custom; never deploys
  fork setup                         one-time install: dirs, dev worktree, systemd service, t3 wrapper, keep-alive
  fork hooks [--check]               regenerate the fork's entries in t3.json and AGENTS.md
  fork footprint [--write]           check (or record) how much the fork edits upstream-owned files
  fork t3 <args>                     upstream's t3 CLI against the stable home (update/service refused)

  --dry-run works with every command: it prints what would happen and changes nothing.
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "t3") {
    t3(loadConfig(), rest);
    return;
  }
  const { values, positionals } = NodeUtil.parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "no-merge": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "skip-tests": { type: "boolean", default: false },
      "full-tests": { type: "boolean", default: false },
      timeout: { type: "string" },
      yes: { type: "boolean", default: false },
      "restore-db": { type: "boolean" },
      "keep-db": { type: "boolean" },
      to: { type: "string" },
      continue: { type: "string" },
      fetch: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      write: { type: "boolean", default: false },
      plan: { type: "string" },
      "seed-from-stable": { type: "boolean", default: false },
    },
  });
  setDryRun(values["dry-run"]);
  const cfg = loadConfig();

  switch (command) {
    case "status":
      return status(cfg, { fetch: values.fetch, json: values.json });
    case "dev":
      if (values["seed-from-stable"]) return seedDevFromStable(cfg);
      return dev(cfg, positionals);
    case "promote": {
      log(`log: ${startLog("promote")}${DRY_RUN ? " (dry run)" : ""}`);
      return promote(cfg, {
        ...(positionals[0] ? { branch: positionals[0] } : {}),
        noMerge: values["no-merge"],
        force: values.force,
        skipTests: values["skip-tests"],
        fullTests: values["full-tests"],
        ...(values.timeout ? { timeoutMinutes: Number(values.timeout) } : {}),
      });
    }
    case "rollback":
      log(`log: ${startLog("rollback")}${DRY_RUN ? " (dry run)" : ""}`);
      return rollback(cfg, {
        yes: values.yes,
        ...(values["restore-db"]
          ? { restoreDb: true }
          : values["keep-db"]
            ? { restoreDb: false }
            : {}),
      });
    case "sync-upstream":
      log(`log: ${startLog("sync")}${DRY_RUN ? " (dry run)" : ""}`);
      return syncUpstream(cfg, {
        ...(values.to ? { to: values.to } : {}),
        ...(values.continue ? { continueDir: values.continue } : {}),
        skipTests: values["skip-tests"],
      });
    case "setup":
      return setup(cfg);
    case "hooks":
      return hooksCommand(cfg, {
        check: values.check,
        ...(positionals[0] ? { repo: positionals[0] } : {}),
      });
    case "footprint":
      return footprintCommand({
        write: values.write,
        ...(positionals[0] ? { repo: positionals[0] } : {}),
      });
    case "swap":
      if (!values.plan) throw new ForkError("swap needs --plan");
      return swap(cfg, values.plan);
    default:
      throw new ForkError(`Unknown command "${command}". Run: fork help`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ForkError) {
    log(`ERROR: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
