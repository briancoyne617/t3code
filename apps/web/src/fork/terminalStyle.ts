import { useSyncExternalStore } from "react";

import "./terminalStyle.css";

/**
 * Terminal style: restyles the whole app (chat, sidebar, headers, settings) to look like
 * the Claude Code CLI. Pure CSS under `html[data-fork-terminal]`, so upstream markup stays
 * untouched and turning it off restores the stock look. Saved per device; on by default.
 */
const STORAGE_KEY = "fork.terminalStyle";
const ATTR = "data-fork-terminal";

const listeners = new Set<() => void>();
let enabled = read();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (enabled) document.documentElement.setAttribute(ATTR, "");
  else document.documentElement.removeAttribute(ATTR);
}

export function setTerminalStyle(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Private window: still applies for this session.
  }
  apply();
  for (const listener of listeners) listener();
}

export function useTerminalStyle(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
  );
}

export function installTerminalStyle(): void {
  apply();
  if (typeof window === "undefined") return;
  // Another tab toggled it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    enabled = read();
    apply();
    for (const listener of listeners) listener();
  });
}
