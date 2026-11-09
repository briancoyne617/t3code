// The fork's todo service: one JSON file, a tiny HTTP API, live change events, and server-side undo/redo.
// It runs on its own (t3-fork-todos.service), so changing it never restarts T3 Code or its agents.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  nextRecurrence,
  parseTodoInput,
  type Priority,
  type Todo,
} from "../../apps/web/src/fork/todoModel.ts";
import {
  loadState,
  saveState,
  syncTodoist,
  type TodoistHost,
  type TodoistState,
  tokenFile,
} from "./todoist.ts";
import { readWaits } from "./waits.ts";

interface Change {
  before: Todo | null;
  after: Todo | null;
}

interface Op {
  at: string;
  label: string;
  changes: Change[];
}

interface Store {
  version: 1;
  todos: Todo[];
  undo: Op[];
  redo: Op[];
  /** localStorage lists already imported from a browser, so a second import is a no-op. */
  imported: string[];
}

const UNDO_LIMIT = 300;

const { values } = NodeUtil.parseArgs({
  options: {
    port: { type: "string", default: "3775" },
    host: { type: "string", default: "127.0.0.1" },
    data: { type: "string" },
    "stable-db": { type: "string" },
  },
});
const dataFile = values.data ?? NodePath.join(process.env.HOME ?? ".", ".t3-fork", "todos.json");
// UI elements hidden with Alt+right-click (apps/web/src/fork/hiddenUi.ts); the page owns the rule shape.
const hiddenFile = NodePath.join(NodePath.dirname(dataFile), "hidden-ui.json");
function readHidden(): unknown[] {
  try {
    const rules: unknown = JSON.parse(NodeFS.readFileSync(hiddenFile, "utf8"));
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}
function writeHidden(rules: unknown[]): void {
  NodeFS.writeFileSync(`${hiddenFile}.tmp`, `${JSON.stringify(rules, null, 2)}\n`);
  NodeFS.renameSync(`${hiddenFile}.tmp`, hiddenFile);
}

const stateDb =
  values["stable-db"] ??
  NodePath.join(process.env.HOME ?? ".", ".t3-stable", "userdata", "statev2.sqlite");

function load(): Store {
  try {
    const parsed = JSON.parse(NodeFS.readFileSync(dataFile, "utf8")) as Partial<Store>;
    return {
      version: 1,
      todos: parsed.todos ?? [],
      undo: parsed.undo ?? [],
      redo: parsed.redo ?? [],
      imported: parsed.imported ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { version: 1, todos: [], undo: [], redo: [], imported: [] };
  }
}

const store = load();
let revision = 0;

/** A copy per day, kept 14 days, so even a bad bulk edit is recoverable. */
function dailyBackup(): void {
  if (!NodeFS.existsSync(dataFile)) return;
  const dir = NodePath.join(NodePath.dirname(dataFile), "todo-backups");
  NodeFS.mkdirSync(dir, { recursive: true });
  const target = NodePath.join(dir, `todos-${new Date().toISOString().slice(0, 10)}.json`);
  if (!NodeFS.existsSync(target)) NodeFS.copyFileSync(dataFile, target);
  const old = NodeFS.readdirSync(dir).sort().slice(0, -14);
  for (const file of old) NodeFS.rmSync(NodePath.join(dir, file), { force: true });
}

function persist(): void {
  dailyBackup();
  NodeFS.mkdirSync(NodePath.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp-${process.pid}`;
  NodeFS.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  NodeFS.renameSync(tmp, dataFile);
  revision += 1;
  for (const client of listeners) client.write(`event: change\ndata: ${revision}\n\n`);
}

const listeners = new Set<NodeHttp.ServerResponse>();

function put(todo: Todo | null, id: string): void {
  const index = store.todos.findIndex((t) => t.id === id);
  if (todo === null) {
    if (index >= 0) store.todos.splice(index, 1);
  } else if (index >= 0) store.todos[index] = todo;
  else store.todos.push(todo);
}

/** Apply a set of changes as one undoable step. */
function commit(label: string, changes: Change[]): void {
  if (changes.length === 0) return;
  for (const change of changes) put(change.after, (change.after ?? change.before)!.id);
  store.undo.push({ at: new Date().toISOString(), label, changes });
  if (store.undo.length > UNDO_LIMIT) store.undo.splice(0, store.undo.length - UNDO_LIMIT);
  store.redo = [];
  persist();
  scheduleTodoist(15_000);
}

function replay(from: Op[], to: Op[], direction: "undo" | "redo"): Op | null {
  const op = from.pop();
  if (!op) return null;
  const ordered = direction === "undo" ? [...op.changes].reverse() : op.changes;
  for (const change of ordered) {
    const id = (change.after ?? change.before)!.id;
    put(direction === "undo" ? change.before : change.after, id);
  }
  to.push(op);
  persist();
  return op;
}

function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

interface CreateBody {
  input?: string;
  text?: string;
  parse?: boolean;
  projectId?: string | null;
  threadId?: string | null;
  links?: string[];
  createdBy?: "user" | "agent";
  priority?: Priority;
  due?: string | null;
  time?: string | null;
  recur?: string | null;
  labels?: string[];
  done?: boolean;
}

function makeTodo(body: CreateBody, now: Date): Todo {
  const raw = (body.input ?? body.text ?? "").trim();
  if (!raw) throw new HttpError(400, "text is required");
  const parsed =
    body.parse === false
      ? { text: raw, priority: 4 as Priority, due: null, time: null, recur: null, labels: [] }
      : parseTodoInput(raw, now);
  const stamp = now.toISOString();
  return {
    id: NodeCrypto.randomUUID(),
    text: parsed.text,
    priority: body.priority ?? parsed.priority,
    due: body.due !== undefined ? body.due : parsed.due,
    time: body.time !== undefined ? body.time : parsed.time,
    recur: body.recur !== undefined ? body.recur : parsed.recur,
    labels: [...new Set([...(body.labels ?? []), ...parsed.labels])],
    projectId: body.projectId ?? null,
    threadId: body.threadId ?? null,
    links: [...new Set(body.links ?? [])],
    status: body.done ? "done" : "open",
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: body.done ? stamp : null,
    deletedAt: null,
    createdBy: body.createdBy ?? "user",
    order: store.todos.reduce((max, t) => Math.max(max, t.order), 0) + 1,
  };
}

function newTodo(fields: Partial<Todo> & { text: string }): Todo {
  const stamp = new Date().toISOString();
  return {
    id: NodeCrypto.randomUUID(),
    priority: 4,
    due: null,
    time: null,
    recur: null,
    labels: [],
    projectId: null,
    threadId: null,
    links: [],
    status: "open",
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    deletedAt: null,
    createdBy: "user",
    order: store.todos.reduce((max, t) => Math.max(max, t.order), 0) + 1,
    ...fields,
  };
}

// Todoist backup + ingest: runs every 2 minutes, and 15s after a change, once a token is in place.
const todoistStateFile = NodePath.join(NodePath.dirname(dataFile), "todoist.json");
const todoistState: TodoistState = loadState(todoistStateFile);
let todoistTimer: NodeJS.Timeout | undefined;
let todoistRunning = false;
let todoistLast = "";

function todoistToken(): string | null {
  try {
    return NodeFS.readFileSync(tokenFile(dataFile), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function scheduleTodoist(delay: number): void {
  if (todoistTimer) clearTimeout(todoistTimer);
  todoistTimer = setTimeout(() => void runTodoist(), delay);
}

async function runTodoist(): Promise<void> {
  scheduleTodoist(120_000);
  const token = todoistToken();
  if (!token || todoistRunning) return;
  todoistRunning = true;
  try {
    todoistLast = await syncTodoist(token, todoistState, todoistHost());
    delete todoistState.lastError;
  } catch (error) {
    todoistState.lastError = error instanceof Error ? error.message : String(error);
    console.error("todoist sync:", todoistState.lastError);
  } finally {
    saveState(todoistStateFile, todoistState);
    todoistRunning = false;
  }
}

function todoistHost(): TodoistHost {
  return {
    todos: () => store.todos,
    commit: (label, changes) => {
      for (const change of changes) put(change.after, (change.after ?? change.before)!.id);
      store.undo.push({ at: new Date().toISOString(), label, changes });
      store.redo = [];
      persist();
    },
    newTodo,
    stableDb: stateDb,
  };
}

interface PatchBody {
  input?: string;
  text?: string;
  priority?: Priority;
  due?: string | null;
  time?: string | null;
  recur?: string | null;
  labels?: string[];
  projectId?: string | null;
  threadId?: string | null;
  status?: Todo["status"];
  addLink?: string;
  removeLink?: string;
}

function patchTodo(before: Todo, body: PatchBody, now: Date): { after: Todo; label: string } {
  const stamp = now.toISOString();
  const after: Todo = { ...before, updatedAt: stamp };
  let label = `edited "${short(before.text)}"`;
  if (body.input !== undefined) {
    const parsed = parseTodoInput(body.input, now);
    Object.assign(after, {
      text: parsed.text,
      priority: parsed.priority,
      due: parsed.due,
      time: parsed.time,
      recur: parsed.recur,
      labels: parsed.labels,
    });
  }
  if (body.text !== undefined) after.text = body.text.trim() || before.text;
  if (body.priority !== undefined) after.priority = body.priority;
  if (body.due !== undefined) after.due = body.due;
  if (body.time !== undefined) after.time = body.time;
  if (body.recur !== undefined) after.recur = body.recur;
  if (body.labels !== undefined) after.labels = body.labels;
  if (body.projectId !== undefined) after.projectId = body.projectId;
  if (body.threadId !== undefined) after.threadId = body.threadId;
  if (body.addLink && !after.links.includes(body.addLink)) {
    after.links = [...after.links, body.addLink];
    label = `linked a chat to "${short(before.text)}"`;
  }
  if (body.removeLink) {
    after.links = after.links.filter((link) => link !== body.removeLink);
    label = `unlinked a chat from "${short(before.text)}"`;
  }
  if (body.status && body.status !== before.status) {
    if (body.status === "done" && before.recur && before.status === "open") {
      // A recurring todo stays open and moves to its next date, like Todoist.
      after.due = nextRecurrence(before.recur, before.due, now);
      label = `completed "${short(before.text)}" (next: ${after.due})`;
    } else {
      after.status = body.status;
      after.completedAt = body.status === "done" ? stamp : null;
      after.deletedAt = body.status === "deleted" ? stamp : null;
      label =
        body.status === "done"
          ? `completed "${short(before.text)}"`
          : body.status === "deleted"
            ? `deleted "${short(before.text)}"`
            : `restored "${short(before.text)}"`;
    }
  }
  return { after, label };
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Only pages served from this machine may call the API; tools without an Origin (curl, the CLI) may too. */
function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    // The page can be opened by loopback or by this machine's private address (WSL mirrored networking).
    const host = url.hostname;
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
      /^(10|127)\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
    );
  } catch {
    return false;
  }
}

async function readBody<T>(req: NodeHttp.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function snapshot() {
  return {
    revision,
    todos: store.todos,
    undo: store.undo.at(-1)?.label ?? null,
    redo: store.redo.at(-1)?.label ?? null,
  };
}

async function handle(req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const now = new Date();
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/api/health") return json(200, { ok: true, revision });
  if (method === "GET" && path === "/api/todos") return json(200, snapshot());
  if (method === "GET" && path === "/api/waits") return json(200, { waits: readWaits(stateDb) });
  if (path === "/api/hidden") {
    if (method === "GET") return json(200, { rules: readHidden() });
    if (method === "POST") {
      const body = await readBody<{ rules?: unknown }>(req);
      if (!Array.isArray(body.rules)) throw new HttpError(400, "rules must be an array");
      writeHidden(body.rules);
      return json(200, { rules: body.rules });
    }
  }
  if (path === "/api/todoist/config" && method === "POST") {
    const body = await readBody<{ defaultThreadId?: string | null; pins?: Record<string, string> }>(
      req,
    );
    if (body.defaultThreadId !== undefined) todoistState.defaultThreadId = body.defaultThreadId;
    if (body.pins) todoistState.pins = { ...todoistState.pins, ...body.pins };
    saveState(todoistStateFile, todoistState);
    return json(200, {
      defaultThreadId: todoistState.defaultThreadId ?? null,
      pins: todoistState.pins ?? {},
    });
  }
  if (path === "/api/todoist/dry-run" && method === "POST") {
    const token = todoistToken();
    if (!token) throw new HttpError(400, "no Todoist token yet");
    const report = { wouldIngest: [], duplicates: [], otherTasks: [], commands: {} };
    await syncTodoist(token, todoistState, todoistHost(), report);
    return json(200, report);
  }
  if (path === "/api/todoist") {
    if (method === "POST") await runTodoist();
    return json(200, {
      enabled: todoistToken() !== null,
      lastSync: todoistState.lastSync ?? null,
      lastError: todoistState.lastError ?? null,
      last: todoistLast,
      mirrored: Object.keys(todoistState.tasks).length,
      ingested: todoistState.ingested,
    });
  }
  if (method === "GET" && path === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`event: change\ndata: ${revision}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      listeners.delete(res);
    });
    return;
  }
  if (method === "POST" && path === "/api/parse") {
    const body = await readBody<{ input?: string }>(req);
    return json(200, parseTodoInput(body.input ?? "", now));
  }
  if (method === "POST" && path === "/api/todos") {
    const body = await readBody<CreateBody>(req);
    const todo = makeTodo(body, now);
    commit(`added "${short(todo.text)}"`, [{ before: null, after: todo }]);
    return json(201, todo);
  }
  const one = path.match(/^\/api\/todos\/([\w-]+)$/);
  if (one && method === "PATCH") {
    const before = store.todos.find((t) => t.id === one[1]);
    if (!before) throw new HttpError(404, "no such todo");
    const { after, label } = patchTodo(before, await readBody<PatchBody>(req), now);
    commit(label, [{ before, after }]);
    return json(200, after);
  }
  if (method === "POST" && (path === "/api/undo" || path === "/api/redo")) {
    const op =
      path === "/api/undo"
        ? replay(store.undo, store.redo, "undo")
        : replay(store.redo, store.undo, "redo");
    return json(200, { done: op?.label ?? null, ...snapshot() });
  }
  if (method === "POST" && path === "/api/import") {
    const body = await readBody<{ key: string; projectId?: string | null; items: CreateBody[] }>(
      req,
    );
    if (!body.key || store.imported.includes(body.key)) return json(200, { imported: 0 });
    const changes = body.items
      .filter((item) => (item.text ?? item.input ?? "").trim())
      .map((item) => ({
        before: null,
        after: makeTodo({ ...item, projectId: body.projectId ?? null }, now),
      }));
    store.imported.push(body.key);
    if (changes.length === 0) persist();
    else commit(`imported ${changes.length} todo(s) from this browser`, changes);
    return json(200, { imported: changes.length });
  }
  throw new HttpError(404, "not found");
}

const server = NodeHttp.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) {
    res.writeHead(403).end("origin not allowed");
    return;
  }
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  handle(req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  });
});

scheduleTodoist(5_000);
server.listen(Number(values.port), values.host, () => {
  console.log(`fork todos on http://${values.host}:${values.port} (data ${dataFile})`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const client of listeners) client.end();
    server.close(() => process.exit(0));
  });
}
