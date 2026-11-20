import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";

import { counterpartModelSelection, makeRetryBook } from "./limitModelSwitch.ts";

const effortModel = (slug: string, optionId: string, efforts: ReadonlyArray<string>) => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: {
    optionDescriptors: [
      {
        id: optionId,
        label: "Effort",
        type: "select" as const,
        options: efforts.map((id) => ({ id, label: id })),
      },
    ],
  },
});

const plainModel = (slug: string) => ({ slug, name: slug, isCustom: false, capabilities: null });

const makeProvider = (
  driver: string,
  instanceId: string,
  models: ServerProvider["models"],
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  driver: ProviderDriverKind.make(driver),
  instanceId: ProviderInstanceId.make(instanceId),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  checkedAt: "2026-11-18T00:00:00Z",
  auth: { status: "authenticated" },
  models,
  skills: [],
  slashCommands: [],
  ...overrides,
});

const ALL = ["low", "medium", "high", "xhigh", "max"];
const claude = makeProvider("claudeAgent", "claudeAgent", [
  effortModel("claude-opus-5-5", "effort", ALL),
  effortModel("claude-sonnet-5-5", "effort", ["low", "medium", "high"]),
  plainModel("claude-haiku-5-5"),
]);
const codex = makeProvider("codex", "codex", [
  effortModel("gpt-6.2-astra", "reasoningEffort", ALL),
  effortModel("gpt-6.2-sol", "reasoningEffort", ["medium", "high"]),
  plainModel("gpt-6-luna"),
]);

const selection = (
  instanceId: string,
  model: string,
  options?: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
  ...(options === undefined ? {} : { options }),
});

describe("counterpartModelSelection", () => {
  it("maps Opus xhigh to Astra xhigh on the codex instance", () => {
    const current = selection("claudeAgent", "claude-opus-5-5", [
      { id: "effort", value: "xhigh" },
      { id: "fastMode", value: false },
    ]);
    expect(counterpartModelSelection(current, "claudeAgent", [claude, codex])).toEqual({
      instanceId: "codex",
      model: "gpt-6.2-astra",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
    });
  });

  it("maps Sol medium to Sonnet medium", () => {
    const current = selection("codex", "gpt-6.1-sol", [
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "default" },
    ]);
    expect(counterpartModelSelection(current, "codex", [claude, codex])).toEqual({
      instanceId: "claudeAgent",
      model: "claude-sonnet-5-5",
      options: [{ id: "effort", value: "medium" }],
    });
  });

  it("maps ultra to max", () => {
    const current = selection("codex", "gpt-6.2-astra", [
      { id: "reasoningEffort", value: "ultra" },
    ]);
    expect(counterpartModelSelection(current, "codex", [claude, codex])?.options).toEqual([
      { id: "effort", value: "max" },
    ]);
  });

  it("defaults a missing effort to high", () => {
    const current = selection("claudeAgent", "claude-opus-5-5");
    expect(counterpartModelSelection(current, "claudeAgent", [claude, codex])?.options).toEqual([
      { id: "reasoningEffort", value: "high" },
    ]);
  });

  it("returns null when the target provider is exhausted", () => {
    const exhausted = makeProvider("codex", "codex", codex.models, {
      usageLimits: {
        checkedAt: "2026-11-18T00:00:00Z",
        windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 100 }],
      },
    });
    const current = selection("claudeAgent", "claude-opus-5-5");
    expect(counterpartModelSelection(current, "claudeAgent", [claude, exhausted])).toBeNull();
  });

  it("returns null when the target model is missing, the family unknown or the driver other", () => {
    const missing = makeProvider("codex", "codex", [plainModel("gpt-6-luna")]);
    expect(
      counterpartModelSelection(selection("claudeAgent", "claude-opus-5-5"), "claudeAgent", [
        claude,
        missing,
      ]),
    ).toBeNull();
    expect(
      counterpartModelSelection(selection("claudeAgent", "claude-mystery"), "claudeAgent", [
        claude,
        codex,
      ]),
    ).toBeNull();
    expect(
      counterpartModelSelection(selection("other", "gpt-6.1-sol"), "opencode", [claude, codex]),
    ).toBeNull();
  });

  it("clamps an unsupported effort down, or up when nothing is below", () => {
    const max = selection("claudeAgent", "claude-sonnet-5-5", [{ id: "effort", value: "max" }]);
    expect(counterpartModelSelection(max, "claudeAgent", [claude, codex])?.options).toEqual([
      { id: "reasoningEffort", value: "high" },
    ]);
    const low = selection("claudeAgent", "claude-sonnet-5-5", [{ id: "effort", value: "low" }]);
    expect(counterpartModelSelection(low, "claudeAgent", [claude, codex])?.options).toEqual([
      { id: "reasoningEffort", value: "medium" },
    ]);
  });

  it("omits options when the target model has no effort descriptor", () => {
    const current = selection("claudeAgent", "claude-haiku-5-5", [{ id: "effort", value: "high" }]);
    expect(counterpartModelSelection(current, "claudeAgent", [claude, codex])).toEqual({
      instanceId: "codex",
      model: "gpt-6-luna",
    });
  });
});

describe("makeRetryBook", () => {
  it("retries a refused switch a minute later until it succeeds", () => {
    const book = makeRetryBook();
    expect(book.nextDueMs()).toBe(Infinity);
    expect(book.fail("t1", 1_000)).toBe(true);
    expect(book.due(30_000)).toEqual([]);
    expect(book.nextDueMs()).toBe(61_000);
    expect(book.due(61_000)).toEqual(["t1"]);
    book.clear("t1");
    expect(book.due(999_999)).toEqual([]);
  });

  it("gives up after an hour of refusals", () => {
    const book = makeRetryBook();
    for (let attempt = 0; attempt < 60; attempt++) expect(book.fail("t1", attempt)).toBe(true);
    expect(book.fail("t1", 60)).toBe(false);
    expect(book.nextDueMs()).toBe(Infinity);
  });
});
