import { useSyncExternalStore } from "react";

import { serviceUrl } from "./todoStore";

/** Todoist-style chat priority: 1 red, 2 yellow, 3 blue; no entry means unflagged. */
export type ChatFlag = 1 | 2 | 3;

const CACHE_KEY = "fork.chatFlags";
let flags: Readonly<Record<string, ChatFlag>> = readCache();
const listeners = new Set<() => void>();

function readCache(): Record<string, ChatFlag> {
  try {
    return parseFlags(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function parseFlags(value: unknown): Record<string, ChatFlag> {
  const out: Record<string, ChatFlag> = {};
  if (value === null || typeof value !== "object") return out;
  for (const [threadId, flag] of Object.entries(value)) {
    if (flag === 1 || flag === 2 || flag === 3) out[threadId] = flag;
  }
  return out;
}

function setFlags(next: Record<string, ChatFlag>, save: boolean): void {
  flags = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Private window: the service copy still holds them.
  }
  for (const listener of listeners) listener();
  if (save) {
    void fetch(`${serviceUrl()}/flags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flags: next }),
    }).catch(() => undefined);
  }
}

/** One click steps none → red → yellow → blue → none. */
export function nextChatFlag(flag: ChatFlag | undefined): ChatFlag | undefined {
  return flag === undefined ? 1 : flag === 3 ? undefined : ((flag + 1) as ChatFlag);
}

export function cycleChatFlag(threadId: string): void {
  const { [threadId]: current, ...rest } = flags;
  const next = nextChatFlag(current);
  setFlags(next === undefined ? rest : { ...rest, [threadId]: next }, true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatFlags(): Readonly<Record<string, ChatFlag>> {
  return useSyncExternalStore(subscribe, () => flags);
}

export function useChatFlag(threadId: string): ChatFlag | undefined {
  return useSyncExternalStore(subscribe, () => flags[threadId]);
}

/** Red before yellow before blue before unflagged; ties keep their existing order. */
export function sortByChatFlag<T extends { id: string }>(
  threads: ReadonlyArray<T>,
  byThread: Readonly<Record<string, ChatFlag>>,
): T[] {
  return threads.toSorted((a, b) => (byThread[a.id] ?? 4) - (byThread[b.id] ?? 4));
}

let loaded = false;
function load(): void {
  void fetch(`${serviceUrl()}/flags`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { flags?: unknown } | null) => {
      if (body?.flags !== undefined) setFlags(parseFlags(body.flags), false);
    })
    .catch(() => undefined);
}

/** Pulls flags from the todo service once, and again when the tab comes back into view. */
export function installChatFlags(): void {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
}
