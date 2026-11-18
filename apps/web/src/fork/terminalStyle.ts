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

const BOOT_COLORS_KEY = "fork.bootColors";

interface BootColors {
  background: string;
  foreground: string;
  accent: string;
  muted: string;
}

/**
 * Saves the colours the app is showing right now, for public/fork-boot.js to paint the next
 * boot screen with. Kept per light/dark mode so "System" appearance follows the OS at boot.
 */
function saveBootColors(): void {
  try {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const read = (name: string) => css.getPropertyValue(name).trim();
    const colors: BootColors = {
      background: read("--background"),
      foreground: read("--foreground"),
      accent: read("--ring"),
      muted: read("--muted-foreground"),
    };
    if (!colors.background || !colors.foreground) return;
    const theme = localStorage.getItem("t3code:theme") ?? "";
    const mode = root.classList.contains("dark") ? "dark" : "light";
    const previous = JSON.parse(localStorage.getItem(BOOT_COLORS_KEY) ?? "null") as {
      theme?: string;
    } | null;
    const base = previous && previous.theme === theme ? previous : { theme };
    const next = { ...base, theme, [mode]: colors };
    const serialized = JSON.stringify(next);
    if (localStorage.getItem(BOOT_COLORS_KEY) !== serialized) {
      localStorage.setItem(BOOT_COLORS_KEY, serialized);
    }
  } catch {
    // Storage blocked: the boot screen keeps T3's defaults.
  }
}

function watchBootColors(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(saveBootColors, 500);
  };
  // Theme switches change the root's class, style or theme id; OS light/dark flips too.
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme-id"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
  schedule();
}

export function installTerminalStyle(): void {
  apply();
  if (typeof document !== "undefined") watchBootColors();
  if (typeof window === "undefined") return;
  // Another tab toggled it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    enabled = read();
    apply();
    for (const listener of listeners) listener();
  });
}
