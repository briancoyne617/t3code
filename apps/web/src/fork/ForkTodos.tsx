import { Button } from "../components/ui/button";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { TodoList } from "./TodoList";

const matchesAltT = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyT";

/** Per-project todos in the sidebar footer (includes every chat's todos in the project). */
export function ForkTodos() {
  const { activeThread, activeDraftThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  if (!thread) return null;
  return (
    <TodoList
      scope={{ kind: "project", projectId: thread.projectId }}
      title="Project todos"
      hotkeyLabel="Alt+T"
      matchesHotkey={matchesAltT}
      trigger={<Button variant="ghost" size="compact" />}
      triggerLabel="Todos"
      side="top"
    />
  );
}
