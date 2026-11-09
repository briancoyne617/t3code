import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  LinkIcon,
  PlayIcon,
  Redo2Icon,
  RepeatIcon,
  RotateCcwIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { NO_AUTOFILL } from "./noAutofill";
import { compareTodos, describeDue, nextRecurrence, parseTodoInput, type Todo } from "./todoModel";
import { addTodo, patchTodo, redoTodo, undoTodo, useTodos } from "./todoStore";

export type TodoScope =
  | { kind: "general" }
  | { kind: "project"; projectId: string }
  | { kind: "thread"; threadId: string; projectId: string | null };

type View = "open" | "done" | "deleted";

const PRIORITY_RING: Record<number, string> = {
  1: "border-destructive text-destructive",
  2: "border-warning text-warning",
  3: "border-info text-info",
  4: "border-muted-foreground/60 text-muted-foreground",
};

const DUE_TONE = {
  overdue: "text-destructive",
  today: "text-success",
  soon: "text-fuchsia-500",
  later: "text-muted-foreground",
};

function threadStatus(shell: EnvironmentThreadShell | undefined): {
  label: string;
  className: string;
} {
  if (!shell) return { label: "draft", className: "bg-muted-foreground/40" };
  if (shell.hasPendingApprovals || shell.hasPendingUserInput)
    return { label: "needs you", className: "bg-warning" };
  const status = shell.runtime?.status ?? shell.latestRun?.status ?? "idle";
  if (status === "running" || status === "starting" || status === "preparing")
    return { label: "running", className: "animate-pulse bg-info" };
  if (status === "queued" || status === "waiting")
    return { label: status, className: "bg-warning" };
  if (status === "completed") return { label: "done", className: "bg-success" };
  if (status === "failed" || status === "interrupted" || status === "cancelled")
    return { label: status, className: "bg-destructive" };
  return { label: "idle", className: "bg-muted-foreground/40" };
}

/** Text that parses back into the same todo, for editing in place. */
function toInput(todo: Todo): string {
  return [
    todo.text,
    todo.priority < 4 ? `p${todo.priority}` : "",
    todo.recur ?? "",
    todo.due ?? "",
    todo.time ?? "",
    ...todo.labels.map((label) => `@${label}`),
  ]
    .filter(Boolean)
    .join(" ");
}

function inScope(
  todo: Todo,
  scope: TodoScope,
  showAll: boolean,
  shells: Map<string, EnvironmentThreadShell>,
) {
  if (showAll) return true;
  switch (scope.kind) {
    case "general":
      return todo.projectId === null && todo.threadId === null;
    case "project":
      return (
        todo.projectId === scope.projectId ||
        (todo.threadId !== null && shells.get(todo.threadId)?.projectId === scope.projectId)
      );
    case "thread":
      return todo.threadId === scope.threadId || todo.links.includes(scope.threadId);
  }
}

/** Open todos in a list, for the button badges. */
export function useOpenTodoCount(scope: TodoScope): number {
  const { todos } = useTodos();
  const shellList = useThreadShells();
  const shells = new Map<string, EnvironmentThreadShell>(
    shellList.map((shell) => [shell.id, shell]),
  );
  return todos.filter((todo) => todo.status === "open" && inScope(todo, scope, false, shells))
    .length;
}

