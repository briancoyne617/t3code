import { describe, expect, it, vi } from "vite-plus/test";

import { copyKeyWhileMenuOpen } from "./copyKeyWhileMenuOpen";

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "c",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

describe("copyKeyWhileMenuOpen", () => {
  it("copies on Ctrl+C or Cmd+C until stopped", () => {
    const onCopy = vi.fn();
    const stop = copyKeyWhileMenuOpen(onCopy);
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(true);
    press({ metaKey: true });
    press({ ctrlKey: true, altKey: true });
    press({ key: "v", ctrlKey: true });
    press({});
    expect(onCopy).toHaveBeenCalledTimes(2);
    stop();
    press({ ctrlKey: true });
    expect(onCopy).toHaveBeenCalledTimes(2);
  });
});
