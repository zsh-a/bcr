import { artifactPath, type ArtifactRef, type PipelineHandle } from "@bcr/core";
import { compile, decodeGraph, encodeGraph, type Graph } from "@bcr/graph";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Stream } from "effect";
import { OPERATIONS } from "./operations";
import { metaDatabase, sourceBlobStore } from "./runtime";
import { studio, type EngineMode } from "./store";
import type { MediaInfo, SubtitleCue } from "./subtitles";

/**
 * 字幕生成流水线（§3 DAG 正向编排）：
 *
 *   图（用户在编辑器中编排 / 顶栏快捷改写）─ compile() → PipelineNode[]
 *     → scheduler.submitPipeline() → 事件流投影回图上节点
 *
 * 每个节点都是一个 ComputeTask：输入/操作/模型版本共同决定缓存键（§7）——
 * 同一文件重跑、只改下游参数、模型换档，都只重算失效的子链。
 */

let handle: PipelineHandle | null = null;

export async function cancelGeneration(): Promise<void> {
  if (handle === null) return;
  await Effect.runPromise(handle.cancel);
  studio.log("warn", "pipeline · cancel requested");
}

export async function generateSubtitles(services: RuntimeServices): Promise<void> {
  const { source, graph, running } = studio.getSnapshot();
  // 重入保护：运行中重复触发直接忽略（UI 虽禁用按钮，取消瞬间存在竞态）
  if (source === null || running) return;

  let nodes;
  try {
    nodes = compile(graph, OPERATIONS, { sourceInputs: [source.ref] });
  } catch (error) {
    studio.log(
      "error",
      `pipeline · 图编译失败 · ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (nodes.length === 0) {
    studio.log("warn", "pipeline · 图为空，未执行");
    return;
  }

  const pipelineId = `sub-${Date.now()}`;
  studio.resetRun();
  studio.log("info", `pipeline · ${pipelineId} · ${nodes.length} nodes (compiled from graph)`);

  const submitted = await Effect.runPromise(services.scheduler.submitPipeline(pipelineId, nodes));
  handle = submitted;

  const projection = Stream.runForEach(submitted.events, (event) =>
    Effect.sync(() => {
      if (!event.taskId.startsWith(`${pipelineId}/`)) return;
      const nodeId = event.taskId.slice(pipelineId.length + 1);
      switch (event.type) {
        case "progress":
          studio.patchNodeStatus(nodeId, { status: "running", progress: event.value });
          break;
        case "completed":
          // 浮空 promise 必须兜底：产物缺失（如陈旧缓存引用）降级为 warn，不抛 uncaught
          void onNodeCompleted(services, graph, nodeId, event.outputs).catch((error: unknown) => {
            studio.log("warn", `${nodeId} · output read failed · ${String(error)}`);
          });
          break;
        case "failed":
          studio.patchNodeStatus(nodeId, { status: "failed", error: event.error });
          studio.log("error", `${nodeId} · ${event.error}`);
          break;
        case "chunk":
          break;
      }
    }),
  );
  Effect.runFork(projection);

  try {
    const outputs = await Effect.runPromise(submitted.await);
    const cuesRef = findCuesRef(
      nodes.map((n) => n.id),
      outputs,
    );
    if (cuesRef === undefined) {
      studio.log("error", "pipeline · completed without cues artifact");
      studio.setRunning(false);
      return;
    }
    const hasTranslate = graph.nodes.some((n) => n.operation === "subtitle.translate");
    const { cues, engine } = await loadCues(services, cuesRef, hasTranslate);
    studio.setCues(cues, engine);
    studio.setRunning(false);
    studio.log("ok", `pipeline · done · ${cues.length} cues · engine=${engine}`);
    void persistProject(services);
  } catch (error) {
    studio.setRunning(false);
    studio.log("error", `pipeline · ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    handle = null;
  }
}

/** 终态字幕产物：拓扑序逆序找第一个产出 subtitle/cues 的节点。 */
function findCuesRef(
  topoOrder: ReadonlyArray<string>,
  outputs: ReadonlyMap<string, ReadonlyArray<ArtifactRef>>,
): ArtifactRef | undefined {
  for (const id of [...topoOrder].reverse()) {
    const refs = outputs.get(id);
    const cues = refs?.find((ref) => ref.type === "subtitle/cues");
    if (cues !== undefined) return cues;
  }
  return undefined;
}

async function onNodeCompleted(
  services: RuntimeServices,
  graph: Graph,
  nodeId: string,
  outputs: ReadonlyArray<ArtifactRef>,
): Promise<void> {
  studio.patchNodeStatus(nodeId, { status: "done", progress: 1 });

  const operation = graph.nodes.find((n) => n.id === nodeId)?.operation;

  if (operation === "media.decode-audio") {
    const infoRef = outputs.find((ref) => ref.type === "media/info");
    if (infoRef !== undefined) {
      const bytes = await Effect.runPromise(services.artifacts.get(infoRef));
      studio.setMediaInfo(JSON.parse(new TextDecoder().decode(bytes)) as MediaInfo);
    }
  }
  if (operation === "audio.waveform") {
    const peaksRef = outputs.find((ref) => ref.type === "audio/waveform-peaks");
    if (peaksRef !== undefined) {
      const bytes = await Effect.runPromise(services.artifacts.get(peaksRef));
      studio.setPeaks(
        new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      );
    }
  }
}

async function loadCues(
  services: RuntimeServices,
  ref: ArtifactRef,
  hasTranslate: boolean,
): Promise<{ cues: SubtitleCue[]; engine: string }> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    cues: SubtitleCue[];
    engine?: string;
  };
  return {
    cues: parsed.cues,
    engine: parsed.engine ?? (hasTranslate ? "whisper+translate" : "whisper"),
  };
}

