import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect, useEffectEvent } from "react";

import { resolveSidebarThreadStatus } from "../components/Sidebar.logic";

type WaitingThread = Pick<EnvironmentThreadShell, "environmentId" | "id"> &
  Parameters<typeof resolveSidebarThreadStatus>[0];

const MESSAGE_SENT = "t3-fork:message-sent";

export function notifyWaitingChatAfterSend(ref: ScopedThreadRef): void {
  window.dispatchEvent(new CustomEvent(MESSAGE_SENT, { detail: scopedThreadKey(ref) }));
}

export function useAdvanceWaitingChat(input: {
  orderedThreadKeys: readonly string[];
  threadByKey: ReadonlyMap<string, WaitingThread>;
  settledThreadKeys: ReadonlySet<string>;
  snoozedThreadKeys: ReadonlySet<string>;
  readCurrentThreadKey: () => string | null;
  openThread: (ref: ScopedThreadRef) => void;
}): void {
  const advance = useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail !== input.readCurrentThreadKey()) return;
    for (const key of input.orderedThreadKeys) {
      if (
        key === event.detail ||
        input.settledThreadKeys.has(key) ||
        input.snoozedThreadKeys.has(key)
      )
        continue;
      const thread = input.threadByKey.get(key);
      if (thread && resolveSidebarThreadStatus(thread) === "waiting") {
        input.openThread(scopeThreadRef(thread.environmentId, thread.id));
        return;
      }
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to successful sends from the composer.
  useEffect(() => {
    const listener = (event: Event) => advance(event);
    window.addEventListener(MESSAGE_SENT, listener);
    return () => window.removeEventListener(MESSAGE_SENT, listener);
  }, []);
}
