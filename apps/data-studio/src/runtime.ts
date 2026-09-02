import {
  contentHash,
  hashReadableStream,
  type ArtifactRef,
  type ComputeTask,
  type TaskHandle,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { decodeDataTablePackage, type DataFormat, type DataTablePackage } from "@bcr/data-core";
import { Effect, Fiber, Stream } from "effect";

const SNAPSHOT_KEY = "data-studio.snapshot.v1";
let taskSequence = 0;
let activeTask: TaskHandle | null = null;

export interface DataTableSnapshot {
  readonly table: DataTablePackage;
  readonly sourceRef: ArtifactRef;
  readonly tableRef: ArtifactRef;
}

function formatForFile(file: Pick<File, "name" | "type">): DataFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "ndjson" || extension === "jsonl") return "ndjson";
  if (extension === "json" || file.type.toLocaleLowerCase().includes("json")) return "json";
  if (extension === "csv" || file.type.toLocaleLowerCase().includes("csv")) return "csv";
  throw new Error("Data Studio 目前支持 CSV、JSON 数组和 NDJSON 文件");
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    (candidate.storage === "memory" ||
      candidate.storage === "shared-memory" ||
      candidate.storage === "opfs")
  );
}

function sourceRefFor(file: File, hash: string, format: DataFormat): ArtifactRef {
  return {
    id: `data/source/${hash}`,
    type: `file/${format}`,
    storage: "opfs",
    format: file.type || format,
    hash,
  };
}

function tableTask(sourceRef: ArtifactRef, file: File, format: DataFormat): ComputeTask {
  taskSequence += 1;
  return {
    id: `data-table-${Date.now().toString(36)}-${taskSequence.toString(36)}`,
    runtime: "wasm",
    operation: "data.parse.table",
    inputs: [{ ...sourceRef, port: "source" }],
    outputs: [
      {
        name: "table",
        type: "data/table",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: { memoryMB: 256, threads: 1 },
    cache: { enabled: true },
    config: {
      format,
      sourceName: file.name,
      sizeBytes: file.size,
    },
  };
}

function outputRef(outputs: ReadonlyArray<ArtifactRef>): ArtifactRef {
  const ref = outputs.find((candidate) => candidate.type === "data/table") ?? outputs[0];
  if (ref === undefined) throw new Error("Data parser 没有返回 table Artifact");
  return ref;
}

/** Import and parse a table through the host Scheduler/compute.worker. */
export async function importDataTable(
  services: RuntimeServices,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<DataTableSnapshot> {
  const format = formatForFile(file);
  const hash = await hashReadableStream(file.stream());
  const sourceRef = sourceRefFor(file, hash, format);
  await Effect.runPromise(services.artifacts.putStream(sourceRef, file.stream()));
  const task = tableTask(sourceRef, file, format);
  const handle = await Effect.runPromise(services.scheduler.submit(task));
  activeTask = handle;
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (event.type === "progress") onProgress?.(event.value);
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    const tableRef = outputRef(outputs);
    const bytes = await Effect.runPromise(services.artifacts.get(tableRef));
    const table = decodeDataTablePackage(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (table === undefined) throw new Error("Data parser 返回了无效的 table Artifact");
    await persistDataTable(services, { table, sourceRef, tableRef });
    onProgress?.(1);
    return { table, sourceRef, tableRef };
  } finally {
    activeTask = null;
    Effect.runFork(Fiber.interrupt(progressFiber));
  }
}

export async function cancelDataTableImport(): Promise<void> {
  const task = activeTask;
  if (task === null) return;
  await Effect.runPromise(task.cancel);
  activeTask = null;
}

export async function persistDataTable(
  services: RuntimeServices,
  snapshot: DataTableSnapshot,
): Promise<void> {
  if (services.metadata === undefined) return;
  await services.metadata.set(
    SNAPSHOT_KEY,
    JSON.stringify({ version: 1, sourceRef: snapshot.sourceRef, tableRef: snapshot.tableRef }),
  );
}

/** Restore table metadata first, then read the immutable table Artifact. */
export async function restoreDataTable(
  services: RuntimeServices,
): Promise<DataTableSnapshot | undefined> {
  if (services.metadata === undefined) return undefined;
  const raw = await services.metadata.get(SNAPSHOT_KEY);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      sourceRef?: unknown;
      tableRef?: unknown;
    };
    if (
      parsed.version !== 1 ||
      !isArtifactRef(parsed.sourceRef) ||
      !isArtifactRef(parsed.tableRef)
    ) {
      return undefined;
    }
    const bytes = await Effect.runPromise(services.artifacts.get(parsed.tableRef));
    const table = decodeDataTablePackage(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    return table === undefined
      ? undefined
      : { table, sourceRef: parsed.sourceRef, tableRef: parsed.tableRef };
  } catch {
    return undefined;
  }
}

export async function clearDataTable(services: RuntimeServices): Promise<void> {
  if (services.metadata !== undefined) await services.metadata.set(SNAPSHOT_KEY, "");
}

export function dataContentHash(table: DataTablePackage): string {
  return contentHash(new TextEncoder().encode(JSON.stringify(table)));
}
