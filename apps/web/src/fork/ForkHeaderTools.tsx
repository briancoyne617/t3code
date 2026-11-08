import { Button } from "../components/ui/button";
import { ForkShortcutsDialog } from "./ForkShortcutsDialog";
import { ForkUpdatesDialog } from "./ForkUpdatesDialog";
import { installNoAutofill } from "./noAutofill";
import { TodoList } from "./TodoList";

installNoAutofill();

const matchesAltG = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyG";

/** Top-left of the sidebar: the general (cross-project) todo list and the ? shortcuts screen. */
export function ForkHeaderTools() {
  return (
    <div className="ml-1 hidden items-center md:flex">
      <TodoList
        scope={{ kind: "general" }}
        title="General todos"
        hotkeyLabel="Alt+G"
        matchesHotkey={matchesAltG}
        trigger={<Button variant="ghost" size="compact" />}
        triggerLabel="Todo"
        side="bottom"
      />
      <ForkUpdatesDialog />
      <ForkShortcutsDialog />
    </div>
  );
}
