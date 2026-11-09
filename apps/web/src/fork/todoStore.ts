import { useSyncExternalStore } from "react";

import { toastManager } from "../components/ui/toast";
import type { Todo } from "./todoModel";

// The fork todo service (fork/todos/server.ts). Stable's page (port 3773) uses 3775; dev uses 3875.
// Always loopback: the service listens only there, and the page may be opened by a LAN address.
export function serviceUrl(): string {
  const port = window.location.port === "3773" ? 3775 : 3875;
  return `http://127.0.0.1:${port}/api`;
}

interface TodoSnapshot {
  ready: boolean;
  error: string | null;
  todos: ReadonlyArray<Todo>;
  undo: string | null;
  redo: string | null;
}

let snapshot: TodoSnapshot = { ready: false, error: null, todos: [], undo: null, redo: null };
const listeners = new Set<() => void>();
let source: EventSource | null = null;

function set(next: Partial<TodoSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${serviceUrl()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

async function refresh() {
  try {
    const data = await request<{ todos: Todo[]; undo: string | null; redo: string | null }>(
      "GET",
      "/todos",
    );
    set({ ready: true, error: null, todos: data.todos, undo: data.undo, redo: data.redo });
  } catch {
    set({
      error: `Can't reach the todo service at ${serviceUrl()}. Your todos are safe; check: systemctl --user status t3-fork-todos`,
    });
  }
}

/** One-time move of the old browser-only lists into the service (the server ignores a repeat). */
async function importBrowserLists() {
  const prefix = "t3-fork:todos:";
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      const items = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
        text: string;
        done: boolean;
      }>;
      const projectId = key === `${prefix}general` ? null : (key.split(":").at(-1) ?? null);
      await request("POST", "/import", {
        key,
        projectId,
        items: items.map((item) => ({ text: item.text, done: item.done, parse: false })),
      });
    } catch {
      // a bad entry stays in the browser; nothing is lost
    }
  }
}

function onGlobalKey(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey || (event.code !== "KeyZ" && event.code !== "KeyY")) return;
  const target = event.target;
  // Text fields keep their own undo.
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
    return;
  const redo = event.code === "KeyY" || event.shiftKey;
  if (redo ? !snapshot.redo : !snapshot.undo) return;
  event.preventDefault();
  void (redo ? redoTodo() : undoTodo());
}

function connect() {
  if (source) return;
  void importBrowserLists().then(refresh);
  source = new EventSource(`${serviceUrl()}/events`);
  source.addEventListener("change", () => void refresh());
  source.addEventListener("error", () => set({ error: "Reconnecting to the todo service…" }));
  window.addEventListener("keydown", onGlobalKey);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => listeners.delete(listener);
}

export function useTodos(): TodoSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

function fail(error: unknown) {
  toastManager.add({
    type: "error",
    title: "Todo change failed",
    description: error instanceof Error ? error.message : String(error),
  });
}

function undoToast(title: string) {
  toastManager.add({
    type: "info",
    title,
    actionProps: { children: "Undo", onClick: () => void undoTodo() },
  });
}

export async function addTodo(body: {
  input: string;
  projectId?: string | null;
  threadId?: string | null;
}): Promise<Todo | null> {
  try {
    const todo = await request<Todo>("POST", "/todos", { ...body, createdBy: "user" });
    void refresh();
    return todo;
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function patchTodo(
  id: string,
  body: Partial<Pick<Todo, "status" | "priority" | "projectId" | "threadId">> & {
    input?: string;
    addLink?: string;
    removeLink?: string;
  },
): Promise<void> {
  try {
    const before = snapshot.todos.find((todo) => todo.id === id);
    const after = await request<Todo>("PATCH", `/todos/${id}`, body);
    void refresh();
    if (body.status === "done")
      undoToast(
        before?.recur && after.status === "open"
          ? `Done. Next: ${after.due}`
          : `Completed "${after.text}"`,
      );
    else if (body.status === "deleted") undoToast(`Deleted "${after.text}"`);
  } catch (error) {
    fail(error);
  }
}

export async function undoTodo(): Promise<void> {
  try {
    const result = await request<{ done: string | null }>("POST", "/undo");
    void refresh();
    if (result.done)
      toastManager.add({
        type: "info",
        title: `Undid: ${result.done}`,
        actionProps: { children: "Redo", onClick: () => void redoTodo() },
      });
  } catch (error) {
    fail(error);
  }
}

export async function redoTodo(): Promise<void> {
  try {
    const result = await request<{ done: string | null }>("POST", "/redo");
    void refresh();
    if (result.done) undoToast(`Redid: ${result.done}`);
  } catch (error) {
    fail(error);
  }
}
