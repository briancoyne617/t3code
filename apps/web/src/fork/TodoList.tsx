import { BotIcon, ListTodoIcon } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { TodoPanel, type TodoScope, useOpenTodoCounts } from "./TodoPanel";

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

type TodoListProps = Parameters<typeof TodoListButton>[0];

/** A todo list behind a button and a hotkey. The list itself lives in the fork todo service. */
export function TodoList(props: TodoListProps) {
  return (
    <RenderErrorBoundary fallback={null}>
      <TodoListButton {...props} />
    </RenderErrorBoundary>
  );
}

function TodoListButton(props: {
  scope: TodoScope;
  title: string;
  hotkeyLabel: string;
  matchesHotkey: (event: KeyboardEvent) => boolean;
  trigger: ReactElement;
  triggerLabel: string;
  side: "top" | "bottom";
  align?: "start" | "end";
  /** Owner icons and counts, for tight spots like the composer corner. */
  compact?: boolean;
  promptOnSend?: boolean;
}) {
  const { matchesHotkey } = props;
  const [open, setOpen] = useState(false);
  const counts = useOpenTodoCounts(props.scope);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global hotkey is a DOM listener outside React
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesHotkey(event)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matchesHotkey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={props.trigger}
        aria-label={`${props.title}: ${counts.user} open todos for you, ${counts.agent} for agent, ${counts.unassigned} need assignment (${props.hotkeyLabel})`}
      >
        {!props.compact ? <span>{props.triggerLabel || "Todos"}</span> : null}
        <span className="inline-flex items-center gap-1 tabular-nums">
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${counts.user} open todos for you`}
          >
            <ListTodoIcon aria-hidden="true" className="size-3" />
            {counts.user}
          </span>
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${counts.agent} open todos for agent`}
          >
            <BotIcon aria-hidden="true" className="size-3" />
            {counts.agent}
          </span>
          {counts.unassigned > 0 ? (
            <span className="text-warning" aria-label={`${counts.unassigned} need assignment`}>
              ?
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup side={props.side} align={props.align ?? "start"}>
        {counts.unassigned > 0 ? (
          <p className="mb-2 text-xs text-muted-foreground">
            {counts.unassigned} need assignment.{" "}
            {props.promptOnSend
              ? "Choose an owner below or have the agent review them with your next message."
              : "Choose an owner below."}
          </p>
        ) : null}
        <TodoPanel
          scope={props.scope}
          title={props.title}
          hotkeyLabel={props.hotkeyLabel}
          onNavigate={() => setOpen(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}
