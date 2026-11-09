import {
  isReasoningControl,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerControlSize } from "./ComposerControl";
import {
  type TraitsSelectionInput,
  ULTRATHINK_IN_BODY_NOTE,
  useTraitsSelection,
} from "./TraitsPicker";

type Props = {
  traits: TraitsSelectionInput | null;
  disabled: boolean;
  size: ComposerControlSize;
};

function EffortSlider({ traits: input, disabled, size }: Props & { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(input);
  const descriptor = traits.descriptors.find(isReasoningControl);
  if (!descriptor || traits.modelIsUnavailable) return null;
  const current =
    descriptor.type === "select"
      ? traits.selectValue(descriptor)
      : descriptor.currentValue === true
        ? "on"
        : "off";
  const selectable =
    descriptor.type === "select" ? selectableProviderOptionChoices(descriptor) : [];
  const choices =
    descriptor.type === "select"
      ? descriptor.options.filter((option) => option.id === current || selectable.includes(option))
      : [
          { id: "off", label: "Off" },
          { id: "on", label: "On" },
        ];
  if (choices.length < 2) return null;
  const index = Math.max(
    0,
    choices.findIndex((option) => option.id === current),
  );
  const label = choices[index]!.label;
  const promptLocked =
    traits.ultrathinkInBodyText && descriptor.id === traits.primarySelectDescriptor?.id;
  const unavailable = disabled || promptLocked;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            data-composer-effort-slider
            className={cn(
              "relative flex h-7 shrink-0 items-center px-1 text-muted-foreground hover:text-foreground focus-within:text-foreground",
              size === "xs" ? "w-18" : "w-22",
              unavailable && "opacity-50",
            )}
          />
        }
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 h-1 rounded-full bg-current/20"
        >
          <div
            className="h-full rounded-full bg-current"
            style={{ width: `${(index / (choices.length - 1)) * 100}%` }}
          />
          {choices.map((option, position) => (
            <span
              key={option.id}
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
              style={{ left: `${(position / (choices.length - 1)) * 100}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={choices.length - 1}
          step={1}
          value={index}
          disabled={unavailable}
          aria-label={descriptor.label}
          aria-valuetext={label}
          className="relative h-7 w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
          onChange={(event) => {
            const choice = choices[event.currentTarget.valueAsNumber];
            if (!choice) return;
            if (descriptor.type === "select") traits.changeSelect(descriptor, choice.id);
            else traits.changeBoolean(descriptor.id, choice.id === "on");
          }}
        />
      </TooltipTrigger>
      <TooltipPopup>
        {promptLocked ? ULTRATHINK_IN_BODY_NOTE : `${descriptor.label}: ${label}`}
      </TooltipPopup>
    </Tooltip>
  );
}

export function ForkComposerEffortSlider(props: Props) {
  return props.traits ? <EffortSlider {...props} traits={props.traits} /> : null;
}
