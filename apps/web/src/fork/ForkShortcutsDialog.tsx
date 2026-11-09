import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import {
  buildKeybindingRows,
  commandLabel,
  filterKeybindingRows,
  keybindingFromKeyboardEvent,
  type KeybindingRow,
} from "../components/settings/KeybindingsSettings.logic";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Kbd } from "../components/ui/kbd";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { primaryServerConfigAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { classifyShortcut, suggestReplacement } from "./browserShortcuts";
import { NO_AUTOFILL } from "./noAutofill";
import { isTypingTarget } from "./TodoList";

const FORK_SHORTCUTS = [
  { label: "Fork: open this shortcuts screen", key: "?" },
  { label: "Fork: general todo list", key: "alt+g" },
  { label: "Fork: project todo list", key: "alt+t" },
  { label: "Fork: this chat's todo list (composer tab, top right)", key: "alt+j" },
  { label: "Fork: undo the last todo change (outside text fields)", key: "ctrl+z" },
  { label: "Fork: redo a todo change", key: "ctrl+shift+z / ctrl+y" },
  { label: "File finder (VS Code's Ctrl+P)", key: "ctrl+p" },
  {
    label: "Command palette (VS Code's Ctrl+Shift+P; Firefox keeps that key, use F1 or Ctrl+K)",
    key: "f1 / ctrl+k",
  },
];

/** `?` opens every shortcut. Type to filter; click a key to record a new one; nothing is written until Save. */
export function ForkShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [additions, setAdditions] = useState<
    ReadonlyArray<{ command: KeybindingRow["command"]; key: string }>
  >([]);
  const [notice, setNotice] = useState<{ level: "blocked" | "warn"; text: string } | null>(null);
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const config = useAtomValue(primaryServerConfigAtom);
  const upsert = useAtomCommand(serverEnvironment.upsertKeybinding, { reportFailure: false });
  const rows = filterKeybindingRows(
    buildKeybindingRows(mergeWithDefaultKeybindings(config?.keybindings ?? [])),
    query,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global `?` hotkey is a DOM listener outside React
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allRows = buildKeybindingRows(mergeWithDefaultKeybindings(config?.keybindings ?? []));
  const blockedRows = allRows.filter(
    (row) => row.key && classifyShortcut(edits.get(row.id) ?? row.key).level === "blocked",
  );
  const pending = edits.size + additions.length;

  /** Stage a new key for a row, refusing keys the browser keeps and explaining risky ones. */
  const stage = (row: KeybindingRow, next: string) => {
    const verdict = classifyShortcut(next);
    if (verdict.level === "blocked") {
      setNotice({ level: "blocked", text: `${next} can't be used: ${verdict.reason}.` });
      return;
    }
    setNotice(
      verdict.level === "warn" ? { level: "warn", text: `${next}: ${verdict.reason}.` } : null,
    );
    const updated = new Map(edits);
    if (next === row.key) updated.delete(row.id);
    else updated.set(row.id, next);
    setEdits(updated);
    setRecording(null);
  };
  /** Stage browser-safe replacements for every blocked binding, plus F1 for the command palette. */
  const fixBlocked = () => {
    const updated = new Map(edits);
    for (const row of blockedRows) {
      const replacement = suggestReplacement(row.key);
      if (replacement && classifyShortcut(replacement).level !== "blocked")
        updated.set(row.id, replacement);
    }
    setEdits(updated);
    if (!allRows.some((row) => row.command === "commandPalette.toggle" && row.key === "f1")) {
      setAdditions([
        ...additions.filter((a) => a.command !== "commandPalette.toggle"),
        { command: "commandPalette.toggle", key: "f1" },
      ]);
    }
    setNotice({
      level: "warn",
      text: "Staged browser-safe replacements. Review them, then press Save.",
    });
  };

  const reset = () => {
    setEdits(new Map());
    setAdditions([]);
    setNotice(null);
    setRecording(null);
    setQuery("");
  };
  const requestClose = async () => {
    if (pending > 0) {
      const discard = await requestConfirmDialog(
        `Discard ${pending} unsaved shortcut change${pending === 1 ? "" : "s"}?`,
      );
      if (discard === false) return;
    }
    reset();
    setOpen(false);
  };
  const saveAll = async () => {
    if (!environmentId) return;
    setSaving(true);
    const byId = new Map(
      buildKeybindingRows(mergeWithDefaultKeybindings(config?.keybindings ?? [])).map((row) => [
        row.id,
        row,
      ]),
    );
    let failed = 0;
    for (const [id, key] of edits) {
      const row = byId.get(id);
      if (!row) continue;
      const result = await upsert({
        environmentId,
        input: {
          command: row.command,
          key,
          ...(row.when.trim() ? { when: row.when } : {}),
          replace: {
            command: row.command,
            key: row.key,
            ...(row.when.trim() ? { when: row.when } : {}),
          },
        },
      });
      if (result._tag === "Failure") failed++;
    }
    for (const addition of additions) {
      const result = await upsert({ environmentId, input: addition });
      if (result._tag === "Failure") failed++;
    }
    setSaving(false);
    if (failed > 0) {
      toastManager.add({ type: "error", title: `${failed} shortcut(s) could not be saved` });
      return;
    }
    toastManager.add({ type: "success", title: `Saved ${pending} shortcut change(s)` });
    reset();
  };
  const keyOf = (row: KeybindingRow) => edits.get(row.id) ?? row.key;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else void requestClose();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {notice ? (
            <p
              className={
                notice.level === "blocked" ? "text-sm text-destructive" : "text-sm text-warning"
              }
            >
              {notice.text}
            </p>
          ) : null}
          {blockedRows.length > 0 ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-destructive">
                {blockedRows.length} shortcut(s) can never fire in the browser (⛔).
              </span>
              <Button variant="ghost" size="compact" onClick={fixBlocked}>
                Suggest fixes
              </Button>
            </div>
          ) : null}
          <Input
            {...NO_AUTOFILL}
            autoFocus
            value={query}
            placeholder="Type to filter…"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ul className="flex max-h-[60vh] flex-col overflow-y-auto text-sm">
            {FORK_SHORTCUTS.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())).map(
              (shortcut) => (
                <li key={shortcut.label} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-muted-foreground">{shortcut.label}</span>
                  <Kbd>{shortcut.key}</Kbd>
                </li>
              ),
            )}
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-1">
                <span className={edits.has(row.id) ? "font-medium" : undefined}>
                  {commandLabel(row.command)}
                  {row.when ? (
                    <span className="text-xs text-muted-foreground"> · {row.when}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {(() => {
                    const verdict = keyOf(row)
                      ? classifyShortcut(keyOf(row))
                      : { level: "ok" as const };
                    return verdict.level === "ok" ? null : (
                      <span
                        className={
                          verdict.level === "blocked"
                            ? "text-xs text-destructive"
                            : "text-xs text-warning"
                        }
                        aria-label={verdict.reason}
                      >
                        {verdict.level === "blocked"
                          ? `⛔ ${verdict.reason}`
                          : `⚠ ${verdict.reason}`}
                      </span>
                    );
                  })()}
                  {recording === row.id ? (
                    <div className="w-56">
                      <Input
                        {...NO_AUTOFILL}
                        autoFocus
                        size="sm"
                        placeholder="press keys, or type e.g. ctrl+alt+n"
                        onBlur={() => setRecording(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            return setRecording(null);
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const typed = event.currentTarget.value
                              .trim()
                              .toLowerCase()
                              .replace(/\s+/g, "");
                            if (typed) stage(row, typed);
                            return;
                          }
                          const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
                          if (!hasModifier && !/^F\d+$/.test(event.key)) return;
                          if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
                          event.preventDefault();
                          const next = keybindingFromKeyboardEvent(
                            event.nativeEvent,
                            navigator.platform,
                          );
                          if (next) stage(row, next);
                        }}
                      />
                    </div>
                  ) : (
                    <Button variant="ghost" size="compact" onClick={() => setRecording(row.id)}>
                      {keyOf(row) || "unbound"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </DialogPanel>
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {pending > 0
              ? `${pending} unsaved change(s)`
              : "Click a shortcut, then press or type the new keys"}
          </span>
          <Button variant="ghost" onClick={() => void requestClose()}>
            Close
          </Button>
          <Button disabled={pending === 0 || saving} onClick={() => void saveAll()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
