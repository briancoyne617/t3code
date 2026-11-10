import { describe, expect, it } from "vite-plus/test";

import { visibleUsageRows } from "./ForkUsageBar";

const window = { id: "5h", kind: "session", label: "5h", usedPercent: 10 } as const;
const limits = (windows: ReadonlyArray<typeof window>) => ({
  checkedAt: "",
  windows: [...windows],
});

describe("visibleUsageRows", () => {
  it("drops a numberless Codex row when another Codex row has numbers", () => {
    const managed = { enabled: true, driver: "codex", usageLimits: limits([]) };
    const direct = { enabled: true, driver: "codex", usageLimits: limits([window]) };
    const claude = { enabled: true, driver: "claudeAgent", usageLimits: limits([]) };
    expect(visibleUsageRows([managed, direct, claude] as never[])).toEqual([direct, claude]);
  });

  it("keeps the numberless row when it is the only one, and skips disabled ones", () => {
    const managed = { enabled: true, driver: "codex", usageLimits: limits([]) };
    const off = { enabled: false, driver: "codex", usageLimits: limits([window]) };
    expect(visibleUsageRows([managed, off] as never[])).toEqual([managed]);
  });
});
