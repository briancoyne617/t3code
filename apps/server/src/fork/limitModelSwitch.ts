import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type ServerProvider,
  type ThreadId,
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
  // Chats touched by recent events; checked on the next sweep. Upstream's recovery query
  // drops a chat once it arms a retry, so the fork watches events instead of that query.
  const pending = new Set<ThreadId>();
  const due = DueHint.make();
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
      if (!affectsLimitSwitch(event)) return Effect.void;
      pending.add(event.threadId);
      return due.invalidate;
    }),
  );
  // Chats already limited when the server started.
  const seed = yield* projections
    .getLimitRecoveryCandidates({ now: yield* DateTime.now, autoResume: true, snooze: true })
    .pipe(Effect.orElseSucceed(() => []));
  for (const thread of seed) pending.add(thread.id);

  const switchThread = Effect.fn("LimitModelSwitch.switchThread")(function* (threadId: ThreadId) {
    const shell = yield* projections.getThreadShell(threadId);
    const runId = shell?.latestRunId;
    if (
      !shell ||
      !runId ||
      shell.status !== "failed" ||
      shell.lastErrorClass !== "usage_limit" ||
      shell.archivedAt !== null ||
      shell.settledOverride === "settled" ||
      shell.pendingRuntimeRequest !== null
    )
      return;
    const key = `${threadId}:${runId}`;
    if (handled.has(key)) return;
    handled.add(key);
    const providers = yield* registry.getProviders;
    const current = shell.modelSelection;
    const sourceDriver =
      providers.find((provider) => provider.instanceId === current.instanceId)?.driver ?? "";
    const next = counterpartModelSelection(current, sourceDriver, providers);
    if (next === null) {
      yield* Effect.logDebug("fork.limit-model-switch.no-counterpart", {
        threadId,
        from: current.model,
      });
      return;
    }
    const id = `fork-limit-switch:${threadId}:${runId}`;
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(id),
      messageId: MessageId.make(id),
      threadId,
      text: `Usage limit reached on ${current.model}; switched to ${next.model}. Continue where you left off.`,
      attachments: [],
      modelSelection: next,
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "server",
    });
    yield* Effect.logInfo("fork.limit-model-switch.switched", {
      threadId,
      from: current.model,
      to: next.model,
    });
  });

  return Effect.fn("LimitModelSwitch.sweep")(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (yield* due.isIdle(nowMs)) return;
    const readVersion = yield* due.version;
    const batch = [...pending];
    pending.clear();
    for (const threadId of batch) {
      yield* switchThread(threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("fork.limit-model-switch.dispatch-failed", { threadId, cause }),
        ),
      );
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
