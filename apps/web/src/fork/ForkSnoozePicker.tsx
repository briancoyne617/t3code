import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useEffect, useEffectEvent, useState } from "react";
import { requestCustomSnooze } from "../components/CustomSnoozeDialog";
import {
  pickSnoozePreset,
  resolveSnoozePresets,
  type SnoozePreset,
} from "../components/Sidebar.snooze";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isModelPickerOpen } from "../modelPickerVisibility";

export function matchesSnoozeShortcut(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.repeat &&
    !event.isComposing &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "KeyZ"
  );
}

export function blocksSnoozeShortcut(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest(
        'input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"], [role="combobox"], .xterm',
      ))
  );
}

type Request = { target: ScopedThreadRef; presets: ReadonlyArray<SnoozePreset> };

export function ForkSnoozePicker(props: {
  timestampFormat: TimestampFormat;
  readTarget: () => ScopedThreadRef | null;
  canSnooze: (target: ScopedThreadRef) => boolean;
  hasBinding: (event: KeyboardEvent) => boolean;
  snooze: (target: ScopedThreadRef, choice: Pick<SnoozePreset, "snoozedUntil">) => void;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const open = useEffectEvent((event: KeyboardEvent) => {
    if (
      !matchesSnoozeShortcut(event) ||
      blocksSnoozeShortcut(event.target) ||
      request ||
      isCommandPaletteOpen() ||
      isModelPickerOpen() ||
      document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') ||
      props.hasBinding(event)
    )
      return;
    const target = props.readTarget();
    if (!target || !props.canSnooze(target)) return;
    event.preventDefault();
    setRequest({
      target,
      presets: resolveSnoozePresets(new Date(), props.timestampFormat, target.environmentId).slice(
        0,
        3,
      ),
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the fork shortcut to window keyboard events.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => open(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const choose = async (index: number) => {
    if (!request) return;
    const { target, presets } = request;
    setRequest(null);
    const choice =
      index === 3
        ? await requestCustomSnooze()
        : presets[index] &&
          pickSnoozePreset(presets, presets[index].id, props.timestampFormat, target.environmentId);
    if (choice && props.canSnooze(target)) props.snooze(target, choice);
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(value) => {
        if (!value) setRequest(null);
      }}
    >
      <DialogPopup
        className="sm:max-w-xs"
        onKeyDown={(event) => {
          if (
            event.repeat ||
            event.nativeEvent.isComposing ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          const index = ["1", "2", "3", "4"].indexOf(event.key);
          if (index < 0 || (index !== 3 && !request?.presets[index])) return;
          event.preventDefault();
          event.stopPropagation();
          void choose(index);
        }}
      >
        <DialogHeader>
          <DialogTitle>Snooze thread</DialogTitle>
          <DialogDescription>Choose 1–4, or Escape to cancel.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            {request?.presets.map((preset, index) => (
              <Button key={preset.id} variant="outline" onClick={() => void choose(index)}>
                {index + 1}. {preset.label}
              </Button>
            ))}
            <Button variant="outline" onClick={() => void choose(3)}>
              4. Custom date and time…
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
