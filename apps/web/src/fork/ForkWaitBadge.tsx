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
type BadgeProps = {
  threadId: string;
  className?: string;
  /** "pie": a dot that fills as the wait runs out, standing in for the sidebar's status dot. */
  variant?: "text" | "pie";
};

// The pie replaces upstream's status dot right after it, so the row keeps one dot.
const PIE_CSS = "[data-fork-wait-pie] + [role=img] > .rounded-full:first-child { display: none; }";

export function ForkWaitBadge(props: BadgeProps) {
  return (
    <RenderErrorBoundary fallback={null}>
      <WaitBadge {...props} />
    </RenderErrorBoundary>
  );
}

function WaitBadge(props: BadgeProps) {
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
  if (props.variant === "pie") {
    if (deadline === null) return null;
    const total = deadline - Date.parse(wait.startedAt);
    const filled =
      overtime || total <= 0 ? 1 : Math.min(1, (now - Date.parse(wait.startedAt)) / total);
    return (
      <>
        <style>{PIE_CSS}</style>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                data-fork-wait-pie
                role="img"
                aria-label={`${title}, ${text}`}
                className={cn(
                  "inline-block size-2 shrink-0 rounded-full border border-current text-sidebar-muted-foreground",
                  overtime && "text-warning",
                )}
                style={{
                  background: `conic-gradient(currentColor ${filled}turn, transparent 0)`,
                }}
              />
            }
          />
          <TooltipPopup side="top">
            {title} ({overtime ? `${text} over` : `${text} left`})
          </TooltipPopup>
        </Tooltip>
      </>
    );
  }
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
