// Todoist link: mirrors every T3 todo into a Todoist project "T3" (a section per T3 project, chat todos as
// subtasks of "💬 <chat>"), completes T3 todos completed in Todoist, and ingests Todoist tasks starting with
// "t3" into the right T3 list, moving them out of the inbox. T3 is the source of truth for edits.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type { Priority, Todo } from "../../apps/web/src/fork/todoModel.ts";

const API = "https://api.todoist.com/api/v1/sync";
const PROJECT_NAME = "T3";
const GENERAL = "General";
/** If more mirrored tasks than this vanish from Todoist in one pass, assume something is wrong and skip. */
const MAX_VANISHED = 5;

export interface TodoistState {
  projectId?: string;
  sections: Record<string, string>;
  /** threadId → Todoist id of its "💬 chat" parent task. */
  parents: Record<string, string>;
  /** todoId → Todoist task id and what was last sent. */
  tasks: Record<string, { id: string; hash: string }>;
  lastSync?: string;
  lastError?: string;
  ingested: number;
}

interface TodoistItem {
  id: string;
  content: string;
  description?: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  checked?: boolean;
  is_deleted?: boolean;
  priority: number;
  labels?: string[];
  due?: { date: string; string?: string; is_recurring?: boolean } | null;
}

interface Command {
  type: string;
  uuid: string;
  temp_id?: string;
  args: Record<string, unknown>;
}

interface Names {
  projects: Map<string, string>;
  threads: Map<string, { title: string; projectId: string }>;
}

export interface TodoistHost {
  todos: () => ReadonlyArray<Todo>;
  /** Apply changes as one undoable step (the service's commit). */
  commit: (label: string, changes: Array<{ before: Todo | null; after: Todo | null }>) => void;
  newTodo: (fields: Partial<Todo> & { text: string }) => Todo;
  stableDb: string;
}

export function loadState(file: string): TodoistState {
  try {
    return {
      sections: {},
      parents: {},
      tasks: {},
      ingested: 0,
      ...JSON.parse(NodeFS.readFileSync(file, "utf8")),
    };
  } catch {
    return { sections: {}, parents: {}, tasks: {}, ingested: 0 };
  }
}

export function saveState(file: string, state: TodoistState): void {
  const tmp = `${file}.tmp-${process.pid}`;
  NodeFS.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  NodeFS.renameSync(tmp, file);
}

/** Project and chat titles, read-only from stable's database (never written). */
function readNames(dbPath: string): Names {
  const names: Names = { projects: new Map(), threads: new Map() };
  if (!NodeFS.existsSync(dbPath)) return names;
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const row of db
      .prepare("select project_id, title from projection_projects where deleted_at is null")
      .all() as Array<{ project_id: string; title: string }>)
      names.projects.set(row.project_id, row.title);
    for (const row of db
      .prepare(
        "select thread_id, project_id, title from orchestration_v2_projection_threads where deleted_at is null",
      )
      .all() as Array<{ thread_id: string; project_id: string; title: string }>)
      names.threads.set(row.thread_id, { title: row.title, projectId: row.project_id });
  } finally {
    db.close();
  }
  return names;
}

async function call(
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body))
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  const response = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Todoist ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const uuid = () => NodeCrypto.randomUUID();
const toTodoistPriority = (p: Priority) => 5 - p;
const fromTodoistPriority = (p: number) => Math.min(4, Math.max(1, 5 - p)) as Priority;

function dueFor(todo: Todo): Record<string, unknown> | null {
  if (todo.recur) return { string: todo.due ? `${todo.recur} starting ${todo.due}` : todo.recur };
  if (!todo.due) return null;
  return { date: todo.time ? `${todo.due}T${todo.time}:00` : todo.due };
}

/** Strip the leading "t3" / "t3 todo" marker from an ingested task. */
export function ingestText(content: string): string | null {
  const match = content.match(/^\s*t3(?:code)?\b[\s:,-]*(?:todo\b[\s:,-]*)?(.*)$/i);
  return match && match[1]?.trim() ? match[1].trim() : null;
}

