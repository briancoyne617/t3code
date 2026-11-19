import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as DueHint from "../scheduling/DueHint.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const CLAUDE_DRIVER = "claudeAgent";
const CODEX_DRIVER = "codex";
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
const EFFORT_OPTION_IDS = ["effort", "reasoningEffort"] as const;

const CLAUDE_TO_CODEX: ReadonlyArray<readonly [string, string]> = [
  ["fable", "gpt-6.2-astra"],
  ["opus", "gpt-6.2-astra"],
  ["sonnet", "gpt-6.2-sol"],
  ["haiku", "gpt-6-luna"],
];
const CODEX_TO_CLAUDE: ReadonlyArray<readonly [string, string]> = [
  ["astra", "claude-opus-5-5"],
  ["sol", "claude-sonnet-5-5"],
  ["terra", "claude-sonnet-5-5"],
  ["luna", "claude-haiku-5-5"],
];

const isExhausted = (provider: ServerProvider) =>
  provider.usageLimits?.windows.some((window) => window.usedPercent >= 100) ?? false;

const familyTarget = (table: ReadonlyArray<readonly [string, string]>, model: string) => {
  const lower = model.toLowerCase();
  return table.find(([family]) => lower.includes(family))?.[1] ?? null;
};

const sourceEffort = (current: ModelSelection): string => {
  const raw = current.options?.find((option) =>
    (EFFORT_OPTION_IDS as ReadonlyArray<string>).includes(option.id),
  )?.value;
  if (typeof raw !== "string") return "high";
  if (raw === "ultra" || raw === "ultrathink" || raw === "ultracode") return "max";
  return raw;
};

const clampEffort = (wanted: string, supported: ReadonlyArray<string>): string | null => {
  if (supported.includes(wanted)) return wanted;
  const rank = (value: string) => EFFORT_ORDER.indexOf(value as (typeof EFFORT_ORDER)[number]);
  const ranked = supported
    .filter((value) => rank(value) >= 0)
    .toSorted((a, b) => rank(a) - rank(b));
  const wantedRank = rank(wanted);
  const below = ranked.filter((value) => rank(value) < wantedRank);
  return below.at(-1) ?? ranked[0] ?? null;
};

export function counterpartModelSelection(
  current: ModelSelection,
  sourceDriver: string,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const toCodex = sourceDriver === CLAUDE_DRIVER;
  if (!toCodex && sourceDriver !== CODEX_DRIVER) return null;
  const targetModel = familyTarget(toCodex ? CLAUDE_TO_CODEX : CODEX_TO_CLAUDE, current.model);
  if (targetModel === null) return null;
  const targets = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.driver === (toCodex ? CODEX_DRIVER : CLAUDE_DRIVER) &&
      !isExhausted(provider),
  );
  const target = targets.find((provider) => provider.instanceId === CODEX_DRIVER) ?? targets[0];
  const model = target?.models.find((candidate) => candidate.slug === targetModel);
  if (target === undefined || model === undefined) return null;
  const effortId = toCodex ? "reasoningEffort" : "effort";
  const descriptor = model.capabilities?.optionDescriptors?.find(
    (option) => option.id === effortId && option.type === "select",
  );
  const effort =
    descriptor?.type === "select"
      ? clampEffort(
          sourceEffort(current),
          descriptor.options.map((option) => option.id),
        )
      : null;
  return {
    instanceId: target.instanceId,
    model: targetModel,
    ...(effort === null ? {} : { options: [{ id: effortId, value: effort }] }),
  };
}

const affectsLimitSwitch = (event: OrchestrationV2DomainEvent) =>
  event.type.startsWith("thread.") ||
  event.type === "run.created" ||
  event.type === "run.updated" ||
  event.type === "runtime-request.updated" ||
  (event.type === "turn-item.updated" && event.payload.type === "error");

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const handled = new Set<string>();
  const due = DueHint.make();
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
      affectsLimitSwitch(event) ? due.invalidate : Effect.void,
    ),
  );
  return Effect.fn("LimitModelSwitch.sweep")(function* () {
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    if (yield* due.isIdle(nowMs)) return;
    const readVersion = yield* due.version;
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: true,
      snooze: false,
    });
    for (const thread of candidates) {
      const runId = thread.latestRunId;
      if (
        thread.status !== "failed" ||
        thread.lastErrorClass !== "usage_limit" ||
        !runId ||
        thread.archivedAt !== null ||
        thread.settledOverride === "settled" ||
        thread.pendingRuntimeRequest !== null
      )
        continue;
      const key = `${thread.id}:${runId}`;
      if (handled.has(key)) continue;
      yield* Effect.gen(function* () {
        const shell = yield* projections.getThreadShell(thread.id);
        if (shell === null) return;
        const providers = yield* registry.getProviders;
        const current = shell.modelSelection;
        const sourceDriver =
          providers.find((provider) => provider.instanceId === current.instanceId)?.driver ?? "";
        const next = counterpartModelSelection(current, sourceDriver, providers);
        if (next === null) {
          yield* Effect.logDebug("fork.limit-model-switch.no-counterpart", {
            threadId: thread.id,
            from: current.model,
          });
          return;
        }
        const id = `fork-limit-switch:${thread.id}:${runId}`;
        yield* threads.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(id),
          messageId: MessageId.make(id),
          threadId: thread.id,
          text: `Usage limit reached on ${current.model}; switched to ${next.model}. Continue where you left off.`,
          attachments: [],
          modelSelection: next,
          usageLimitContinuationOfRunId: runId,
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "server",
        });
        yield* Effect.logInfo("fork.limit-model-switch.switched", {
          threadId: thread.id,
          from: current.model,
          to: next.model,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("fork.limit-model-switch.dispatch-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
      handled.add(key);
    }
    yield* due.record(readVersion, Infinity, nowMs);
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("fork-limit-model-switch", sweep());
  }),
);
