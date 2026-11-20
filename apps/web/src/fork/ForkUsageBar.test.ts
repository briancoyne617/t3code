import { describe, expect, it } from "vite-plus/test";

import { usageRowTags, visibleUsageRows, windowTimeLeftFraction } from "./ForkUsageBar";

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

describe("usageRowTags", () => {
  const row = (driver: string, instanceId: string) => ({ driver, instanceId }) as never;

  it("numbers rows only when a provider has more than one connection", () => {
    const rows = [
      row("claudeAgent", "claudeAgent"),
      row("codex", "codex"),
      row("claudeAgent", "claudeAgent_second"),
    ];
    const tags = usageRowTags(rows);
    expect(tags.get("claudeAgent")).toBe(1);
    expect(tags.get("claudeAgent_second")).toBe(2);
    expect(tags.has("codex")).toBe(false);
  });

  it("adds no tags when every provider has one row", () => {
    expect(usageRowTags([row("claudeAgent", "claudeAgent"), row("codex", "codex")]).size).toBe(0);
  });
});

describe("windowTimeLeftFraction", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");

  it("uses 5 hours and a week when the window length is not reported", () => {
    const session = { kind: "session", resetsAt: "2026-11-19T13:00:00Z" } as const;
    expect(windowTimeLeftFraction(session, now)).toBeCloseTo(0.2);
    const weekly = { kind: "weekly", resetsAt: "2026-11-22T12:00:00Z" } as const;
    expect(windowTimeLeftFraction(weekly, now)).toBeCloseTo(3 / 7);
  });

  it("prefers the reported length and clamps to the window", () => {
    const window = { kind: "other", resetsAt: "2026-11-19T13:00:00Z", windowDurationMins: 120 };
    expect(windowTimeLeftFraction(window as never, now)).toBeCloseTo(0.5);
    expect(windowTimeLeftFraction({ kind: "session", resetsAt: "2026-11-19T11:00:00Z" }, now)).toBe(
      0,
    );
    expect(windowTimeLeftFraction({ kind: "session", resetsAt: "2026-11-20T12:00:00Z" }, now)).toBe(
      1,
    );
    expect(
      windowTimeLeftFraction({ kind: "other", resetsAt: "2026-11-19T13:00:00Z" }, now),
    ).toBeNull();
    expect(windowTimeLeftFraction({ kind: "session" }, now)).toBeNull();
  });
});