/** Which list an ingested todo belongs to: a chat or project it names, else the general list. */
function route(text: string, names: Names): { projectId: string | null; threadId: string | null } {
  const lower = text.toLowerCase();
  const mentions = (title: string) => title.length >= 4 && lower.includes(title.toLowerCase());
  for (const [threadId, thread] of names.threads)
    if (mentions(thread.title)) return { projectId: thread.projectId, threadId };
  for (const [projectId, title] of names.projects)
    if (mentions(title)) return { projectId, threadId: null };
  return { projectId: null, threadId: null };
}

/** Every active task outside the T3 project, for a dry-run report. */
export interface DryRunReport {
  wouldIngest: Array<{ text: string; list: string }>;
  otherTasks: string[];
  commands: Record<string, number>;
}

export async function syncTodoist(
  token: string,
  liveState: TodoistState,
  host: TodoistHost,
  dryRun?: DryRunReport,
): Promise<string> {
  // A dry run works on a copy and never writes to T3 or Todoist.
  const state: TodoistState = dryRun ? structuredClone(liveState) : liveState;
  const names = readNames(host.stableDb);
  const data = await call(token, {
    sync_token: "*",
    resource_types: ["projects", "sections", "items"],
  });
  const projects = (data.projects ?? []) as Array<{
    id: string;
    name: string;
    is_deleted?: boolean;
    is_archived?: boolean;
  }>;
  const sections = (data.sections ?? []) as Array<{
    id: string;
    name: string;
    project_id: string;
    is_deleted?: boolean;
  }>;
  const items = ((data.items ?? []) as TodoistItem[]).filter((item) => !item.is_deleted);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const commands: Command[] = [];
  const notes: string[] = [];

  // 1. The "T3" project.
  let projectId = projects.find(
    (p) => p.id === state.projectId && !p.is_deleted && !p.is_archived,
  )?.id;
  projectId ??= projects.find(
    (p) => p.name === PROJECT_NAME && !p.is_deleted && !p.is_archived,
  )?.id;
  const projectIsNew = !projectId;
  if (!projectId) {
    projectId = uuid();
    commands.push({
      type: "project_add",
      uuid: uuid(),
      temp_id: projectId,
      args: { name: PROJECT_NAME },
    });
    state.sections = {};
    state.parents = {};
    state.tasks = {};
  }
  state.projectId = projectId;
  const liveSections = new Set(
    sections.filter((s) => !s.is_deleted && s.project_id === projectId).map((s) => s.id),
  );
  for (const [key, id] of Object.entries(state.sections))
    if (!liveSections.has(id)) delete state.sections[key];
  for (const section of sections)
    if (
      !section.is_deleted &&
      section.project_id === projectId &&
      !Object.values(state.sections).includes(section.id)
    )
      state.sections[section.name] = section.id;
  for (const [threadId, id] of Object.entries(state.parents))
    if (!itemsById.has(id)) delete state.parents[threadId];

  // 2. Ingest "t3 …" tasks from the rest of Todoist.
  const ingested: Todo[] = [];
  for (const item of items) {
    if (item.checked || item.project_id === projectId) continue;
    const text = ingestText(item.content);
    if (!text) continue;
    const target = route(text, names);
    const todo = host.newTodo({
      text,
      priority: fromTodoistPriority(item.priority),
      due: item.due?.date?.slice(0, 10) ?? null,
      time: item.due?.date && item.due.date.length > 10 ? item.due.date.slice(11, 16) : null,
      recur: item.due?.is_recurring ? (item.due.string ?? null) : null,
      labels: [...(item.labels ?? []), "todoist"],
      ...target,
    });
    ingested.push(todo);
    state.tasks[todo.id] = { id: item.id, hash: "" };
    notes.push(`ingested "${text}"`);
  }
  if (dryRun) {
    for (const item of items)
      if (!item.checked && item.project_id !== projectId && !ingestText(item.content))
        dryRun.otherTasks.push(item.content);
    for (const todo of ingested)
      dryRun.wouldIngest.push({
        text: todo.text,
        list: todo.threadId
          ? `chat "${names.threads.get(todo.threadId)?.title}"`
          : todo.projectId
            ? `project "${names.projects.get(todo.projectId)}"`
            : "general",
      });
  }
  if (ingested.length && !dryRun) {
    host.commit(
      `imported ${ingested.length} todo(s) from Todoist`,
      ingested.map((after) => ({ before: null, after })),
    );
    state.ingested += ingested.length;
  }

  // 3. Completed (or deleted) in Todoist → done in T3.
  const todos = host.todos();
  if (!projectIsNew) {
    const vanished = todos.filter((todo) => {
      const mapped = state.tasks[todo.id];
      return todo.status === "open" && mapped && mapped.hash !== "" && !itemsById.has(mapped.id);
    });
    const checked = todos.filter((todo) => {
      const mapped = state.tasks[todo.id];
      return todo.status === "open" && mapped && itemsById.get(mapped.id)?.checked;
    });
    if (vanished.length > MAX_VANISHED) {
      notes.push(
        `${vanished.length} mirrored tasks disappeared from Todoist at once; not completing them in T3`,
      );
    } else if (vanished.length + checked.length > 0 && !dryRun) {
      const now = new Date().toISOString();
      host.commit(
        `completed ${vanished.length + checked.length} todo(s) in Todoist`,
        [...vanished, ...checked].map((before) => ({
          before,
          after: { ...before, status: "done", completedAt: now, updatedAt: now },
        })),
      );
      for (const todo of [...vanished, ...checked]) {
        const mapped = state.tasks[todo.id];
        if (mapped) mapped.hash = "done";
      }
    }
  }

  // 4. Mirror T3 → Todoist.
  const sectionFor = (name: string): string => {
    const existing = state.sections[name];
    if (existing) return existing;
    const temp = uuid();
    commands.push({
      type: "section_add",
      uuid: uuid(),
      temp_id: temp,
      args: { name, project_id: projectId },
    });
    state.sections[name] = temp;
    return temp;
  };
  const parentFor = (threadId: string, sectionId: string, title: string): string => {
    const existing = state.parents[threadId];
    const content = `💬 ${title}`;
    if (existing) {
      const item = itemsById.get(existing);
      if (item && item.content !== content)
        commands.push({ type: "item_update", uuid: uuid(), args: { id: existing, content } });
      if (item && item.section_id !== sectionId)
        commands.push({
          type: "item_move",
          uuid: uuid(),
          args: { id: existing, section_id: sectionId },
        });
      return existing;
    }
    const temp = uuid();
    commands.push({
      type: "item_add",
      uuid: uuid(),
      temp_id: temp,
      args: {
        content,
        project_id: projectId,
        section_id: sectionId,
        description: `T3 chat ${threadId}`,
      },
    });
    state.parents[threadId] = temp;
    return temp;
  };

  for (const todo of host.todos()) {
    const mapped = state.tasks[todo.id];
    if (todo.status === "deleted") {
      if (mapped && itemsById.has(mapped.id))
        commands.push({ type: "item_delete", uuid: uuid(), args: { id: mapped.id } });
      if (mapped) delete state.tasks[todo.id];
      continue;
    }
    if (todo.status === "done" && !mapped) continue;
    const thread = todo.threadId ? names.threads.get(todo.threadId) : undefined;
    const ownerProject = thread?.projectId ?? todo.projectId;
    const sectionName = ownerProject
      ? (names.projects.get(ownerProject) ?? "Other project")
      : GENERAL;
    const desired = {
      content: todo.text,
      description: `T3 · ${thread ? `chat "${thread.title}"` : sectionName} · id ${todo.id}`,
      priority: toTodoistPriority(todo.priority),
      due: dueFor(todo),
      labels: todo.labels,
    };
    const hash = JSON.stringify([desired, todo.status, sectionName, todo.threadId, thread?.title]);
    if (mapped && mapped.hash === hash && itemsById.has(mapped.id)) continue;
    const sectionId = sectionFor(sectionName);
    const parentId =
      todo.threadId && thread ? parentFor(todo.threadId, sectionId, thread.title) : null;
    const item = mapped ? itemsById.get(mapped.id) : undefined;
    if (!item) {
      if (todo.status !== "open") {
        delete state.tasks[todo.id];
        continue;
      }
      const temp = uuid();
      commands.push({
        type: "item_add",
        uuid: uuid(),
        temp_id: temp,
        args: {
          ...desired,
          project_id: projectId,
          ...(parentId ? { parent_id: parentId } : { section_id: sectionId }),
        },
      });
      state.tasks[todo.id] = { id: temp, hash };
      continue;
    }
    commands.push({ type: "item_update", uuid: uuid(), args: { id: item.id, ...desired } });
    if (
      parentId
        ? item.parent_id !== parentId
        : item.section_id !== sectionId || item.parent_id !== null || item.project_id !== projectId
    )
      commands.push({
        type: "item_move",
        uuid: uuid(),
        args: { id: item.id, ...(parentId ? { parent_id: parentId } : { section_id: sectionId }) },
      });
    if (todo.status === "done" && !item.checked)
      commands.push({ type: "item_complete", uuid: uuid(), args: { id: item.id } });
    if (todo.status === "open" && item.checked)
      commands.push({ type: "item_uncomplete", uuid: uuid(), args: { id: item.id } });
    state.tasks[todo.id] = { id: item.id, hash };
  }

  if (dryRun) {
    for (const command of commands)
      dryRun.commands[command.type] = (dryRun.commands[command.type] ?? 0) + 1;
    return "dry run";
  }

  // 5. Send in batches; swap temporary ids for real ones.
  for (let start = 0; start < commands.length; start += 90) {
    const batch = commands.slice(start, start + 90);
    const result = await call(token, { commands: batch });
    const mapping = (result.temp_id_mapping ?? {}) as Record<string, string>;
    const status = (result.sync_status ?? {}) as Record<string, unknown>;
    const failed = Object.entries(status).filter(([, value]) => value !== "ok");
    if (failed.length)
      notes.push(
        `${failed.length} Todoist command(s) failed: ${JSON.stringify(failed[0]).slice(0, 200)}`,
      );
    // A failed add leaves a temporary id behind; forget it so the next pass retries instead of
    // mistaking it for a task that was completed in Todoist.
    const failedTemps = new Set(
      batch
        .filter((command) => command.temp_id && status[command.uuid] !== "ok")
        .map((command) => command.temp_id!),
    );
    if (
      batch.some((command) => command.type === "project_add" && failedTemps.has(command.temp_id!))
    )
      throw new Error("could not create the T3 project in Todoist");
    for (const [key, entry] of Object.entries(state.tasks))
      if (failedTemps.has(entry.id)) delete state.tasks[key];
    for (const [key, id] of Object.entries(state.parents))
      if (failedTemps.has(id)) delete state.parents[key];
    for (const [key, id] of Object.entries(state.sections))
      if (failedTemps.has(id)) delete state.sections[key];
    const swap = (id: string) => mapping[id] ?? id;
    for (const later of commands.slice(start + 90))
      for (const key of ["id", "parent_id", "section_id", "project_id"])
        if (typeof later.args[key] === "string") later.args[key] = swap(later.args[key] as string);
    state.projectId = swap(state.projectId ?? "");
    for (const key of Object.keys(state.sections)) state.sections[key] = swap(state.sections[key]!);
    for (const key of Object.keys(state.parents)) state.parents[key] = swap(state.parents[key]!);
    for (const entry of Object.values(state.tasks)) entry.id = swap(entry.id);
  }
  state.lastSync = new Date().toISOString();
  return [`${commands.length} change(s) sent`, ...notes].join("; ");
}

export function tokenFile(dataFile: string): string {
  return NodePath.join(NodePath.dirname(dataFile), "todoist-token");
}
