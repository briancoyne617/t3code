import { Button } from "../components/ui/button";
import { ForkShortcutsDialog } from "./ForkShortcutsDialog";
import { ForkDevMenu } from "./ForkDevMenu";
import { installHiddenUi } from "./hiddenUi";
import { installHidePicker } from "./hidePicker";
import { installNoAutofill } from "./noAutofill";
import { TodoList } from "./TodoList";

installNoAutofill();
installHiddenUi();
installHidePicker();

const matchesAltG = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyG";

/** Top-left of the sidebar: the dev-tools hammer, the general todo list and the ? shortcuts screen. */
export function ForkHeaderTools() {
  return (
    <div className="ml-1 hidden items-center md:flex">
      <ForkDevMenu />
      <TodoList
        scope={{ kind: "general" }}
        title="General todos"
        hotkeyLabel="Alt+G"
        matchesHotkey={matchesAltG}
        trigger={<Button variant="ghost" size="compact" />}
        triggerLabel="Todo"
        side="bottom"
      />
      <ForkShortcutsDialog />
    </div>
  );
}