/** A Todoist-style list: quick add with natural language, priorities, dates, linked chats, undo. */
export function TodoPanel(props: {
  scope: TodoScope;
  title: string;
  hotkeyLabel: string;
  onNavigate?: () => void;
}) {
  const { scope } = props;
  const { ready, error, todos, undo, redo } = useTodos();
  const [view, setView] = useState<View>("open");
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const nowMinute = useNowMinute();
  const now = new Date(`${nowMinute}:00Z`);
  const navigate = useNavigate();
  const { activeThread, activeDraftThread, handleNewThread } = useHandleNewThread();
  const current = activeThread ?? activeDraftThread;
  const currentThreadId: string | null = activeThread?.id ?? activeDraftThread?.threadId ?? null;
  const shellList = useThreadShells();
  const shells = new Map<string, EnvironmentThreadShell>(
    shellList.map((shell) => [shell.id, shell]),
  );

  const scoped = todos.filter((todo) => inScope(todo, scope, showAll, shells));
  const counts = {
    open: scoped.filter((todo) => todo.status === "open").length,
    done: scoped.filter((todo) => todo.status === "done").length,
    deleted: scoped.filter((todo) => todo.status === "deleted").length,
  };
  const shown = scoped
    .filter((todo) => todo.status === view)
    .toSorted((a, b) =>
      view === "open"
        ? compareTodos(a, b)
        : (b.completedAt ?? b.deletedAt ?? "").localeCompare(a.completedAt ?? a.deletedAt ?? ""),
    );
  const preview = draft.trim() ? parseTodoInput(draft, now) : null;

  const add = async () => {
    const input = draft.trim();
    if (!input) return;
    setDraft("");
    await addTodo({
      input,
      projectId:
        scope.kind === "project"
          ? scope.projectId
          : scope.kind === "thread"
            ? scope.projectId
            : null,
      threadId: scope.kind === "thread" ? scope.threadId : null,
    });
  };

  const run = async (todo: Todo) => {
    const projectId =
      todo.projectId ??
      (todo.threadId ? shells.get(todo.threadId)?.projectId : undefined) ??
      current?.projectId;
    const environmentId = current?.environmentId;
    if (!projectId || !environmentId) return;
    props.onNavigate?.();
    const opened = await handleNewThread(scopeProjectRef(environmentId, projectId as never), {
      prompt: todo.text,
    });
    if (opened) await patchTodo(todo.id, { addLink: opened.threadId });
  };

  const openThread = (shell: EnvironmentThreadShell) => {
    props.onNavigate?.();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(shell.environmentId, shell.id)),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { id, value } = editing;
    setEditing(null);
    const todo = todos.find((t) => t.id === id);
    if (todo && value.trim() && value.trim() !== toInput(todo))
      await patchTodo(id, { input: value.trim() });
  };

  return (
    <div className="flex w-md max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{props.title}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="compact"
            disabled={!undo}
            aria-label={undo ? `Undo: ${undo}` : "Nothing to undo"}
            onClick={() => void undoTodo()}
          >
            <Undo2Icon />
            Undo
          </Button>
          <Button
            variant="ghost"
            size="icon-micro"
            disabled={!redo}
            aria-label={redo ? `Redo: ${redo}` : "Nothing to redo"}
            onClick={() => void redoTodo()}
          >
            <Redo2Icon />
          </Button>
        </div>
      </div>
      {undo ? (
        <p className="-mt-1 truncate text-2xs text-muted-foreground">Ctrl+Z undoes: {undo}</p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Input
          {...NO_AUTOFILL}
          type="search"
          autoFocus
          value={draft}
          placeholder="Add a todo… e.g. “Fix login bug tomorrow 3pm p1 @web”"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        {preview &&
        (preview.due || preview.priority < 4 || preview.labels.length || preview.recur) ? (
          <div className="flex flex-wrap gap-1 text-2xs text-muted-foreground">
            {preview.priority < 4 ? (
              <span className={PRIORITY_RING[preview.priority]}>p{preview.priority}</span>
            ) : null}
            {preview.due ? (
              <span className={DUE_TONE[describeDue(preview, now)?.tone ?? "later"]}>
                {describeDue(preview, now)?.label}
              </span>
            ) : null}
            {preview.recur ? <span>↻ {preview.recur}</span> : null}
            {preview.labels.map((label) => (
              <span key={label}>@{label}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 text-xs">
        {(["open", "done", "deleted"] as const).map((name) => (
          <Button
            key={name}
            variant={view === name ? "secondary" : "ghost"}
            size="compact"
            onClick={() => setView(name)}
          >
            {name === "open" ? "Open" : name === "done" ? "Done" : "Deleted"} ({counts[name]})
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.currentTarget.checked)}
          />
          All lists
        </label>
      </div>

      {error && !ready ? <p className="text-xs text-destructive">{error}</p> : null}
      <ul className="flex max-h-[min(28rem,60vh)] flex-col overflow-y-auto">
        {shown.length === 0 && (ready || !error) ? (
          <li className="py-3 text-center text-xs text-muted-foreground">
            {!ready ? "Loading…" : view === "open" ? "Nothing to do here." : `No ${view} todos.`}
          </li>
        ) : null}
        {shown.map((todo) => {
          const due = describeDue(todo, now);
          const owner = todo.threadId ? shells.get(todo.threadId) : undefined;
          const linked = todo.links
            .map((id) => ({ id, shell: shells.get(id) }))
            .filter((link) => link.id !== todo.threadId);
          return (
            <li
              key={todo.id}
              className="group flex items-start gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-foreground/5"
            >
              {view === "open" ? (
                <button
                  type="button"
                  aria-label="Complete"
                  className={cn(
                    "mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border-2 hover:bg-current/10",
                    PRIORITY_RING[todo.priority],
                  )}
                  onClick={() => void patchTodo(todo.id, { status: "done" })}
                >
                  <CheckIcon className="size-2.5 opacity-0 group-hover:opacity-60" />
                </button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-micro"
                  aria-label="Restore"
                  onClick={() => void patchTodo(todo.id, { status: "open" })}
                >
                  <RotateCcwIcon />
                </Button>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {editing?.id === todo.id ? (
                  <Input
                    {...NO_AUTOFILL}
                    type="search"
                    autoFocus
                    size="sm"
                    value={editing.value}
                    onChange={(event) =>
                      setEditing({ id: todo.id, value: event.currentTarget.value })
                    }
                    onBlur={() => void saveEdit()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveEdit();
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "text-start break-words",
                      view !== "open" && "text-muted-foreground line-through",
                    )}
                    onClick={() => setEditing({ id: todo.id, value: toInput(todo) })}
                  >
                    {todo.text}
                  </button>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                  {due ? <span className={DUE_TONE[due.tone]}>{due.label}</span> : null}
                  {todo.recur ? (
                    <span className="flex items-center gap-0.5">
                      <RepeatIcon className="size-2.5" />
                      {todo.recur}
                      {view === "open"
                        ? `, then ${describeDue({ due: nextRecurrence(todo.recur, todo.due, now), time: null }, now)?.label ?? ""}`
                        : ""}
                    </span>
                  ) : null}
                  {todo.labels.map((label) => (
                    <span key={label}>@{label}</span>
                  ))}
                  {todo.createdBy === "agent" ? <span>added by agent</span> : null}
                  {owner && scope.kind !== "thread" ? (
                    <ChatChip shell={owner} onOpen={openThread} />
                  ) : null}
                  {linked.map((link) =>
                    link.shell ? (
                      <ChatChip key={link.id} shell={link.shell} onOpen={openThread} />
                    ) : null,
                  )}
                  {view !== "open" ? (
                    <span>
                      {view === "done" ? "completed" : "deleted"}{" "}
                      {(todo.completedAt ?? todo.deletedAt ?? "").slice(0, 10)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-none items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                {view === "open" && current && currentThreadId ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-micro"
                      aria-label="Start a chat on this"
                      onClick={() => void run(todo)}
                    >
                      <PlayIcon />
                    </Button>
                    {!todo.links.includes(currentThreadId) && todo.threadId !== currentThreadId ? (
                      <Button
                        variant="ghost"
                        size="icon-micro"
                        aria-label="Link the current chat to this todo"
                        onClick={() => void patchTodo(todo.id, { addLink: currentThreadId })}
                      >
                        <LinkIcon />
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {view !== "deleted" ? (
                  <Button
                    variant="ghost"
                    size="icon-micro"
                    aria-label="Delete"
                    onClick={() => void patchTodo(todo.id, { status: "deleted" })}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-muted-foreground">
        {props.hotkeyLabel} toggles · Enter adds · p1–p3, tomorrow, fri 3pm, every mon, @label ·
        click text to edit · Ctrl+Z / Ctrl+Shift+Z undo/redo · ? shortcuts
      </p>
    </div>
  );
}

function ChatChip(props: {
  shell: EnvironmentThreadShell;
  onOpen: (shell: EnvironmentThreadShell) => void;
}) {
  const status = threadStatus(props.shell);
  return (
    <button
      type="button"
      className="flex max-w-48 items-center gap-1 rounded-full bg-foreground/5 px-1.5 hover:bg-foreground/10"
      aria-label={`Open chat ${props.shell.title} (${status.label})`}
      onClick={() => props.onOpen(props.shell)}
    >
      <span className={cn("size-1.5 flex-none rounded-full", status.className)} />
      <span className="truncate">{props.shell.title}</span>
      <span className="flex-none">· {status.label}</span>
    </button>
  );
}
