import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { deriveEffectiveComposerModelState, useComposerDraftStore } from "./composerDraftStore";
import { pinComposerEffortDial } from "./composerEffortKeywordDial";

const INSTANCE = ProviderInstanceId.make("claudeAgent");
const DRIVER = ProviderDriverKind.make("claudeAgent");
const MODEL = "claude-opus-5-5";
const threadRef = scopeThreadRef(EnvironmentId.make("environment-local"), ThreadId.make("t1"));

function effectiveEffort(threadEffort: string) {
  return deriveEffectiveComposerModelState({
    draft: useComposerDraftStore.getState().getComposerDraft(threadRef),
    providers: [],
    selectedProvider: DRIVER,
    selectedInstanceId: INSTANCE,
    threadModelSelection: createModelSelection(INSTANCE, MODEL, [
      { id: "effort", value: threadEffort },
    ]),
    projectModelSelection: null,
    settings: DEFAULT_UNIFIED_SETTINGS,
  }).modelOptions?.[INSTANCE]?.find((option) => option.id === "effort")?.value;
}

describe("pinComposerEffortDial", () => {
  it("keeps the dial's effort after a keyword turn updates the thread selection", () => {
    // Before pinning, a default dial reads the thread's stored (keyword) effort.
    expect(effectiveEffort("xhigh")).toBe("xhigh");
    pinComposerEffortDial(threadRef, createModelSelection(INSTANCE, MODEL), "high");
    expect(effectiveEffort("xhigh")).toBe("high");
  });

  it("does nothing without a dial effort", () => {
    const before = useComposerDraftStore.getState().draftsByThreadKey;
    pinComposerEffortDial(
      scopeThreadRef(EnvironmentId.make("environment-local"), ThreadId.make("t2")),
      createModelSelection(INSTANCE, MODEL),
      null,
    );
    expect(useComposerDraftStore.getState().draftsByThreadKey).toBe(before);
  });
});
