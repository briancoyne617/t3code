import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { PlayIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useHandleNewThread } from "../hooks/useHandleNewThread";

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

// POC: per-project todos live in this browser only. Agent access needs server storage (next step).
const storageKey = (environmentId: string, projectId: string) =>
  `t3-fork:todos:${environmentId}:${projectId}`;

function load(key: string): Todo[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Todo[]) : [];
  } catch {
    return [];
  }
}

function save(key: string, todos: Todo[]) {
  try {
    localStorage.setItem(key, JSON.stringify(todos));
  } catch {
    // storage blocked: the list still works until reload
  }
}

export function ForkTodos() {
  const { activeThread, activeDraftThread, handleNewThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  const key = thread ? storageKey(thread.environmentId, thread.projectId) : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [todos, setTodos] = useState<{ key: string | null; items: Todo[] }>({
    key: null,
    items: [],
  });
  const items = todos.key === key ? todos.items : key ? load(key) : [];

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global Alt+T shortcut is a DOM listener outside React
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!thread || !key) return null;

  const update = (next: Todo[]) => {
    setTodos({ key, items: next });
    save(key, next);
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    update([...items, { id: `${Date.now()}-${items.length}`, text, done: false }]);
    setDraft("");
  };
  const run = (todo: Todo) => {
    setOpen(false);
    void handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
      prompt: todo.text,
    });
  };
  const remaining = items.filter((todo) => !todo.done).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="compact" />}>
        Todos{remaining > 0 ? ` (${remaining})` : ""}
      </PopoverTrigger>
      <PopoverPopup side="top" align="start">
        <div className="flex w-80 flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            Project todos · Enter adds · Alt+T toggles · ▶ opens a new thread with it
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
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {items.map((todo) => (
              <li key={todo.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
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
                <Button
                  variant="ghost"
                  size="icon-micro"
                  aria-label="Run"
                  onClick={() => run(todo)}
                >
                  <PlayIcon />
                </Button>
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
