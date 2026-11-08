import { PlayIcon, XIcon } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

// POC: todos live in this browser only. Agent access needs server storage (next step).
function load(key: string, seed: ReadonlyArray<string>): Todo[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Todo[];
  } catch {
    return [];
  }
  return seed.map((text, index) => ({ id: `seed-${index}`, text, done: false }));
}

function save(key: string, todos: Todo[]) {
  try {
    localStorage.setItem(key, JSON.stringify(todos));
  } catch {
    // storage blocked: the list still works until reload
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function TodoList(props: {
  storageKey: string;
  title: string;
  hotkeyLabel: string;
  matchesHotkey: (event: KeyboardEvent) => boolean;
  trigger: ReactElement;
  triggerLabel: string;
  side: "top" | "bottom";
  seed?: ReadonlyArray<string>;
  onRun?: (todo: Todo) => void;
}) {
  const { storageKey, matchesHotkey } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<{ key: string; items: Todo[] } | null>(null);
  const items = state?.key === storageKey ? state.items : load(storageKey, props.seed ?? []);

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

  const update = (next: Todo[]) => {
    setState({ key: storageKey, items: next });
    save(storageKey, next);
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    update([
      ...items,
      { id: `${storageKey}-${items.length}-${text.length}-${Math.random()}`, text, done: false },
    ]);
    setDraft("");
  };
  const remaining = items.filter((todo) => !todo.done).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.trigger}>
        {props.triggerLabel}
        {remaining > 0 ? ` (${remaining})` : ""}
      </PopoverTrigger>
      <PopoverPopup side={props.side} align="start">
        <div className="flex w-96 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{props.title}</span>
            <span className="text-xs text-muted-foreground">
              {props.hotkeyLabel} toggles · Enter adds · ? shortcuts
            </span>
          </div>
          <Input
            autoFocus
            value={draft}
            placeholder="Add a todo…"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {items.map((todo) => (
              <li key={todo.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={todo.done}
                  onChange={() =>
                    update(items.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))
                  }
                />
                <span
                  className={todo.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}
                >
                  {todo.text}
                </span>
                {props.onRun ? (
                  <Button
                    variant="ghost"
                    size="icon-micro"
                    aria-label="Run"
                    onClick={() => {
                      setOpen(false);
                      props.onRun?.(todo);
                    }}
                  >
                    <PlayIcon />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-micro"
                  aria-label="Delete"
                  onClick={() => update(items.filter((t) => t.id !== todo.id))}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
