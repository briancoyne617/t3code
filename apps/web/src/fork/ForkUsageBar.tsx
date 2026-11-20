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
import { ClaudeAI, type Icon, OpenAI } from "../components/Icons";
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

const DEFAULT_WINDOW_MINS: Partial<Record<ServerProviderUsageWindow["kind"], number>> = {
  session: 5 * 60,
  weekly: 7 * 24 * 60,
  monthly: 30 * 24 * 60,
};

/** Share of the window still to run before it resets (1 just after a reset, 0 at the reset). */
export function windowTimeLeftFraction(
  window: Pick<ServerProviderUsageWindow, "kind" | "resetsAt" | "windowDurationMins">,
  now: number,
): number | null {
  const mins = window.windowDurationMins || DEFAULT_WINDOW_MINS[window.kind];
  if (!window.resetsAt || !mins) return null;
  const left = (Date.parse(window.resetsAt) - now) / (mins * 60_000);
  return Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : null;
}

/** A tiny clock face: the gray wedge is the time left in the window and shrinks toward the reset. */
function ResetClock(props: { fraction: number }) {
  const angle = props.fraction * 2 * Math.PI;
  const x = 8 + 6 * Math.sin(angle);
  const y = 8 - 6 * Math.cos(angle);
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 shrink-0 self-center">
      <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {props.fraction >= 0.999 ? (
        <circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.45" />
      ) : props.fraction > 0.001 ? (
        <path
          d={`M8 8 L8 2 A6 6 0 ${props.fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`}
          fill="currentColor"
          opacity="0.45"
        />
      ) : null}
    </svg>
  );
}

const PROVIDER_LOGO: Partial<Record<string, Icon>> = { codex: OpenAI, claudeAgent: ClaudeAI };

type UsageProvider = Pick<ServerProvider, "enabled" | "driver" | "usageLimits">;

/** Hides model-specific weekly limits (e.g. "Weekly · Fable"); the overall weekly limit stays. */
const shownWindows = (provider: UsageProvider) =>
  (provider.usageLimits?.windows ?? []).filter(
    (window) => window.kind !== "weekly" || window.label === "Weekly",
  );

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

/** Two connections of one provider (e.g. two Claude accounts) get a 1-based tag so their rows read apart. */
export function usageRowTags<T extends Pick<ServerProvider, "driver" | "instanceId">>(
  rows: ReadonlyArray<T>,
): ReadonlyMap<string, number> {
  const byDriver = new Map<string, T[]>();
  for (const row of rows) byDriver.set(row.driver, [...(byDriver.get(row.driver) ?? []), row]);
  const tags = new Map<string, number>();
  for (const group of byDriver.values()) {
    if (group.length > 1) group.forEach((row, index) => tags.set(row.instanceId, index + 1));
  }
  return tags;
}

/** Header usage per provider: logo, then % used and a reset clock for the 5-hour and weekly windows. */
export function ForkUsageBar(props: { environmentId?: EnvironmentId }) {
  const providers =
    useAtomValue(
      props.environmentId === undefined
        ? primaryServerProvidersAtom
        : serverEnvironment.providersValueAtom(props.environmentId),
    ) ?? [];
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const rows = visibleUsageRows(providers);
  const tags = usageRowTags(rows);
  if (rows.length === 0) return null;
  return (
    <div
      aria-label="Provider usage limits"
      className="hidden shrink-0 items-center gap-x-3 whitespace-nowrap text-xs leading-tight tabular-nums sm:flex"
    >
      {rows.map((provider) => {
        const Logo = PROVIDER_LOGO[provider.driver];
        const name = PROVIDER_DISPLAY_NAMES[provider.driver];
        const windows = shownWindows(provider);
        const stale = provider.usageLimits?.unavailable !== undefined;
        const tag = tags.get(provider.instanceId);
        return (
          <Tooltip key={provider.instanceId}>
            <TooltipTrigger
              render={
                <div
                  className="flex shrink-0 items-center gap-x-1"
                  aria-label={tag === undefined ? name : `${name} ${tag}`}
                />
              }
            >
              {Logo ? (
                <Logo
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0", stale && "opacity-50")}
                />
              ) : (
                <span className="font-medium">{name}</span>
              )}
              {tag === undefined ? null : (
                <span
                  aria-hidden="true"
                  className="text-3xs font-medium leading-none text-muted-foreground"
                >
                  {tag}
                </span>
              )}
              {windows.length === 0 ? <span className="text-muted-foreground">–</span> : null}
              {windows.map((window) => {
                const fraction = windowTimeLeftFraction(window, now);
                return (
                  <span
                    key={window.id}
                    className={cn("inline-flex items-center gap-0.5", tone(window.usedPercent))}
                    aria-label={`${window.label}: ${Math.round(window.usedPercent)}% used`}
                  >
                    {Math.round(window.usedPercent)}%
                    {fraction === null ? null : <ResetClock fraction={fraction} />}
                  </span>
                );
              })}
            </TooltipTrigger>
            <TooltipPopup>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{provider.displayName ?? name}</span>
                {windows.map((window) => (
                  <span key={window.id}>
                    {`${window.label}: ${Math.round(window.usedPercent)}% used`}
                    {window.resetsAt ? `, resets in ${timeLeft(window.resetsAt, now)}` : ""}
                  </span>
                ))}
                {provider.usageLimits?.unavailable?.message ? (
                  <span className="text-warning">
                    {`Last reported · ${provider.usageLimits.unavailable.message}`}
                  </span>
                ) : null}
                {provider.usageLimits?.checkedAt ? (
                  <span className="text-muted-foreground">
                    {`Checked ${new Date(provider.usageLimits.checkedAt).toLocaleString()}`}
                  </span>
                ) : null}
              </div>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
