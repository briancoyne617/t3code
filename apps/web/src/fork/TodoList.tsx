import { type ReactElement, useEffect, useState } from "react";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { TodoPanel, type TodoScope, useOpenTodoCount } from "./TodoPanel";

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
  /** Shown before the label, e.g. a composer-tab icon. */
  icon?: ReactElement;
}) {
  const { matchesHotkey } = props;
  const [open, setOpen] = useState(false);
  const count = useOpenTodoCount(props.scope);

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
      <PopoverTrigger render={props.trigger}>
        {props.icon ?? null}
        {props.icon ? (
          <span>Todos{count > 0 ? ` ${count}` : ""}</span>
        ) : (
          <>
            {props.triggerLabel}
            {count > 0 ? ` (${count})` : ""}
          </>
        )}
      </PopoverTrigger>
      <PopoverPopup side={props.side} align={props.align ?? "start"}>
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
