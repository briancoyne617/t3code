import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadTerminalActions } from "../components/terminal/useThreadTerminalActions";
import { toastManager } from "../components/ui/toast";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

const DEV_WORKTREE = "/home/brian/ide/t3code-dev";

/** Runs a `fork` command in a new terminal of the open thread. Resolves true once it was typed. */
export function useForkTerminalCommand() {
  const { activeThread, activeDraftThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId ?? null;
  const threadRef = thread && threadId ? scopeThreadRef(thread.environmentId, threadId) : null;
  const terminal = useThreadTerminalActions(threadRef);
  const newTerminal = useTerminalUiStateStore((store) => store.newTerminal);

  return {
    canRun: threadRef !== null,
    run: async (command: string): Promise<boolean> => {
      if (!threadRef) {
        toastManager.add({
          type: "error",
          title: "Open any thread first; fork commands run in its terminal",
        });
        return false;
      }
      const launched = terminal.launchTerminal({
        place: (terminalId) => newTerminal(threadRef, terminalId),
        location: { cwd: DEV_WORKTREE, worktreePath: null },
        size: { cols: 120, rows: 30 },
      });
      if (!launched) return false;
      const opened = await launched.result;
      if (opened._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not open a terminal for the command" });
        return false;
      }
      await terminal.writeToTerminal(launched.terminalId, `${command}\r`);
      return true;
    },
  };
}
