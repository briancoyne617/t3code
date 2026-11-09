// Which chats are waiting on a timer (ScheduleWakeup, Monitor, background waits) and until when.
// Read-only look at T3 Code's own database; upstream's "Waiting" pill has no deadline, this adds one.
import * as NodeSqlite from "node:sqlite";

export interface ThreadWait {
  threadId: string;
  /** Short name of what it waits on, e.g. "wakeup", "monitor". */
  kind: string;
  startedAt: string;
  /** When the wait should end; null when the tool gave no time limit (then the UI counts up). */
  deadline: string | null;
}

const WAIT_TOOLS: Record<string, string> = {
  ScheduleWakeup: "wakeup",
  Monitor: "monitor",
  TaskOutput: "task",
  "mcp__t3-code__t3_background_wait": "background",
  "mcp__t3-code__t3_thread_wait": "chat",
};

// Generous on purpose: an overdue wait keeps showing (as overtime) until its chat moves on.
const LOOKBACK_MS = 6 * 60 * 60 * 1000;

type Input = Record<string, unknown>;

function limitMs(input: Input): number | null {
  const num = (key: string) => (typeof input[key] === "number" ? (input[key] as number) : null);
  const seconds = num("delaySeconds") ?? num("timeoutSeconds") ?? num("timeout_seconds");
  if (seconds !== null) return seconds * 1000;
  return num("timeout_ms") ?? num("timeoutMs") ?? num("timeout");
}

// A plain "sleep 120" (optionally followed by more commands) waits a known time; a sleep inside a loop does not.
const PLAIN_SLEEP = /^\s*sleep\s+(\d+(?:\.\d+)?)([smhd]?)\s*(?:$|&&|;|\|\|)/;
const UNIT_MS: Record<string, number> = {
  "": 1000,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function sleepMs(command: string): number | null {
  const match = PLAIN_SLEEP.exec(command);
  return match ? Number(match[1]) * UNIT_MS[match[2] ?? ""]! : null;
}

interface PendingTask {
  taskId: string;
  kind: string;
  description?: string;
}

/** Background tasks a chat's provider still reports as running ("Waiting" in the sidebar). */
function pendingTaskWaits(db: NodeSqlite.DatabaseSync): ThreadWait[] {
  const threads = db
    .prepare(
      `select thread_id, json_extract(payload_json, '$.pendingBackgroundTasks') tasks
       from orchestration_v2_projection_provider_threads
       where json_array_length(json_extract(payload_json, '$.pendingBackgroundTasks')) > 0`,
    )
    .all() as unknown as Array<{ thread_id: string; tasks: string }>;
  // The tool call that started the task names its ID in its output.
  const starter = db.prepare(
    `select payload_json from orchestration_v2_projection_turn_items
     where thread_id = ? and type in ('command_execution', 'dynamic_tool') and instr(payload_json, ?) > 0
     order by ordinal limit 1`,
  );
  const waits: ThreadWait[] = [];
  for (const thread of threads) {
    for (const task of JSON.parse(thread.tasks) as PendingTask[]) {
      if (task.kind === "subagent") continue;
      const row = starter.get(thread.thread_id, task.taskId) as
        | { payload_json: string }
        | undefined;
      if (!row) continue;
      const item = JSON.parse(row.payload_json) as {
        type: string;
        startedAt?: string;
        input?: unknown;
      };
      if (!item.startedAt) continue;
      const limit =
        typeof item.input === "string" ? sleepMs(item.input) : limitMs((item.input ?? {}) as Input);
      waits.push({
        threadId: thread.thread_id,
        kind: task.kind === "monitor" ? "monitor" : (task.description ?? "background command"),
        startedAt: item.startedAt,
        deadline:
          limit === null ? null : new Date(Date.parse(item.startedAt) + limit).toISOString(),
      });
    }
  }
  return waits;
}

interface Row {
  thread_id: string;
  run_id: string | null;
  status: string;
  payload_json: string;
}

export function readWaits(dbPath: string, now = Date.now()): ThreadWait[] {
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const names = Object.keys(WAIT_TOOLS);
    const rows = db
      .prepare(
        `select thread_id, run_id, status, payload_json from orchestration_v2_projection_turn_items
         where type = 'dynamic_tool' and updated_at > ?
           and json_extract(payload_json, '$.toolName') in (${names.map(() => "?").join(",")})
         order by ordinal`,
      )
      .all(new Date(now - LOOKBACK_MS).toISOString(), ...names) as unknown as Row[];
    const latestRun = db.prepare(
      `select run_id from orchestration_v2_projection_turn_items
       where thread_id = ? order by ordinal desc limit 1`,
    );
    const waits = new Map<string, ThreadWait>();
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as {
        toolName: string;
        startedAt?: string;
        input?: Input;
      };
      const startedAt = payload.startedAt;
      if (!startedAt) continue;
      // A wakeup's tool call ends at once; it is pending until the chat starts its next run.
      const wakeup = payload.toolName === "ScheduleWakeup";
      if (!wakeup && row.status !== "running") continue;
      if (wakeup) {
        const latest = latestRun.get(row.thread_id) as { run_id: string | null } | undefined;
        if (latest?.run_id !== row.run_id) continue;
      }
      if (wakeup && payload.input?.stop === true) continue;
      const limit = limitMs(payload.input ?? {});
      waits.set(row.thread_id, {
        threadId: row.thread_id,
        kind: WAIT_TOOLS[payload.toolName] ?? "wait",
        startedAt,
        deadline: limit === null ? null : new Date(Date.parse(startedAt) + limit).toISOString(),
      });
    }
    for (const wait of pendingTaskWaits(db)) {
      // One per chat: a wait with a known end beats one without.
      const current = waits.get(wait.threadId);
      if (!current || (current.deadline === null && wait.deadline !== null))
        waits.set(wait.threadId, wait);
    }
    return [...waits.values()];
  } catch {
    return [];
  } finally {
    db.close();
  }
}
