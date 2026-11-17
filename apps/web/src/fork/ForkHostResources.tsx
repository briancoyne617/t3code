import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatBytes } from "../lib/formatBytes";
import { cn } from "../lib/utils";
import { useEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";

function ResourceMeter({ label, percent }: { label: string; percent: number | null }) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr_1.75rem] items-center gap-1">
      <span className="font-medium">{label}</span>
      <div
        role={percent === null ? undefined : "meter"}
        aria-label={`${label} usage${percent === null ? " unavailable" : ""}`}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        {percent !== null ? (
          <div
            className={cn(
              "h-full rounded-full",
              percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${percent}%` }}
          />
        ) : null}
      </div>
      <span className="text-right text-muted-foreground">
        {percent === null ? "n/a" : `${percent}%`}
      </span>
    </div>
  );
}

export function ForkHostResources({ environmentId }: { environmentId: EnvironmentId }) {
  const desktopWidth = useMediaQuery("sm");
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const environment = useEnvironment(environmentId);
  const query = useEnvironmentQuery(
    desktopWidth && canRead ? serverEnvironment.hostResources({ environmentId, input: {} }) : null,
  );
  useLiveRefresh(query.refresh, {
    enabled: desktopWidth && canRead,
    key: `fork-host-resources:${environmentId}`,
    intervalMs: 10_000,
  });
  const sample = query.error === null ? query.data : null;
  const cpu = sample?.cpuUtilization == null ? null : Math.round(sample.cpuUtilization * 100);
  const usedMemory = sample ? sample.totalMemoryBytes - sample.availableMemoryBytes : null;
  const memory =
    sample && sample.totalMemoryBytes > 0 && usedMemory !== null
      ? Math.round((usedMemory / sample.totalMemoryBytes) * 100)
      : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label="Host CPU and memory usage"
            className="me-2 hidden w-28 shrink-0 flex-col gap-0.5 text-2xs leading-tight tabular-nums sm:flex"
          />
        }
      >
        <ResourceMeter label="CPU" percent={cpu} />
        <ResourceMeter label="RAM" percent={memory} />
      </TooltipTrigger>
      <TooltipPopup>
        <div className="font-medium">{environment?.label ?? "Environment"} host usage</div>
        {sample ? (
          <>
            <div>CPU: {cpu === null ? "unavailable" : `${cpu}%`}</div>
            <div>
              Memory: {formatBytes(usedMemory ?? 0)} / {formatBytes(sample.totalMemoryBytes)}
            </div>
            <div>Updated {new Date(sample.sampledAt).toLocaleTimeString()}</div>
          </>
        ) : (
          <div>
            {!canRead
              ? "This connection cannot read host usage."
              : (query.error ?? "Waiting for a host sample.")}
          </div>
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
