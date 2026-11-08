import type { ModelSelection, ServerProviderModel, ProviderDriverKind } from "@t3tools/contracts";

import { getProviderModelCapabilities } from "./providerModels";

export const COMPOSER_EFFORT_KEYWORDS = ["low", "medium", "high", "xhigh", "max"] as const;

const LEADING_KEYWORD = new RegExp(`^(${COMPOSER_EFFORT_KEYWORDS.join("|")})(\\s+)(?=\\S)`);

/** `length` covers the keyword and the whitespace after it. */
export function matchLeadingEffortKeyword(
  text: string,
): { keyword: string; length: number } | null {
  const match = LEADING_KEYWORD.exec(text);
  return match?.[1] && match[2] ? { keyword: match[1], length: match[0].length } : null;
}

interface EffortKeywordTurn {
  prompt: string;
  modelSelection: ModelSelection;
  promptEffort: string | null;
}

/** Applies a leading effort keyword to this turn only, when the model offers that level. */
export function applyComposerEffortKeyword(
  input: EffortKeywordTurn & {
    provider: ProviderDriverKind;
    model: string;
    models: ReadonlyArray<ServerProviderModel>;
    planModeEnabled: boolean;
  },
): EffortKeywordTurn {
  const { prompt, modelSelection, promptEffort } = input;
  const match = matchLeadingEffortKeyword(prompt);
  if (!match) return { prompt, modelSelection, promptEffort };
  const caps = getProviderModelCapabilities(
    input.models,
    input.model,
    input.provider,
    input.planModeEnabled,
  );
  const offered = caps.optionDescriptors?.some(
    (descriptor) =>
      descriptor.type === "select" &&
      descriptor.id === "effort" &&
      descriptor.options.some((option) => option.id === match.keyword),
  );
  if (!offered) return { prompt, modelSelection, promptEffort };
  const effort = { id: "effort", value: match.keyword };
  const options = modelSelection.options ?? [];
  return {
    prompt: prompt.slice(match.length),
    modelSelection: {
      ...modelSelection,
      options: options.some((option) => option.id === "effort")
        ? options.map((option) => (option.id === "effort" ? effort : option))
        : [...options, effort],
    },
    promptEffort: match.keyword,
  };
}
