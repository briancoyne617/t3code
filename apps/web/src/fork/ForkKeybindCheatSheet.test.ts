import { describe, expect, it } from "vite-plus/test";

import { filterCheatSheet, prettyKeys } from "./ForkKeybindCheatSheet";

describe("prettyKeys", () => {
  it("spells out modifiers and alternatives", () => {
    expect(prettyKeys("mod+shift+p")).toBe("Ctrl + Shift + P");
    expect(prettyKeys("ctrl+shift+p / f1")).toBe("Ctrl + Shift + P  or  f1");
    expect(prettyKeys("alt+shift+arrowleft")).toBe("Alt + Shift + ←");
  });
});

describe("filterCheatSheet", () => {
  const entries = [
    { keys: "mod+p", label: "Go to file" },
    { keys: "mod+shift+p", label: "Command palette" },
    { keys: "alt+g", label: "General todos" },
  ];

  it("matches every word against labels and keys, sorted by label", () => {
    expect(filterCheatSheet(entries, "").map((e) => e.label)).toEqual([
      "Command palette",
      "General todos",
      "Go to file",
    ]);
    expect(filterCheatSheet(entries, "ctrl shift").map((e) => e.label)).toEqual([
      "Command palette",
    ]);
    expect(filterCheatSheet(entries, "todo alt")).toHaveLength(1);
  });
});
