import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ForkComposerEffortSlider } from "./ForkComposerEffortSlider";
import { readPromptUltrathink } from "./TraitsPicker";

const effort: ProviderOptionDescriptor = {
  id: "thought_level",
  label: "Thinking",
  role: "reasoning",
  type: "select",
  currentValue: "medium",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
};

function Slider(props: {
  descriptors?: ReadonlyArray<ProviderOptionDescriptor>;
  disabled?: boolean;
  prompt?: string;
}) {
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([
    { id: "mode", value: "plan" },
  ]);
  const [prompt, setPrompt] = useState(props.prompt ?? "");
  return (
    <>
      <ForkComposerEffortSlider
        disabled={props.disabled ?? false}
        size="sm"
        traits={{
          provider: ProviderDriverKind.make("acpRegistry"),
          instanceId: ProviderInstanceId.make("slider-test"),
          model: "test-model",
          models: [
            {
              slug: "test-model",
              name: "Test model",
              isCustom: false,
              capabilities: createModelCapabilities({
                optionDescriptors: props.descriptors ?? [
                  {
                    id: "mode",
                    label: "Mode",
                    type: "select",
                    currentValue: "plan",
                    options: [
                      { id: "plan", label: "Plan" },
                      { id: "code", label: "Code" },
                    ],
                  },
                  effort,
                ],
              }),
            },
          ],
          modelOptions: options,
          onModelOptionsChange: (next) => setOptions(next ?? []),
          planModeEnabled: true,
          promptUltrathink: readPromptUltrathink(prompt),
          onPromptEdit: setPrompt,
        }}
      />
      <output aria-label="Saved options">{JSON.stringify(options)}</output>
      <output aria-label="Prompt">{prompt}</output>
    </>
  );
}

it("changes the reasoning level directly and preserves other model options", async () => {
  // This control has no routing behavior.
  await using screen = await render(<Slider />, { router: false });
  const slider = screen.getByRole("slider", { name: "Thinking" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium");
  await userEvent.tab();
  await expect.element(slider).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  expect(
    JSON.parse(screen.getByRole("status", { name: "Saved options" }).element().textContent!),
  ).toEqual([
    { id: "mode", value: "plan" },
    { id: "thought_level", value: "high" },
  ]);
  await userEvent.keyboard("{Home}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await screen.rerender(<Slider disabled />);
  await expect.element(slider).toBeDisabled();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await screen.rerender(<Slider descriptors={[]} />);
  await expect.element(screen.getByRole("slider")).not.toBeInTheDocument();
});

it("handles boolean reasoning and switches to a model's own effort scale", async () => {
  const thinking: ProviderOptionDescriptor = {
    id: "thinking",
    type: "boolean",
    label: "Thinking",
    currentValue: false,
  };
  // This control has no routing behavior.
  await using screen = await render(<Slider descriptors={[thinking]} />, { router: false });
  const slider = screen.getByRole("slider");
  await userEvent.tab();
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "On");
  await screen.rerender(
    <Slider
      descriptors={[
        {
          ...effort,
          id: "reasoningEffort",
          options: [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra high" },
            { id: "max", label: "Max" },
          ],
        },
      ]}
    />,
  );
  await expect.element(slider).toHaveAttribute("max", "3");
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Max");
});

it("keeps prompt-controlled effort accurate and lets a prefix be cleared", async () => {
  const descriptor: ProviderOptionDescriptor = {
    ...effort,
    id: "effort",
    promptInjectedValues: ["ultrathink"],
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "ultrathink", label: "Ultrathink" },
    ],
  };
  // This control has no routing behavior.
  await using screen = await render(
    <Slider descriptors={[descriptor]} prompt="Ultrathink: fix this" />,
    { router: false },
  );
  const slider = screen.getByRole("slider");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Ultrathink");
  await userEvent.tab();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await expect
    .element(screen.getByRole("status", { name: "Prompt" }))
    .toHaveTextContent("fix this");
  await expect.element(slider).toHaveAttribute("max", "2");
  await screen.rerender(
    <Slider key="body" descriptors={[descriptor]} prompt="Please ultrathink about this" />,
  );
  await expect.element(screen.getByRole("slider")).toBeDisabled();
});
