import { ForkError } from "../lib/core.ts";
import type { Todo } from "../../../apps/web/src/fork/todoModel.ts";

const BASE = process.env.T3_FORK_TODO_URL ?? "http://127.0.0.1:3775";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ForkError(
      `the todo service is not answering at ${BASE} (systemctl --user status t3-fork-todos)`,
    );
  }
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ForkError(json.error ?? `HTTP ${response.status}`);
  return json;
}

function line(todo: Todo): string {
  const bits = [
    todo.id.slice(0, 8),
    todo.status === "open" ? "[ ]" : todo.status === "done" ? "[x]" : "[-]",
    todo.priority < 4 ? `p${todo.priority}` : "  ",
    todo.text,
    todo.due ? `(due ${todo.due}${todo.time ? ` ${todo.time}` : ""})` : "",
    todo.recur ?? "",
    ...todo.labels.map((label) => `@${label}`),
  ];
  return bits.filter(Boolean).join(" ");
}

async function find(prefix: string): Promise<Todo> {
  const { todos } = await call<{ todos: Todo[] }>("GET", "/todos");
  const matches = todos.filter((todo) => todo.id.startsWith(prefix));
  if (matches.length !== 1)
    throw new ForkError(`${matches.length} todos match "${prefix}"; give more of the id`);
  return matches[0]!;
}

/** fork todo add|list|done|rm|restore|undo|redo — the same list the T3 Code UI shows. */
export async function todoCommand(
  args: ReadonlyArray<string>,
  options: { thread?: string; project?: string; all?: boolean; json?: boolean },
): Promise<void> {
  const [action = "list", ...rest] = args;
  // Inside a T3 Code chat the shell knows its thread, so an agent's todos land on its own chat.
  const thread = options.thread ?? process.env.T3CODE_THREAD_ID;
  switch (action) {
    case "add": {
      const input = rest.join(" ").trim();
      if (!input) throw new ForkError('usage: fork todo add "text p1 tomorrow 3pm @label"');
      const todo = await call<Todo>("POST", "/todos", {
        input,
        threadId: options.project && !options.thread ? null : (thread ?? null),
        projectId: options.project ?? null,
        createdBy: process.env.T3CODE_THREAD_ID ? "agent" : "user",
      });
      console.log(options.json ? JSON.stringify(todo) : `added ${line(todo)}`);
      return;
    }
    case "list": {
      const { todos } = await call<{ todos: Todo[] }>("GET", "/todos");
      const shown = todos.filter(
        (todo) =>
          (options.all || todo.status === "open") &&
          (options.all || !thread || todo.threadId === thread || todo.links.includes(thread)) &&
          (!options.project || todo.projectId === options.project),
      );
      if (options.json) console.log(JSON.stringify(shown, null, 2));
      else console.log(shown.map(line).join("\n") || "(no todos)");
      return;
    }
    case "done":
    case "rm":
    case "restore": {
      const status = action === "done" ? "done" : action === "rm" ? "deleted" : "open";
      for (const prefix of rest) {
        const todo = await find(prefix);
        console.log(line(await call<Todo>("PATCH", `/todos/${todo.id}`, { status })));
      }
      return;
    }
    case "undo":
    case "redo": {
      const result = await call<{ done: string | null }>("POST", `/${action}`);
      console.log(
        result.done
          ? `${action === "undo" ? "undid" : "redid"}: ${result.done}`
          : `nothing to ${action}`,
      );
      return;
    }
    default:
      throw new ForkError(
        `unknown todo action "${action}" (add, list, done, rm, restore, undo, redo)`,
      );
  }
}
