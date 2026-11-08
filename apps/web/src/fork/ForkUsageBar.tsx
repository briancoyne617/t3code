import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";

import { primaryServerProvidersAtom } from "../state/server";

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

/** Always-visible usage per provider: % used of each window and the time until it resets. */
export function ForkUsageBar() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const now = Date.now();
  const rows = providers.filter(
    (provider) => provider.enabled && (provider.usageLimits?.windows.length ?? 0) > 0,
  );
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1 text-[11px] leading-tight tabular-nums">
      {rows.map((provider) => (
        <div key={provider.instanceId} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{provider.displayName ?? provider.instanceId}</span>
          {provider.usageLimits?.windows.map((window) => (
            <span
              key={window.id}
              className={tone(window.usedPercent)}
              title={`${window.label}: ${Math.round(window.usedPercent)}% used${window.resetsAt ? `, resets ${new Date(window.resetsAt).toLocaleString()}` : ""}`}
            >
              {windowLabel(window)} {Math.round(window.usedPercent)}%
              {window.resetsAt ? ` · ${timeLeft(window.resetsAt, now)}` : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