// ── 项目状态持久化（§8：刷新恢复） ──────────────────────────────────

interface PersistedProject {
  readonly source: { ref: ArtifactRef; name: string; size: number } | null;
  readonly cues: ReadonlyArray<SubtitleCue>;
  readonly engineUsed: string | null;
  readonly settings: { model: string; engine: EngineMode; translate: boolean };
  /** 自定义流水线（encodeGraph 序列化）；旧项目无此字段 → 用默认图。 */
  readonly graph?: string;
}

export async function persistProject(_services: RuntimeServices): Promise<void> {
  const db = metaDatabase();
  if (db === undefined) return;
  const state = studio.getSnapshot();
  const project: PersistedProject = {
    source:
      state.source !== null
        ? { ref: state.source.ref, name: state.source.name, size: state.source.size }
        : null,
    cues: state.cues,
    engineUsed: state.engineUsed,
    settings: state.settings,
    graph: encodeGraph(state.graph),
  };
  try {
    await db.kvSet("project", JSON.stringify(project));
  } catch (error) {
    studio.log("warn", `persist project failed · ${String(error)}`);
  }
}

export async function restoreProject(services: RuntimeServices): Promise<void> {
  const db = metaDatabase();
  if (db === undefined) return;
  try {
    const raw = await db.kvGet("project");
    if (raw === undefined) return;
    const project = JSON.parse(raw) as PersistedProject;
    if (project.settings !== undefined) {
      studio.setSettings(project.settings);
    }
    if (project.graph !== undefined) {
      const graph = decodeGraph(project.graph);
      if (graph !== null && graph.nodes.length > 0) studio.setGraph(graph);
    }
    if (project.source === null || project.source === undefined) return;

    // 源文件本体在 OPFS：优先用文件句柄快照 Blob（磁盘引用，大文件不整段进内存，§4/§8）
    let objectUrl: string | null = null;
    try {
      const store = sourceBlobStore();
      const blob =
        project.source.ref.storage === "opfs" && store !== undefined
          ? await store.getBlob?.(artifactPath(project.source.ref))
          : undefined;
      if (blob !== undefined && blob !== null) {
        objectUrl = URL.createObjectURL(blob);
      } else {
        const bytes = await Effect.runPromise(services.artifacts.get(project.source.ref));
        objectUrl = URL.createObjectURL(
          new Blob([
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as BlobPart,
          ]),
        );
      }
    } catch {
      objectUrl = null;
    }
    studio.setSource({
      ref: project.source.ref,
      name: project.source.name,
      size: project.source.size,
      objectUrl,
    });
    if (project.cues !== undefined && project.cues.length > 0) {
      studio.setCues(project.cues, project.engineUsed ?? null);
      studio.log("ok", `restore · ${project.cues.length} cues from metadata`);
    }
    studio.log("info", `restore · ${project.source.name}`);
  } catch (error) {
    studio.log("warn", `restore project failed · ${String(error)}`);
  }
}
