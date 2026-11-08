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
import { isTypingTarget } from "./TodoList";

const FORK_SHORTCUTS = [
  { label: "Fork: open this shortcuts screen", key: "?" },
  { label: "Fork: general todo list", key: "alt+g" },
  { label: "Fork: project todo list", key: "alt+t" },
];

/** `?` opens every shortcut. Type to filter; click a key to record a new one; nothing is written until Save. */
export function ForkShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
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

  const reset = () => {
    setEdits(new Map());
    setRecording(null);
    setQuery("");
  };
  const requestClose = async () => {
    if (edits.size > 0) {
      const discard = await requestConfirmDialog(
        `Discard ${edits.size} unsaved shortcut change${edits.size === 1 ? "" : "s"}?`,
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
    setSaving(false);
    if (failed > 0) {
      toastManager.add({ type: "error", title: `${failed} shortcut(s) could not be saved` });
      return;
    }
    toastManager.add({ type: "success", title: `Saved ${edits.size} shortcut change(s)` });
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
          <Input
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
                <Button
                  variant={recording === row.id ? "default" : "ghost"}
                  size="compact"
                  onClick={() => setRecording(row.id)}
                  onKeyDown={(event) => {
                    if (recording !== row.id) return;
                    event.preventDefault();
                    if (event.key === "Escape") return setRecording(null);
                    const next = keybindingFromKeyboardEvent(event.nativeEvent, navigator.platform);
                    if (!next || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
                    const updated = new Map(edits);
                    if (next === row.key) updated.delete(row.id);
                    else updated.set(row.id, next);
                    setEdits(updated);
                    setRecording(null);
                  }}
                >
                  {recording === row.id ? "Press keys…" : keyOf(row) || "unbound"}
                </Button>
              </li>
            ))}
          </ul>
        </DialogPanel>
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {edits.size > 0
              ? `${edits.size} unsaved change(s)`
              : "Click a shortcut, then press the new keys"}
          </span>
          <Button variant="ghost" onClick={() => void requestClose()}>
            Close
          </Button>
          <Button disabled={edits.size === 0 || saving} onClick={() => void saveAll()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
