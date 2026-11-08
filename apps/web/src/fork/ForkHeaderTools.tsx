import { Button } from "../components/ui/button";
import { ForkShortcutsDialog } from "./ForkShortcutsDialog";
import { ForkUpdatesDialog } from "./ForkUpdatesDialog";
import { TodoList } from "./TodoList";

const matchesAltG = (event: KeyboardEvent) =>
  event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyG";

const GENERAL_SEED = [
  "P1: Set up high-effort thinking (Opus) that hands implementation off to a mid-level model (Sonnet) when the task is not complicated",
  "Todo items show the status of the agent working on them; done/hidden items listed below",
  "Make todos Todoist-like: p1/p2/p3 priority keywords, natural-language dates/times and days, plus AI kick-off and run status",
  "Choose per message whether it is queued or steers the running turn, with a typed keyword that is hard to type by accident but obvious (e.g. a leading `;;q` / `;;s`)",
  "Optional: sync with my real Todoist",
];

/** Top-left of the sidebar: the general (cross-project) todo list and the ? shortcuts screen. */
export function ForkHeaderTools() {
  return (
    <div className="ml-1 hidden items-center md:flex">
      <TodoList
        storageKey="t3-fork:todos:general"
        title="General todos"
        hotkeyLabel="Alt+G"
        matchesHotkey={matchesAltG}
        trigger={<Button variant="ghost" size="compact" />}
        triggerLabel="Todo"
        side="bottom"
        seed={GENERAL_SEED}
      />
      <ForkUpdatesDialog />
      <ForkShortcutsDialog />
    </div>
  );
}
