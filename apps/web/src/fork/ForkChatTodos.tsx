import type { ScopedThreadRef } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { useThreadShell } from "../state/entities";
import { ForkWaitBadge } from "./ForkWaitBadge";
import { TodoList } from "./TodoList";

const matchesAltJ = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyJ";

// Keep the prompt text clear of the corner controls.
const CORNER_CSS =
  "[data-chat-composer-body]:has(> [data-fork-composer-corner]) :is([contenteditable=true], textarea) { padding-right: 2.75rem; }";

/** The chat's todos and wait countdown, tiny, in the top-right corner inside the prompt box. */
export function ForkChatTodos(props: { threadRef: ScopedThreadRef }) {
  // A fork bug here must never take the composer down with it.
  return (
    <RenderErrorBoundary fallback={null} resetKeys={[props.threadRef.threadId]}>
      <ComposerCorner threadRef={props.threadRef} />
    </RenderErrorBoundary>
  );
}

function ComposerCorner(props: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(props.threadRef);
  return (
    <div
      data-fork-composer-corner
      className="absolute top-1 right-2 z-10 flex flex-col items-end gap-0.5"
    >
      <style>{CORNER_CSS}</style>
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
          <button
            type="button"
            aria-label="Chat todos (Alt+J)"
            className="inline-flex h-4 items-center gap-0.5 rounded px-0.5 text-2xs tabular-nums text-muted-foreground hover:bg-foreground/5 hover:text-foreground [&_svg]:size-3"
          />
        }
        triggerLabel=""
        side="top"
        align="end"
        compact
        icon={<ListTodoIcon aria-hidden="true" />}
      />
      <ForkWaitBadge
        threadId={props.threadRef.threadId}
        environmentId={props.threadRef.environmentId}
        className="px-0.5"
      />
    </div>
  );
}
