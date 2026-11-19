import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import {
  buildKeybindingRows,
  commandLabel,
} from "../components/settings/KeybindingsSettings.logic";
import { Dialog, DialogPanel, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Kbd } from "../components/ui/kbd";
import { primaryServerConfigAtom } from "../state/server";
import { FORK_SHORTCUTS } from "./ForkShortcutsDialog";
import { NO_AUTOFILL } from "./noAutofill";

export interface CheatSheetEntry {
  readonly keys: string;
  readonly label: string;
}

const KEY_NAMES: Record<string, string> = {
  mod: "Ctrl",
  ctrl: "Ctrl",
  meta: "Super",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

/** "mod+shift+p" → "Ctrl + Shift + P"; alternatives split on " / " stay separate. */
export function prettyKeys(keys: string): string {
  return keys
    .split(" / ")
    .map((combo) =>
      combo
        .split("+")
        .filter(Boolean)
        .map(
          (part) =>
            KEY_NAMES[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part),
        )
        .join(" + "),
    )
    .join("  or  ");
}

/** Entries matching every word of the query, by label or keys, sorted by label. */
export function filterCheatSheet(
  entries: ReadonlyArray<CheatSheetEntry>,
  query: string,
): CheatSheetEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => {
      const hay = `${entry.label} ${prettyKeys(entry.keys)} ${entry.keys}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    })
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

const isCtrlK = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "k";

/** Ctrl+K: every shortcut as one searchable list, like Omarchy's Super+K keybindings menu. */
export function ForkKeybindCheatSheet() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const config = useAtomValue(primaryServerConfigAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global hotkey is a DOM listener outside React
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCtrlK(event)) return;
      // Shells use Ctrl+K to cut to the end of the line.
      if (event.target instanceof Element && event.target.closest(".xterm")) return;
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const entries: CheatSheetEntry[] = open
    ? [
        ...FORK_SHORTCUTS.map((shortcut) => ({ keys: shortcut.key, label: shortcut.label })),
        ...buildKeybindingRows(mergeWithDefaultKeybindings(config?.keybindings ?? []))
          .filter((row) => row.key)
          .map((row) => ({ keys: row.key, label: commandLabel(row.command) })),
      ]
    : [];
  const shown = filterCheatSheet(entries, query);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Keybindings</DialogTitle>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            <Input
              {...NO_AUTOFILL}
              type="search"
              autoFocus
              value={query}
              placeholder="Search keybindings…"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <ul className="flex max-h-[65vh] flex-col overflow-y-auto font-mono text-xs">
              {shown.map((entry) => (
                <li
                  key={`${entry.keys}:${entry.label}`}
                  className="grid grid-cols-[minmax(9rem,auto)_1fr] items-baseline gap-4 rounded px-2 py-1 hover:bg-foreground/5"
                >
                  <Kbd className="justify-self-start">{prettyKeys(entry.keys)}</Kbd>
                  <span className="truncate text-muted-foreground">{entry.label}</span>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="py-6 text-center text-muted-foreground">No matching keybindings.</li>
              ) : null}
            </ul>
            <p className="text-2xs text-muted-foreground">
              Ctrl+K or Esc closes · ? edits shortcuts
            </p>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
