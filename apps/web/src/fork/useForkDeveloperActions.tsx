import { ActivityIcon, ArrowLeftRightIcon, ExternalLinkIcon } from "lucide-react";
import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { toastManager } from "../components/ui/toast";
import { currentForkInstance, forkInstanceUrl } from "./forkInstance";
import { useForkUpdatesDialog } from "./ForkUpdatesDialog";
import { useForkTerminalCommand } from "./useForkTerminalCommand";

export function useForkDeveloperActions() {
  const updates = useForkUpdatesDialog();
  const forkCommand = useForkTerminalCommand();
  const here = currentForkInstance();
  const other = here === "dev" ? "stable" : "dev";
  const label = other === "dev" ? "Dev" : "Stable";
  const aliases = ["Developer tools", "developer", "fork", "hammer"];
  const actions: CommandPaletteActionItem[] = [
    {
      kind: "action",
      value: "developer:open-instance",
      title: `Open ${label}`,
      description: `You're on ${here === "dev" ? "Dev" : "Stable"} · ${new URL(forkInstanceUrl(other)).host}`,
      searchTerms: [...aliases, `Open ${label}`, "switch instance"],
      icon: <ExternalLinkIcon />,
      run: async () => {
        window.location.assign(forkInstanceUrl(other));
      },
    },
    {
      kind: "action",
      value: "developer:changes",
      title: "Dev ↔ Stable changes…",
      searchTerms: [...aliases, "Dev Stable changes", "updates", "promote"],
      icon: <ArrowLeftRightIcon />,
      run: async () => {
        updates.openDialog();
      },
    },
    {
      kind: "action",
      value: "developer:status",
      title: "Fork status",
      description: forkCommand.canRun
        ? "Show status in the terminal"
        : "Open a thread to run fork status",
      searchTerms: [...aliases, "Fork status", "terminal"],
      icon: <ActivityIcon />,
      disabled: !forkCommand.canRun,
      run: async () => {
        if (await forkCommand.run("./fork/bin/fork status --fetch")) {
          toastManager.add({ type: "info", title: "Fork status is in the terminal" });
        }
      },
    },
  ];
  return { actions, dialog: updates.dialog };
}
