// Shared by the web UI and the fork todo service (fork/todos/server.ts), so it imports nothing.

export type TodoStatus = "open" | "done" | "deleted";
export type Priority = 1 | 2 | 3 | 4;

export interface Todo {
  id: string;
  text: string;
  /** 1 is most urgent (Todoist's p1); 4 means no priority. */
  priority: Priority;
  /** Local date, YYYY-MM-DD. */
  due: string | null;
  /** Local time, HH:MM (24h). */
  time: string | null;
  /** Normalized recurrence such as "every day", "every 2 weeks", "every monday". */
  recur: string | null;
  labels: string[];
  /** Project list it belongs to (null for the general list unless threadId says otherwise). */
  projectId: string | null;
  /** The chat whose list it belongs to. */
  threadId: string | null;
  /** Chats working on it (▶ Run adds the new chat here). */
  links: string[];
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  createdBy: "user" | "agent";
  order: number;
}

export interface ParsedTodoInput {
  text: string;
  priority: Priority;
  due: string | null;
  time: string | null;
  recur: string | null;
  labels: string[];
}

const DAY_FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_SHORT: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_FULL_RE = `(${DAY_FULL.join("|")})`;
const DAY_SHORT_RE = `(${Object.keys(DAY_SHORT).join("|")})`;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The next date on `weekday`, counting today only when includeToday. */
function nextWeekday(from: Date, weekday: number, includeToday: boolean): Date {
  let delta = (weekday - from.getDay() + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(startOfDay(from), delta);
}

function dayIndex(word: string): number {
  const lower = word.toLowerCase();
  const full = DAY_FULL.indexOf(lower);
  return full >= 0 ? full : (DAY_SHORT[lower] ?? 1);
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/** A month/day with no year: this year, or next year when it already passed. */
function upcomingMonthDay(now: Date, month: number, day: number): Date {
  const candidate = new Date(now.getFullYear(), month, day);
  return candidate < startOfDay(now) ? new Date(now.getFullYear() + 1, month, day) : candidate;
}

function normalizeRecur(raw: string): string {
  const value = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const simple: Record<string, string> = {
    daily: "every day",
    weekly: "every week",
    monthly: "every month",
    yearly: "every year",
    "every weekday": "every weekday",
    "every other day": "every 2 days",
    "every other week": "every 2 weeks",
    "every other month": "every 2 months",
  };
  if (simple[value]) return simple[value];
  const day = value.match(new RegExp(`^every ${DAY_FULL_RE}$|^every ${DAY_SHORT_RE}$`));
  if (day) return `every ${DAY_FULL[dayIndex(day[1] ?? day[2] ?? "mon")]}`;
  return value.replace(/^every 1 (day|week|month|year)s?$/, "every $1");
}

/** The first due date of a recurrence, starting today. */
function firstOccurrence(recur: string, now: Date): Date {
  const day = recur.match(new RegExp(`^every ${DAY_FULL_RE}$`));
  if (day) return nextWeekday(now, dayIndex(day[1] ?? "monday"), true);
  if (recur === "every weekday") {
    const weekday = now.getDay();
    return weekday === 0
      ? addDays(startOfDay(now), 1)
      : weekday === 6
        ? addDays(startOfDay(now), 2)
        : startOfDay(now);
  }
  return startOfDay(now);
}

function step(recur: string, from: Date): Date {
  const day = recur.match(new RegExp(`^every ${DAY_FULL_RE}$`));
  if (day) return nextWeekday(from, dayIndex(day[1] ?? "monday"), false);
  if (recur === "every weekday") {
    const next = addDays(from, from.getDay() === 5 ? 3 : from.getDay() === 6 ? 2 : 1);
    return next;
  }
  const n = recur.match(/^every (?:(\d+) )?(day|week|month|year)s?$/);
  const count = Number(n?.[1] ?? 1);
  switch (n?.[2]) {
    case "week":
      return addDays(from, 7 * count);
    case "month":
      return addMonths(from, count);
    case "year":
      return addMonths(from, 12 * count);
    default:
      return addDays(from, count);
  }
}

/** Where a recurring todo goes when it is completed: the first occurrence after today. */
export function nextRecurrence(recur: string, due: string | null, now: Date): string {
  const today = startOfDay(now);
  let next = step(recur, due ? fromYmd(due) : today);
  for (let guard = 0; next <= today && guard < 1000; guard += 1) next = step(recur, next);
  return ymd(next);
}

/**
 * Todoist-style quick add: "Call Sam tomorrow 3pm p1 @phone every friday".
 * Recognized words are removed from the text; anything unrecognized stays as written.
 */
export function parseTodoInput(input: string, now: Date): ParsedTodoInput {
  let rest = ` ${input} `;
  const take = (pattern: string): RegExpMatchArray | null => {
    const match = rest.match(new RegExp(`\\s${pattern}(?=\\s)`, "i"));
    if (match) rest = rest.replace(match[0], " ");
    return match;
  };

  const priorityMatch = take("(?:p|!!)([1-4])");
  const priority = (priorityMatch ? Number(priorityMatch[1]) : 4) as Priority;

  const labels: string[] = [];
  for (let match = take("@([\\w-]+)"); match; match = take("@([\\w-]+)")) {
    if (match[1]) labels.push(match[1]);
  }

  const recurMatch = take(
    `(every\\s+(?:other\\s+)?(?:day|weekday|week|month|year|\\d+\\s+(?:days?|weeks?|months?|years?)|${DAY_FULL.join("|")}|${Object.keys(DAY_SHORT).join("|")})|daily|weekly|monthly|yearly)`,
  );
  const recur = recurMatch?.[1] ? normalizeRecur(recurMatch[1]) : null;

  let time: string | null = null;
  const ampm = take("(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)");
  const at = ampm ? null : take("at\\s+(\\d{1,2})(?::(\\d{2}))?");
  const clock = ampm || at ? null : take("(\\d{1,2}):(\\d{2})");
  const timeMatch = ampm ?? at ?? clock;
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? 0);
    const suffix = ampm?.[3]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    // "at 3" with no am/pm means the afternoon, like Todoist.
    if (at && hour >= 1 && hour <= 7) hour += 12;
    if (hour <= 23 && minute <= 59) time = `${pad(hour)}:${pad(minute)}`;
  }

  let due: Date | null = null;
  const today = startOfDay(now);
  let match: RegExpMatchArray | null;
  if (take("(today|tod)")) due = today;
  else if ((match = take("(tonight)"))) {
    due = today;
    time ??= "20:00";
  } else if (take("(tomorrow|tmrw?)")) due = addDays(today, 1);
  else if (take("next\\s+week")) due = nextWeekday(now, 1, false);
  else if (take("next\\s+month")) due = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  else if (take("(?:this\\s+)?weekend")) due = nextWeekday(now, 6, true);
  else if ((match = take("in\\s+(\\d+)\\s+(days?|weeks?|months?)"))) {
    const count = Number(match[1]);
    const unit = match[2]?.toLowerCase() ?? "day";
    due = unit.startsWith("month")
      ? addMonths(today, count)
      : addDays(today, unit.startsWith("week") ? 7 * count : count);
  } else if ((match = take(`(?:(on|next|this)\\s+)?${DAY_FULL_RE}`))) {
    due = nextWeekday(now, dayIndex(match[2] ?? "monday"), match[1]?.toLowerCase() === "this");
  } else if ((match = take(`(on|next|this)\\s+${DAY_SHORT_RE}`))) {
    due = nextWeekday(now, dayIndex(match[2] ?? "mon"), match[1]?.toLowerCase() === "this");
  } else if ((match = take(`${DAY_SHORT_RE}(?=\\s$)`))) {
    // A bare "fri" counts only as the last word, so "sat down" stays text.
    due = nextWeekday(now, dayIndex(match[1] ?? "mon"), false);
  } else if ((match = take("(\\d{4})-(\\d{2})-(\\d{2})"))) {
    due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  } else if ((match = take(`(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?`))) {
    due = upcomingMonthDay(now, monthIndex(match[1] ?? "jan"), Number(match[2]));
  } else if ((match = take(`(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}`))) {
    due = upcomingMonthDay(now, monthIndex(match[2] ?? "jan"), Number(match[1]));
  } else if ((match = take("(?:on\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?"))) {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : null;
    due =
      year === null
        ? upcomingMonthDay(now, Number(match[1]) - 1, Number(match[2]))
        : new Date(year, Number(match[1]) - 1, Number(match[2]));
  }

  if (!due && recur) due = firstOccurrence(recur, now);
  if (!due && time) {
    const [h, m] = time.split(":").map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    due = at < now ? addDays(today, 1) : today;
  }

  const text = rest.replace(/\s+/g, " ").trim();
  return {
    text: text || input.trim(),
    priority,
    due: due ? ymd(due) : null,
    time,
    recur,
    labels,
  };
}

function formatTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${pad(m)}${suffix}`;
}

/** "Today 3pm", "Tomorrow", "Fri", "Nov 12"; tone says how to color it. */
export function describeDue(
  todo: Pick<Todo, "due" | "time">,
  now: Date,
): { label: string; tone: "overdue" | "today" | "soon" | "later" } | null {
  if (!todo.due) return null;
  const today = startOfDay(now);
  const due = fromYmd(todo.due);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : days > 1 && days < 7
            ? (DAY_FULL[due.getDay()] ?? "").slice(0, 3).replace(/^./, (c) => c.toUpperCase())
            : `${(MONTHS[due.getMonth()] ?? "").replace(/^./, (c) => c.toUpperCase())} ${due.getDate()}${due.getFullYear() === now.getFullYear() ? "" : ` ${due.getFullYear()}`}`;
  const label = todo.time ? `${day} ${formatTime(todo.time)}` : day;
  let overdue = days < 0;
  if (days === 0 && todo.time) {
    const [h = 0, m = 0] = todo.time.split(":").map(Number);
    overdue = now.getHours() * 60 + now.getMinutes() > h * 60 + m;
  }
  return {
    label,
    tone: overdue ? "overdue" : days === 0 ? "today" : days < 7 ? "soon" : "later",
  };
}

/** Todoist's order: dated first (soonest first), then priority, then the order they were added. */
export function compareTodos(a: Todo, b: Todo): number {
  const aDue = a.due ? `${a.due} ${a.time ?? "99:99"}` : "9999";
  const bDue = b.due ? `${b.due} ${b.time ?? "99:99"}` : "9999";
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.order - b.order;
}
