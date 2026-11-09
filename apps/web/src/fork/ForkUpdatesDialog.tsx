import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { useForkTerminalCommand } from "./useForkTerminalCommand";

interface PendingBranch {
  branch: string;
  head: string;
  commits: string[];
  behindCustom: number;
  areas: string[];
  restartsServer: boolean;
  files: number;
}

interface PendingReport {
  generatedAt: string;
  deployed: { server?: string; ui?: string; custom?: string };
  customUndeployed: string[];
  branches: PendingBranch[];
  devWorktree: { branch: string; uncommitted: number };
}

// Written every 2 minutes by `fork pending --write` and served next to the UI.
const PENDING_URL = "/fork-pending.json";

function minutesAgo(iso: string): string {
  const minutes = Math.round((Date.parse(new Date().toISOString()) - Date.parse(iso)) / 60_000);
  return minutes <= 0 ? "just now" : `${minutes} min ago`;
}

/**
 * "Dev ↔ Stable": what the dev branches have that stable lacks, and a Pull in button per branch.
 * Returns the dialog to render outside any menu, and `openDialog` to call from a click.
 */
export function useForkUpdatesDialog() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<PendingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const forkCommand = useForkTerminalCommand();

  const load = async () => {
    setError(null);
    try {
      const response = await fetch(`${PENDING_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport((await response.json()) as PendingReport);
    } catch (cause) {
      setError(
        `Could not read the dev summary (${cause instanceof Error ? cause.message : "unknown"}). Run: fork pending --write`,
      );
    }
  };

  const pull = async (branch: PendingBranch) => {
    if (!forkCommand.canRun) {
      toastManager.add({
        type: "error",
        title: "Open any thread first; the pull runs in its terminal",
      });
      return;
    }
    const message = branch.restartsServer
      ? `Pulling ${branch.branch} changes the server (${branch.areas.join(", ")}), so stable has to restart.\n\nNo running agent is cut off: the promote waits until every agent is idle (up to 30 minutes), then restarts. The app disconnects for a few seconds and reconnects by itself.\n\nPull it in?`
      : `Pull ${branch.branch} into stable? It only touches ${branch.areas.join(", ")}: no restart, nothing is interrupted. Reload the tab when it finishes.`;
    const confirmed = await requestConfirmDialog(message);
    if (confirmed !== true) return;
    if (!(await forkCommand.run(`./fork/bin/fork promote ${branch.branch}`))) return;
    setOpen(false);
    toastManager.add({
      type: "info",
      title: `Pulling ${branch.branch}: progress is in the terminal`,
    });
  };

  const openDialog = () => {
    setOpen(true);
    void load();
  };

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dev ↔ Stable</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {report ? (
            <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto text-sm">
              <p className="text-xs text-muted-foreground">
                Stable runs server {report.deployed.server ?? "?"} with UI{" "}
                {report.deployed.ui ?? "?"} · summary {minutesAgo(report.generatedAt)} · dev
                worktree on {report.devWorktree.branch}
                {report.devWorktree.uncommitted > 0
                  ? ` with ${report.devWorktree.uncommitted} uncommitted file(s) (not pullable until committed)`
                  : ""}
              </p>
              {report.branches.length === 0 ? <p>Dev has nothing stable lacks.</p> : null}
              {report.branches.map((branch) => (
                <div key={branch.branch} className="flex flex-col gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{branch.branch}</span>
                    <Button size="compact" onClick={() => void pull(branch)}>
                      Pull in
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {branch.areas.map((area) => (
                      <Badge key={area} size="sm" variant="secondary">
                        {area}
                      </Badge>
                    ))}
                    <Badge size="sm" variant={branch.restartsServer ? "warning" : "success"}>
                      {branch.restartsServer
                        ? "restarts stable (waits for idle agents)"
                        : "no restart"}
                    </Badge>
                  </div>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {branch.commits.map((commit) => (
                      <li key={commit}>{commit}</li>
                    ))}
                  </ul>
                  {branch.behindCustom > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Started before {branch.behindCustom} newer stable change(s); the pull merges
                      them.
                    </p>
                  ) : null}
                </div>
              ))}
              {report.customUndeployed.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Merged but not yet deployed: {report.customUndeployed.join("; ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );

  return { openDialog, dialog };
}
