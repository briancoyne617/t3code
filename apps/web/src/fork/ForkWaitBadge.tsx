import { HourglassIcon, TimerIcon } from "lucide-react";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { useWaits } from "./waitStore";

function clock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Live countdown for a chat waiting on a timer; overtime once it passes; counts up when there is no limit. */
export function ForkWaitBadge(props: { threadId: string; className?: string }) {
  return (
    <RenderErrorBoundary fallback={null}>
      <WaitBadge {...props} />
    </RenderErrorBoundary>
  );
}

function WaitBadge(props: { threadId: string; className?: string }) {
  const { waits, now } = useWaits();
  const wait = waits.get(props.threadId);
  if (!wait) return null;
  const deadline = wait.deadline ? Date.parse(wait.deadline) : null;
  const left = deadline === null ? null : deadline - now;
  const overtime = left !== null && left <= 0;
  const text =
    left === null
      ? clock(now - Date.parse(wait.startedAt))
      : `${overtime ? "+" : ""}${clock(left)}`;
  const title =
    deadline === null
      ? `Waiting on ${wait.kind}, no time limit`
      : `Waiting on ${wait.kind} until ${new Date(deadline).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const Icon = left === null ? HourglassIcon : TimerIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-2xs tabular-nums text-muted-foreground [&_svg]:size-3",
              overtime && "text-warning",
              props.className,
            )}
          />
        }
      >
        <Icon aria-hidden="true" />
        {text}
      </TooltipTrigger>
      <TooltipPopup side="top">{title}</TooltipPopup>
    </Tooltip>
  );
}
