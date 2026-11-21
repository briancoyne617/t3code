// A fenced block holding only a file path gets an "Open in file editor" button.
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "~/rightPanelStore";

import { codeBlockFileTarget } from "./filePickerPaths";

export function codeBlockFileOpener(
  code: string,
  threadRef: ScopedThreadRef | undefined,
  cwd: string | undefined,
  baseDir: string | undefined,
): (() => void) | undefined {
  if (!threadRef) return undefined;
  const target = codeBlockFileTarget(code, cwd, baseDir);
  if (!target) return undefined;
  return () => useRightPanelStore.getState().openFile(threadRef, target.panelPath, target.line);
}
