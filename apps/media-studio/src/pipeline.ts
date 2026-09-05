import { type ArtifactRef, type PipelineHandle } from "@bcr/core";
import { compile, decodeGraph, encodeGraph, type Graph } from "@bcr/graph";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Stream } from "effect";
import { OPERATIONS, withTranslate } from "./operations";
import { studio, type StudioSettings } from "./store";
import { normalizeCues, type MediaInfo, type SubtitleCue } from "./subtitles";

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

export async function generateSubtitles(
  services: RuntimeServices,
  options: { readonly skipCache?: boolean } = {},
): Promise<void> {
  const { source, graph, running } = studio.getSnapshot();
  // 重入保护：运行中重复触发直接忽略（UI 虽禁用按钮，取消瞬间存在竞态）
  if (source === null || running) return;

  let nodes;
  try {
    nodes = compile(graph, OPERATIONS, {
      sourceInputs: [source.ref],
      skipCache: options.skipCache === true,
    });
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
          // 渐进回填：ASR 分窗推理每窗发一次 partial，边算边出字幕
          void onNodeChunk(services, graph, nodeId, event.artifact).catch((error: unknown) => {
            studio.log("warn", `${nodeId} · partial read failed · ${String(error)}`);
          });
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

/** 渐进字幕：ASR 分窗 partial 产物 → 规范化后直接回填编辑器（运行中可见）。 */
async function onNodeChunk(
  services: RuntimeServices,
  graph: Graph,
  nodeId: string,
  artifact: ArtifactRef,
): Promise<void> {
  const operation = graph.nodes.find((n) => n.id === nodeId)?.operation;
  if (operation !== "asr.transcribe") return;
  if (artifact.type !== "subtitle/asr-partial") return;
  // 用户已在运行中手改字幕时不用 partial 覆盖编辑态
  if (studio.getSnapshot().dirty) return;

  const bytes = await Effect.runPromise(services.artifacts.get(artifact));
  const partial = JSON.parse(new TextDecoder().decode(bytes)) as {
    engine: string;
    chunks: ReadonlyArray<{ start: number; end: number; text: string }>;
  };
  if (partial.chunks.length === 0) return;
  studio.setCues(normalizeCues(partial.chunks), partial.engine);
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
  readonly settings: StudioSettings;
  /** 自定义流水线（encodeGraph 序列化）；旧项目无此字段 → 用默认图。 */
  readonly graph?: string;
}

export async function persistProject(services: RuntimeServices): Promise<void> {
  const db = services.metadata;
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
    await db.set("project", JSON.stringify(project));
  } catch (error) {
    studio.log("warn", `persist project failed · ${String(error)}`);
  }
}

export async function restoreProject(services: RuntimeServices): Promise<void> {
  const db = services.metadata;
  if (db === undefined) return;
  try {
    const raw = await db.get("project");
    if (raw === undefined) return;
    const project = JSON.parse(raw) as PersistedProject;
    if (project.settings !== undefined) {
      // 旧项目的持久化 settings 可能缺新字段（language 等）：与当前默认合并
      studio.setSettings({ ...studio.getSnapshot().settings, ...project.settings });
    }
    if (project.graph !== undefined) {
      const graph = decodeGraph(project.graph);
      // 旧版图可能缺 translate 的输入边（编译期会拒绝）：按 settings 补齐后再恢复
      if (graph !== null && graph.nodes.length > 0) {
        const settings = project.settings;
        studio.setGraph(
          settings !== undefined && settings.translate ? withTranslate(graph, settings) : graph,
        );
      }
    }
    if (project.source === null || project.source === undefined) return;

    // 源文件本体在 OPFS：优先用文件句柄快照 Blob（磁盘引用，大文件不整段进内存，§4/§8）
    let objectUrl: string | null = null;
    try {
      const blob = await Effect.runPromise(services.artifacts.getBlob(project.source.ref));
      objectUrl = URL.createObjectURL(blob);
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
