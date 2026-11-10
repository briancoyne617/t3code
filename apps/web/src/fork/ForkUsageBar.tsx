import { useAtomValue } from "@effect/atom-react";
import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";

import { useNowMinute } from "../hooks/useNowMinute";
import { primaryServerProvidersAtom, serverEnvironment } from "../state/server";
import { cn } from "../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

function timeLeft(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return "";
  const hours = (Date.parse(resetsAt) - now) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return "resetting";
  return hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
}

function tone(percent: number): string {
  if (percent >= 90) return "text-destructive";
  if (percent >= 70) return "text-warning";
  return "text-muted-foreground";
}

function windowLabel(window: ServerProviderUsageWindow): string {
  if (window.kind === "session") return "5h";
  if (window.kind === "weekly") return "wk";
  if (window.kind === "monthly") return "mo";
  return window.label;
}

type UsageProvider = Pick<ServerProvider, "enabled" | "driver" | "usageLimits">;

const hasWindows = (provider: UsageProvider) => (provider.usageLimits?.windows.length ?? 0) > 0;

/** Rows with numbers; a Codex/Claude connection without them only shows when no other of its kind has them. */
export function visibleUsageRows<T extends UsageProvider>(providers: ReadonlyArray<T>): T[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      (hasWindows(provider) ||
        ((provider.driver === "codex" || provider.driver === "claudeAgent") &&
          !providers.some(
            (other) => other.enabled && other.driver === provider.driver && hasWindows(other),
          ))),
  );
}

/** Always-visible usage per provider: % used of each window and the time until it resets. */
export function ForkUsageBar(props: { environmentId?: EnvironmentId; layout?: "header" } = {}) {
  const providers =
    useAtomValue(
      props.environmentId === undefined
        ? primaryServerProvidersAtom
        : serverEnvironment.providersValueAtom(props.environmentId),
    ) ?? [];
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const rows = visibleUsageRows(providers);
  if (rows.length === 0) return null;
  return (
    <div
      aria-label="Provider usage limits"
      className={cn(
        "flex flex-col gap-0.5 text-2xs leading-tight tabular-nums",
        props.layout === "header" ? "hidden max-w-[50%] shrink-0 sm:flex" : "px-3 pb-1",
      )}
    >
      {rows.map((provider) => (
        <Tooltip key={provider.instanceId}>
          <TooltipTrigger render={<div className="flex flex-wrap items-baseline gap-x-2" />}>
            <span className="font-medium">{PROVIDER_DISPLAY_NAMES[provider.driver]}</span>
            {(provider.usageLimits?.windows.length ?? 0) === 0 ? (
              <span className="text-muted-foreground">limits unavailable</span>
            ) : null}
            {provider.usageLimits?.windows.map((window) => (
              <span
                key={window.id}
                className={tone(window.usedPercent)}
                aria-label={`${window.label}: ${Math.round(window.usedPercent)}% used`}
              >
                {windowLabel(window)} {Math.round(window.usedPercent)}%
                {window.resetsAt ? ` · ${timeLeft(window.resetsAt, now)}` : ""}
              </span>
            ))}
            {provider.usageLimits?.unavailable && provider.usageLimits.windows.length > 0 ? (
              <span className="text-warning">last reported</span>
            ) : null}
          </TooltipTrigger>
          <TooltipPopup>
            {[
              provider.displayName ?? provider.instanceId,
              provider.usageLimits?.unavailable?.message,
              provider.usageLimits?.checkedAt
                ? `Checked ${new Date(provider.usageLimits.checkedAt).toLocaleString()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
