import { describe, expect, it } from "vite-plus/test";

import type { Todo } from "./todoModel";
import { countOtherProjectTodos, matchesOwnerFilter, nextOwnerFilter } from "./TodoPanel";

function todo(id: string, fields: Partial<Todo>): Todo {
  return {
    id,
    text: id,
    priority: 4,
    due: null,
    time: null,
    recur: null,
    labels: [],
    projectId: null,
    threadId: null,
    links: [],
    status: "open",
    createdAt: "2026-11-19T00:00:00Z",
    updatedAt: "2026-11-19T00:00:00Z",
    completedAt: null,
    deletedAt: null,
    createdBy: "user",
    owner: "user",
    order: 0,
    ...fields,
  };
}

describe("countOtherProjectTodos", () => {
  const shells = new Map([
    ["here", { projectId: "p" }],
    ["there", { projectId: "p" }],
    ["away", { projectId: "q" }],
  ]);
  const scope = { kind: "thread", threadId: "here", projectId: "p" } as const;

  it("counts open project todos that are not on this chat's list", () => {
    const todos = [
      todo("mine", { threadId: "here" }),
      todo("linked", { threadId: "there", links: ["here"] }),
      todo("sibling", { threadId: "there" }),
      todo("sibling-agent", { threadId: "there", owner: "agent" }),
      todo("project", { projectId: "p", owner: null }),
      todo("closed", { threadId: "there", status: "done" }),
      todo("other-project", { threadId: "away" }),
      todo("general", {}),
    ];
    expect(countOtherProjectTodos(todos, scope, shells)).toEqual({
      user: 1,
      agent: 1,
      unassigned: 1,
    });
  });

  it("counts nothing outside a chat with a project", () => {
    const todos = [todo("sibling", { threadId: "there" })];
    const none = { user: 0, agent: 0, unassigned: 0 };
    expect(countOtherProjectTodos(todos, { kind: "project", projectId: "p" }, shells)).toEqual(
      none,
    );
    expect(
      countOtherProjectTodos(todos, { kind: "thread", threadId: "here", projectId: null }, shells),
    ).toEqual(none);
  });
});

describe("owner filter", () => {
  it("cycles Both, Mine, Agent's", () => {
    expect(nextOwnerFilter("both")).toBe("mine");
    expect(nextOwnerFilter("mine")).toBe("agent");
    expect(nextOwnerFilter("agent")).toBe("both");
  });

  it("keeps unassigned todos under Mine", () => {
    expect(matchesOwnerFilter({ owner: null }, "mine")).toBe(true);
    expect(matchesOwnerFilter({ owner: "user" }, "mine")).toBe(true);
    expect(matchesOwnerFilter({ owner: "agent" }, "mine")).toBe(false);
    expect(matchesOwnerFilter({ owner: null }, "agent")).toBe(false);
    expect(matchesOwnerFilter({ owner: "agent" }, "both")).toBe(true);
  });
});
