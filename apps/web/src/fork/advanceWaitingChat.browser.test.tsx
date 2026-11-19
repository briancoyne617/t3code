import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { notifyWaitingChatAfterSend, useAdvanceWaitingChat } from "./advanceWaitingChat";

function Listener(props: Parameters<typeof useAdvanceWaitingChat>[0]) {
  useAdvanceWaitingChat(props);
  return null;
}

it("opens the first chat that is not busy after a send from the current chat", async () => {
  const ref = (name: string) => scopeThreadRef(EnvironmentId.make("test"), ThreadId.make(name));
  const sent = ref("sent");
  const top = ref("top");
  const later = ref("later");
  const candidates = [sent, ref("working"), ref("snoozed"), ref("settled"), top, later];
  const openThread = vi.fn();
  let current = scopedThreadKey(sent);
  await using _screen = await render(
    <Listener
      orderedThreadKeys={candidates.map(scopedThreadKey)}
      threadByKey={
        new Map(
          candidates.map((thread) => [
            scopedThreadKey(thread),
            {
              environmentId: thread.environmentId,
              id: thread.threadId,
              hasPendingApprovals: false,
              hasPendingUserInput: false,
              pendingSubagentRequest: null,
              runtime: {
                status:
                  thread.threadId === "working"
                    ? "running"
                    : thread.threadId === "top"
                      ? "failed"
                      : "idle",
                providerInstanceId: ProviderInstanceId.make("test"),
                providerName: null,
                activeRunId: null,
                updatedAt: "2026-01-01T00:00:00.000Z",
                lastError: null,
              },
            },
          ]),
        )
      }
      settledThreadKeys={new Set([scopedThreadKey(ref("settled"))])}
      snoozedThreadKeys={new Set([scopedThreadKey(ref("snoozed"))])}
      readCurrentThreadKey={() => current}
      openThread={openThread}
    />,
    { router: false },
  );

  notifyWaitingChatAfterSend(sent);
  expect(openThread).toHaveBeenCalledExactlyOnceWith(top);

  current = scopedThreadKey(later);
  notifyWaitingChatAfterSend(sent);
  expect(openThread).toHaveBeenCalledTimes(1);
});
