import type { SnoozePreset } from "../components/Sidebar.snooze";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";

vi.mock(import("../commandPaletteBus"), () => ({ isCommandPaletteOpen: () => false }));
vi.mock(import("../modelPickerVisibility"), () => ({ isModelPickerOpen: () => false }));
vi.mock(import("../components/CustomSnoozeDialog"), () => ({ requestCustomSnooze: vi.fn() }));
vi.mock(import("../components/Sidebar.snooze"), () => ({
  resolveSnoozePresets: vi.fn(() =>
    [1, 2, 3, 4].map((n) => ({
      id: String(n),
      label: `Preset ${n}`,
      whenLabel: "Later",
      snoozedUntil: `2099-01-0${n}T00:00:00Z`,
    })),
  ),
  pickSnoozePreset: vi.fn((shown: ReadonlyArray<SnoozePreset>, id: string) =>
    shown.find((preset) => preset.id === id),
  ),
}));
import { requestCustomSnooze } from "../components/CustomSnoozeDialog";
import { resolveSnoozePresets } from "../components/Sidebar.snooze";
import { ForkSnoozePicker, blocksSnoozeShortcut, matchesSnoozeShortcut } from "./ForkSnoozePicker";

const target = { environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("thread") };
const shortcut = () =>
  new KeyboardEvent("keydown", {
    code: "KeyZ",
    key: "Z",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

it("leaves typing, composition, repeats and modified shortcuts alone", () => {
  expect(matchesSnoozeShortcut(shortcut())).toBe(true);
  for (const extra of [
    { repeat: true },
    { isComposing: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: false },
  ]) {
    expect(
      matchesSnoozeShortcut(
        new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, shiftKey: true, ...extra }),
      ),
    ).toBe(false);
  }
  for (const tag of ["input", "textarea", "select"])
    expect(blocksSnoozeShortcut(document.createElement(tag))).toBe(true);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const child = dialog.appendChild(document.createElement("button"));
  expect(blocksSnoozeShortcut(child)).toBe(true);
});

it("uses the destination presets, cancels, and retains the original target through custom selection", async () => {
  const snooze = vi.fn();
  let current = target;
  let allowed = true;
  let bound = false;
  await using _screen = await render(
    <ForkSnoozePicker
      timestampFormat="locale"
      readTarget={() => current}
      canSnooze={() => allowed}
      hasBinding={() => bound}
      snooze={snooze}
    />,
    { router: false },
  );
  const open = async () => {
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await act(() => {
      window.dispatchEvent(shortcut());
    });
    if (allowed && !bound) {
      await expect.element(page.getByRole("button", { name: "1. Preset 1" })).toHaveFocus();
    }
  };
  allowed = false;
  await open();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  allowed = true;
  bound = true;
  await open();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  bound = false;
  await open();
  expect(resolveSnoozePresets).toHaveBeenLastCalledWith(
    expect.any(Date),
    "locale",
    target.environmentId,
  );
  await expect.element(page.getByRole("button", { name: "3. Preset 3" })).toBeVisible();
  await expect.element(page.getByText("Preset 4")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(snooze).not.toHaveBeenCalled();
  await open();
  await userEvent.keyboard("2");
  expect(snooze).toHaveBeenLastCalledWith(target, expect.objectContaining({ id: "2" }));
  await open();
  let finish!: (value: { snoozedUntil: string } | null) => void;
  vi.mocked(requestCustomSnooze).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.keyboard("4");
  current = { ...target, threadId: ThreadId.make("other") };
  await act(() => finish({ snoozedUntil: "2099-02-01T00:00:00Z" }));
  expect(snooze).toHaveBeenLastCalledWith(target, { snoozedUntil: "2099-02-01T00:00:00Z" });
  await open();
  allowed = false;
  await page.getByRole("button", { name: "1. Preset 1" }).click();
  expect(snooze).toHaveBeenCalledTimes(2);
});
