import type { ArtifactRef, PipelineHandle } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Stream } from "effect";
import { metaDatabase } from "./runtime";
import { studio, type EngineMode } from "./store";
import type { MediaInfo, SubtitleCue } from "./subtitles";

/**
 * 字幕生成流水线（§3 DAG 正向编排的第一次实战）：
 *
 *   decode ─┬─ wave
 *           └─ asr ─ segment ─┬─ (translate)
 *
 * 每个节点都是一个 ComputeTask：输入/操作/模型版本共同决定缓存键（§7）——
 * 同一文件重跑、只改下游参数、模型换档，都只重算失效的子链。
 */

export interface GenerateOptions {
  readonly model: string;
  readonly engine: EngineMode;
  readonly translate: boolean;
}

let handle: PipelineHandle | null = null;

export async function cancelGeneration(): Promise<void> {
  if (handle === null) return;
  await Effect.runPromise(handle.cancel);
  studio.log("warn", "pipeline · cancel requested");
}

export async function generateSubtitles(
  services: RuntimeServices,
  options: GenerateOptions,
): Promise<void> {
  const source = studio.getSnapshot().source;
  if (source === null) return;

  const pipelineId = `sub-${Date.now()}`;
  const nodes = [
    {
      id: "decode",
      runtime: "js" as const,
      operation: "media.decode-audio",
      inputs: [source.ref],
      outputs: [{ type: "audio/pcm-f32" }, { type: "media/info" }],
    },
    {
      id: "wave",
      runtime: "wasm" as const,
      operation: "audio.waveform",
      after: ["decode"],
      outputs: [{ type: "audio/waveform-peaks" }],
    },
    {
      id: "asr",
      runtime: "wasm" as const,
      operation: "asr.transcribe",
      after: ["decode"],
      outputs: [{ type: "subtitle/asr-chunks" }],
      config: { model: options.model, engine: options.engine },
    },
    {
      id: "segment",
      runtime: "wasm" as const,
      operation: "subtitle.segment",
      after: ["asr"],
      outputs: [{ type: "subtitle/cues" }],
      config: { maxDurationS: 5, maxChars: 30 },
    },
    ...(options.translate
      ? [
          {
            id: "translate",
            runtime: "wasm" as const,
            operation: "subtitle.translate",
            after: ["decode", "segment"],
            outputs: [{ type: "subtitle/cues" }],
            config: { model: options.model },
          },
        ]
      : []),
  ];

  studio.resetNodes();
  studio.log(
    "info",
    `pipeline · ${pipelineId} · ${nodes.length} nodes · engine=${options.engine} · translate=${options.translate}`,
  );

  const submitted = await Effect.runPromise(services.scheduler.submitPipeline(pipelineId, nodes));
  handle = submitted;
  const sawProgress = new Set<string>();

  const projection = Stream.runForEach(submitted.events, (event) =>
    Effect.sync(() => {
      if (!event.taskId.startsWith(`${pipelineId}/`)) return;
      const nodeId = event.taskId.slice(pipelineId.length + 1);
      switch (event.type) {
        case "progress":
          sawProgress.add(nodeId);
          studio.patchNode(nodeId, { status: "running", progress: event.value });
          break;
        case "completed":
          sawProgress.add(nodeId);
          void onNodeCompleted(services, nodeId, event.outputs);
          break;
        case "failed":
          studio.patchNode(nodeId, {
            status: "failed",
            error: event.error,
          });
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
    const cuesRef = options.translate ? outputs.get("translate")?.[0] : outputs.get("segment")?.[0];
    if (cuesRef === undefined) {
      studio.log("error", "pipeline · completed without cues artifact");
      return;
    }
    const { cues, engine } = await loadCues(services, cuesRef, options);
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

async function onNodeCompleted(
  services: RuntimeServices,
  nodeId: string,
  outputs: ReadonlyArray<ArtifactRef>,
): Promise<void> {
  studio.patchNode(nodeId, { status: "done", progress: 1 });

  if (nodeId === "decode") {
    const infoRef = outputs.find((ref) => ref.type === "media/info");
    if (infoRef !== undefined) {
      const bytes = await Effect.runPromise(services.artifacts.get(infoRef));
      studio.setMediaInfo(JSON.parse(new TextDecoder().decode(bytes)) as MediaInfo);
    }
  }
  if (nodeId === "wave") {
    const peaksRef = outputs[0];
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
  options: GenerateOptions,
): Promise<{ cues: SubtitleCue[]; engine: string }> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    cues: SubtitleCue[];
    engine?: string;
  };
  return {
    cues: parsed.cues,
    engine: parsed.engine ?? (options.translate ? "whisper+translate" : "whisper"),
  };
}

// ── 项目状态持久化（§8：刷新恢复） ──────────────────────────────────

interface PersistedProject {
  readonly source: { ref: ArtifactRef; name: string; size: number } | null;
  readonly cues: ReadonlyArray<SubtitleCue>;
  readonly engineUsed: string | null;
  readonly settings: { model: string; engine: EngineMode; translate: boolean };
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
    if (project.source === null || project.source === undefined) return;

    // 源文件本体在 OPFS：重建播放用 Blob URL（§8 本地工作站语义）
    let objectUrl: string | null = null;
    try {
      const bytes = await Effect.runPromise(services.artifacts.get(project.source.ref));
      objectUrl = URL.createObjectURL(
        new Blob([
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as BlobPart,
        ]),
      );
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
