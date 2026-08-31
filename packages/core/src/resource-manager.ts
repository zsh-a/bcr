import { Context, Effect, Layer } from "effect";
import { TaskFailed } from "./errors";
import type { ResourceRequirements, RuntimeKind } from "./schema";

export interface ResourceCapacity {
  readonly memoryMB: number;
  readonly threads: number;
  readonly gpuSlots: number;
}

export interface ResourceRequest extends ResourceCapacity {}

export interface ResourceQueueEntry {
  readonly taskId: string;
  readonly request: ResourceRequest;
}

export interface ResourceSnapshot {
  readonly capacity: ResourceCapacity;
  readonly used: ResourceRequest;
  readonly queued: ReadonlyArray<ResourceQueueEntry>;
}

export interface ResourceLease {
  readonly request: ResourceRequest;
  readonly release: Effect.Effect<void>;
}

export interface ResourceManager {
  readonly acquire: (
    taskId: string,
    requirements: ResourceRequirements | undefined,
    runtime: RuntimeKind,
  ) => Effect.Effect<ResourceLease, TaskFailed>;
  readonly snapshot: Effect.Effect<ResourceSnapshot>;
}

export class ResourceManagerTag extends Context.Tag("bcr/ResourceManager")<
  ResourceManagerTag,
  ResourceManager
>() {}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function requestOf(
  taskId: string,
  requirements: ResourceRequirements | undefined,
  runtime: RuntimeKind,
): Effect.Effect<ResourceRequest, TaskFailed> {
  const request: ResourceRequest = {
    memoryMB: requirements?.memoryMB ?? 0,
    threads: requirements?.threads ?? 1,
    gpuSlots: requirements?.gpu === true || runtime === "webgpu" ? 1 : 0,
  };
  if (
    !finiteNonNegative(request.memoryMB) ||
    !finiteNonNegative(request.threads) ||
    !Number.isInteger(request.threads)
  ) {
    return Effect.fail(
      new TaskFailed({ taskId, message: "resource requirements must be finite and non-negative" }),
    );
  }
  return Effect.succeed(request);
}

/** 浏览器默认预算：给 UI 留一个逻辑核，并只使用设备内存估算的 75%。 */
export function defaultResourceCapacity(): ResourceCapacity {
  const browser =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { readonly deviceMemory?: number });
  const hardwareConcurrency = browser?.hardwareConcurrency ?? 2;
  const deviceMemoryGB = browser?.deviceMemory ?? 4;
  return {
    memoryMB: Math.max(512, Math.floor(deviceMemoryGB * 1024 * 0.75)),
    threads: Math.max(1, hardwareConcurrency - 1),
    gpuSlots: 1,
  };
}

type Waiting = {
  readonly taskId: string;
  readonly request: ResourceRequest;
  readonly resume: (effect: Effect.Effect<ResourceLease, TaskFailed>) => void;
  cancelled: boolean;
};

/**
 * 多维资源闸门。等待队列严格 FIFO，避免大任务被后来的小任务持续插队。
 * release 幂等；排队 Effect 被中断时会从队列移除并触发下一轮分发。
 */
export function resourceManagerLive(
  capacity: ResourceCapacity = defaultResourceCapacity(),
): Layer.Layer<ResourceManagerTag> {
  const normalized: ResourceCapacity = {
    memoryMB: Math.max(0, capacity.memoryMB),
    threads: Math.max(1, Math.floor(capacity.threads)),
    gpuSlots: Math.max(0, Math.floor(capacity.gpuSlots)),
  };

  return Layer.sync(ResourceManagerTag, () => {
    const used = { memoryMB: 0, threads: 0, gpuSlots: 0 };
    const waiting: Waiting[] = [];

    const fits = (request: ResourceRequest): boolean =>
      used.memoryMB + request.memoryMB <= normalized.memoryMB &&
      used.threads + request.threads <= normalized.threads &&
      used.gpuSlots + request.gpuSlots <= normalized.gpuSlots;

    const exceedsCapacity = (request: ResourceRequest): boolean =>
      request.memoryMB > normalized.memoryMB ||
      request.threads > normalized.threads ||
      request.gpuSlots > normalized.gpuSlots;

    const releaseRequest = (request: ResourceRequest): void => {
      used.memoryMB = Math.max(0, used.memoryMB - request.memoryMB);
      used.threads = Math.max(0, used.threads - request.threads);
      used.gpuSlots = Math.max(0, used.gpuSlots - request.gpuSlots);
    };

    const makeLease = (request: ResourceRequest): ResourceLease => {
      let released = false;
      return {
        request,
        release: Effect.sync(() => {
          if (released) return;
          released = true;
          releaseRequest(request);
          drain();
        }),
      };
    };

    const reserve = (request: ResourceRequest): void => {
      used.memoryMB += request.memoryMB;
      used.threads += request.threads;
      used.gpuSlots += request.gpuSlots;
    };

    function drain(): void {
      while (waiting.length > 0) {
        const next = waiting[0] as Waiting;
        if (next.cancelled) {
          waiting.shift();
          continue;
        }
        if (!fits(next.request)) return;
        waiting.shift();
        reserve(next.request);
        next.resume(Effect.succeed(makeLease(next.request)));
      }
    }

    const acquire: ResourceManager["acquire"] = (taskId, requirements, runtime) =>
      Effect.flatMap(requestOf(taskId, requirements, runtime), (request) => {
        if (exceedsCapacity(request)) {
          return Effect.fail(
            new TaskFailed({
              taskId,
              message: `resource request exceeds capacity: requested ${request.threads} threads, ${request.memoryMB} MB, ${request.gpuSlots} GPU; capacity ${normalized.threads} threads, ${normalized.memoryMB} MB, ${normalized.gpuSlots} GPU`,
            }),
          );
        }
        return Effect.async<ResourceLease, TaskFailed>((resume) => {
          const entry: Waiting = { taskId, request, resume, cancelled: false };
          waiting.push(entry);
          drain();
          return Effect.sync(() => {
            entry.cancelled = true;
            const index = waiting.indexOf(entry);
            if (index >= 0) waiting.splice(index, 1);
            drain();
          });
        });
      });

    return {
      acquire,
      snapshot: Effect.sync(() => ({
        capacity: { ...normalized },
        used: { ...used },
        queued: waiting
          .filter((entry) => !entry.cancelled)
          .map(({ taskId, request }) => ({ taskId, request: { ...request } })),
      })),
    };
  });
}
