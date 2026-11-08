/**
 * Shortcuts the browser or Windows keeps for itself. A web page never receives "blocked" ones
 * (Firefox opens a window/tab instead), so binding them can never work. "warn" ones do reach
 * the page, but replace a familiar browser action.
 */
export type ShortcutVerdict =
  | { readonly level: "ok" }
  | { readonly level: "blocked" | "warn"; readonly reason: string };

const isMac = () => /mac|iphone|ipad/i.test(navigator.platform);

/** `mod+shift+P` → `ctrl+shift+p` on Windows/Linux, `meta+…` on macOS; modifiers sorted. */
function normalizeShortcut(key: string): string {
  const parts = key.toLowerCase().split("+").filter(Boolean);
  const main = parts.at(-1) ?? "";
  const mods = new Set(
    parts
      .slice(0, -1)
      .map((m) => (m === "mod" ? (isMac() ? "meta" : "ctrl") : m === "cmd" ? "meta" : m)),
  );
  return [...["ctrl", "meta", "alt", "shift"].filter((m) => mods.has(m)), main].join("+");
}

const BLOCKED: Record<string, string> = {
  "ctrl+n": "Firefox opens a new window",
  "ctrl+shift+n": "Firefox reopens a closed window",
  "ctrl+t": "Firefox opens a new tab",
  "ctrl+shift+t": "Firefox reopens a closed tab",
  "ctrl+w": "Firefox closes the tab",
  "ctrl+shift+w": "Firefox closes the window",
  "ctrl+f4": "Firefox closes the tab",
  "ctrl+tab": "Firefox switches tabs",
  "ctrl+shift+tab": "Firefox switches tabs",
  "ctrl+pageup": "Firefox switches tabs",
  "ctrl+pagedown": "Firefox switches tabs",
  "ctrl+shift+p": "Firefox opens a private window",
  "ctrl+q": "Firefox quits",
  "ctrl+shift+q": "Firefox quits",
  "alt+f4": "Windows closes the window",
  "alt+tab": "Windows switches apps",
  "alt+escape": "Windows switches apps",
  "ctrl+escape": "Windows opens the Start menu",
  "ctrl+shift+escape": "Windows opens Task Manager",
  "ctrl+alt+delete": "Windows security screen",
  f11: "Firefox toggles full screen",
};
for (let n = 1; n <= 9; n++) BLOCKED[`ctrl+${n}`] = "Firefox jumps to a tab";

const WARN: Record<string, string> = {
  "ctrl+l": "replaces Firefox's 'focus the address bar'",
  "ctrl+r": "replaces reload (a stuck page can't be reloaded with it)",
  f5: "replaces reload (a stuck page can't be reloaded with it)",
  "ctrl+shift+r": "replaces hard reload",
  "ctrl+d": "replaces 'bookmark this page'",
  "ctrl+f": "replaces Firefox's find in page",
  "ctrl+g": "replaces 'find next'",
  "ctrl+h": "replaces the history sidebar",
  "ctrl+j": "replaces the downloads window",
  "ctrl+p": "replaces print",
  "ctrl+s": "replaces 'save page'",
  "ctrl+u": "replaces 'view source'",
  "ctrl+o": "replaces 'open file'",
  "ctrl+shift+i": "replaces developer tools",
  "ctrl+shift+k": "replaces the web console",
  "ctrl+shift+c": "replaces the element picker",
  "ctrl+shift+e": "replaces the network monitor",
  "ctrl+shift+m": "replaces responsive design mode",
  "ctrl+shift+b": "replaces the bookmarks toolbar toggle",
  "ctrl+shift+o": "replaces the bookmarks library",
  "ctrl+shift+a": "replaces the add-ons manager",
  "ctrl+shift+h": "replaces the history library",
  "ctrl+shift+delete": "replaces 'clear recent history'",
  "ctrl+=": "replaces page zoom",
  "ctrl++": "replaces page zoom",
  "ctrl+-": "replaces page zoom",
  "ctrl+0": "replaces page zoom reset",
  f1: "replaces Firefox help",
  f3: "replaces 'find next'",
  f6: "replaces 'focus the address bar'",
  f7: "replaces caret browsing",
  f12: "replaces developer tools",
};
for (const letter of "fevsbth")
  WARN[`alt+${letter}`] = "Firefox uses Alt+letter to open its menu bar";

export function classifyShortcut(key: string): ShortcutVerdict {
  const normalized = normalizeShortcut(key);
  if (normalized.startsWith("meta+") && !isMac())
    return { level: "blocked", reason: "the Windows key belongs to Windows" };
  const blocked = BLOCKED[normalized];
  if (blocked) return { level: "blocked", reason: `${blocked}; the page never sees this key` };
  const warn = WARN[normalized];
  if (warn) return { level: "warn", reason: `Works, but ${warn}` };
  return { level: "ok" };
}

/** Browser-safe replacements for the defaults that can't work in Firefox. */
export function suggestReplacement(key: string): string | null {
  const normalized = normalizeShortcut(key);
  if (normalized === "ctrl+shift+p") return "f1";
  const match = /^ctrl\+(shift\+)?([a-z0-9]|tab|pageup|pagedown|f4)$/.exec(normalized);
  if (!match) return null;
  return `mod+alt+${match[1] ?? ""}${match[2]}`;
}
