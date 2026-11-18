import type { EnvironmentId } from "@t3tools/contracts";

import { Button } from "../components/ui/button";
import { ForkShortcutsDialog } from "./ForkShortcutsDialog";
import { ForkDevMenu } from "./ForkDevMenu";
import { ForkHostResources } from "./ForkHostResources";
import { ForkUsageBar } from "./ForkUsageBar";
import { installHiddenUi } from "./hiddenUi";
import { installHidePicker } from "./hidePicker";
import { installNoAutofill } from "./noAutofill";
import { installTerminalStyle } from "./terminalStyle";
import { TodoList } from "./TodoList";

installNoAutofill();
installHiddenUi();
installHidePicker();
installTerminalStyle();

const matchesAltG = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyG";

/** Top-left of the sidebar: the ? shortcuts screen. */
export function ForkHeaderTools() {
  return (
    <div className="ml-1 hidden items-center md:flex">
      <ForkShortcutsDialog />
    </div>
  );
}

/** Top-right of the chat header: provider limits, the dev-tools hammer and the general todo list. */
export function ForkChatHeaderTools(props: { environmentId: EnvironmentId }) {
  return (
    <div className="ml-auto flex max-w-[60%] shrink-0 items-center gap-1">
      <ForkHostResources environmentId={props.environmentId} />
      <ForkUsageBar layout="header" environmentId={props.environmentId} />
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
    </div>
  );
}
