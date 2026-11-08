import type { ScopedThreadRef } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";

import { ComposerBanner } from "../components/chat/ComposerBanner";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { useThreadShell } from "../state/entities";
import { TodoList } from "./TodoList";

const matchesAltJ = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyJ";

/** The chat's own todos, as a tab on the composer's top-right shoulder. */
export function ForkChatTodos(props: { threadRef: ScopedThreadRef }) {
  // A fork bug here must never take the composer down with it.
  return (
    <RenderErrorBoundary fallback={null} resetKeys={[props.threadRef.threadId]}>
      <ChatTodosTab threadRef={props.threadRef} />
    </RenderErrorBoundary>
  );
}

function ChatTodosTab(props: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(props.threadRef);
  return (
    <ComposerBanner.Root
      density="comfortable"
      width="content"
      data-composer-shoulder-tab
      className="ml-auto"
    >
      <TodoList
        scope={{
          kind: "thread",
          threadId: props.threadRef.threadId,
          projectId: shell?.projectId ?? null,
        }}
        title={shell ? `Todos · ${shell.title}` : "Chat todos"}
        hotkeyLabel="Alt+J"
        matchesHotkey={matchesAltJ}
        trigger={
          <ComposerBanner.Row
            render={<button type="button" />}
            className="text-muted-foreground hover:text-foreground"
          />
        }
        triggerLabel=""
        side="top"
        align="end"
        icon={
          <ComposerBanner.Icon>
            <ListTodoIcon />
          </ComposerBanner.Icon>
        }
      />
    </ComposerBanner.Root>
  );
}
