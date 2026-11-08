import { scopeProjectRef } from "@t3tools/client-runtime/environment";

import { Button } from "../components/ui/button";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { TodoList } from "./TodoList";

const matchesAltT = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyT";

/** Per-project todos in the sidebar footer. ▶ opens a new thread in the project with the todo. */
export function ForkTodos() {
  const { activeThread, activeDraftThread, handleNewThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  if (!thread) return null;
  return (
    <TodoList
      storageKey={`t3-fork:todos:${thread.environmentId}:${thread.projectId}`}
      title="Project todos"
      hotkeyLabel="Alt+T"
      matchesHotkey={matchesAltT}
      trigger={<Button variant="ghost" size="compact" />}
      triggerLabel="Todos"
      side="top"
      onRun={(todo) =>
        void handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
          prompt: todo.text,
        })
      }
    />
  );
}
