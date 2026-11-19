import { describe, expect, it } from "vite-plus/test";

import { nextChatFlag, parseFlags, sortByChatFlag } from "./chatFlags";

describe("chat flags", () => {
  it("cycles none, red, yellow, blue, none", () => {
    expect(nextChatFlag(undefined)).toBe(1);
    expect(nextChatFlag(1)).toBe(2);
    expect(nextChatFlag(2)).toBe(3);
    expect(nextChatFlag(3)).toBeUndefined();
  });

  it("sorts red, yellow, blue, then unflagged, keeping order within a flag", () => {
    const threads = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const flags = { b: 3, c: 1, d: 2, e: 1 } as const;
    expect(sortByChatFlag(threads, flags).map((t) => t.id)).toEqual(["c", "e", "d", "b", "a"]);
  });

  it("drops anything that is not a 1-3 flag", () => {
    expect(parseFlags({ a: 1, b: 4, c: "2", d: 3 })).toEqual({ a: 1, d: 3 });
    expect(parseFlags(null)).toEqual({});
  });
});
