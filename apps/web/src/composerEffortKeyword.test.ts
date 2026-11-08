import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { applyComposerEffortKeyword, matchLeadingEffortKeyword } from "./composerEffortKeyword";

describe("matchLeadingEffortKeyword", () => {
  it.each([
    ["xhigh refactor the parser", "xhigh", 6],
    ["low\tdo it", "low", 4],
    ["max   \n go", "max", 8],
    ["medium x", "medium", 7],
  ])("matches %j", (text, keyword, length) => {
    expect(matchLeadingEffortKeyword(text)).toEqual({ keyword, length });
  });

  it.each([
    ["High level overview"],
    [" high fix it"],
    ["high"],
    ["high   "],
    ["xhighfoo bar"],
    ["highly fix it"],
    ["fix high things"],
    [""],
  ])("does not match %j", (text) => {
    expect(matchLeadingEffortKeyword(text)).toBeNull();
  });
});

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const MODEL = "test-model";

function modelWithEfforts(effortIds: ReadonlyArray<string>): ServerProviderModel {
  const descriptor: ProviderOptionDescriptor = {
    id: "effort",
    label: "Effort",
    type: "select",
    options: effortIds.map((id) => ({ id, label: id })),
  };
  return {
    slug: MODEL,
    name: MODEL,
    isCustom: false,
    capabilities: { optionDescriptors: [descriptor] },
  };
}

function selection(options?: ModelSelection["options"]): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: MODEL,
    ...(options ? { options } : {}),
  };
}

function apply(input: {
  prompt: string;
  modelSelection: ModelSelection;
  offered?: ReadonlyArray<string>;
}) {
  return applyComposerEffortKeyword({
    prompt: input.prompt,
    modelSelection: input.modelSelection,
    promptEffort: "medium",
    provider: PROVIDER,
    model: MODEL,
    models: [modelWithEfforts(input.offered ?? ["low", "medium", "high", "xhigh"])],
    planModeEnabled: true,
  });
}

describe("applyComposerEffortKeyword", () => {
  it("replaces an existing effort option and strips the keyword", () => {
    const result = apply({
      prompt: "xhigh refactor",
      modelSelection: selection([
        { id: "effort", value: "medium" },
        { id: "fastMode", value: true },
      ]),
    });
    expect(result).toEqual({
      prompt: "refactor",
      modelSelection: selection([
        { id: "effort", value: "xhigh" },
        { id: "fastMode", value: true },
      ]),
      promptEffort: "xhigh",
    });
  });

  it("appends an effort option when the selection has none", () => {
    expect(apply({ prompt: "low  quick one", modelSelection: selection() })).toMatchObject({
      prompt: "quick one",
      modelSelection: selection([{ id: "effort", value: "low" }]),
      promptEffort: "low",
    });
  });

  it("leaves everything unchanged when the model does not offer the level", () => {
    const modelSelection = selection([{ id: "effort", value: "medium" }]);
    expect(apply({ prompt: "max do it", modelSelection })).toEqual({
      prompt: "max do it",
      modelSelection,
      promptEffort: "medium",
    });
  });
});
