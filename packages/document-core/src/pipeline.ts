import {
  supportsDocumentTextExtract,
  type DocumentJob,
  type DocumentStageId,
  type DocumentStageState,
} from "./model";

export function stageById(
  stages: ReadonlyArray<DocumentStageState>,
  id: DocumentStageId,
): DocumentStageState | undefined {
  return stages.find((stage) => stage.id === id);
}

export function updateStage(
  job: DocumentJob,
  id: DocumentStageId,
  patch: Partial<DocumentStageState>,
): DocumentJob {
  return {
    ...job,
    updatedAt: Date.now(),
    stages: job.stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
  };
}

/**
 * Invalidate every derived stage after a changed source stage. Artifacts are
 * immutable and remain in storage; only the job projection is reset so a
 * rerun cannot accidentally present stale translation/typeset/export output.
 */
export function invalidateDownstream(job: DocumentJob, stageId: DocumentStageId): DocumentJob {
  const sourceIndex = job.stages.findIndex((stage) => stage.id === stageId);
  if (sourceIndex < 0) return job;
  return {
    ...job,
    updatedAt: Date.now(),
    stages: job.stages.map((stage, index) => {
      if (index <= sourceIndex) return stage;
      return {
        id: stage.id,
        label: stage.label,
        detail: stage.detail,
        capability: stage.capability,
        status: stage.capability === "planned" ? ("blocked" as const) : ("idle" as const),
        progress: 0,
        ...(stage.adapter === undefined ? {} : { adapter: stage.adapter }),
        ...(stage.attempts === undefined ? {} : { attempts: stage.attempts }),
      };
    }),
  };
}

export function markReadyStages(job: DocumentJob): DocumentJob {
  return {
    ...job,
    updatedAt: Date.now(),
    stages: job.stages.map((stage) => {
      if (stage.id === "ingest" || stage.id === "normalize") {
        return { ...stage, status: "done" as const, progress: 1 };
      }
      if (stage.id === "extract" && !supportsDocumentTextExtract(job.format)) {
        return {
          ...stage,
          status: "blocked" as const,
          detail: "该格式由 Reader / Manga 专用适配器直接读取",
        };
      }
      if (stage.id === "ocr") {
        if (job.format === "image") {
          return {
            ...stage,
            capability: "adapter" as const,
            adapter: "document.ocr.onnx",
            detail: "在本地 Worker 中运行整页视觉 OCR；复杂版面可交给 Manga",
            // Jobs created before the adapter landed persisted OCR as blocked.
            status: stage.status === "blocked" ? ("idle" as const) : stage.status,
          };
        }
        return {
          ...stage,
          capability: "planned" as const,
          status: stage.status === "done" ? ("done" as const) : ("blocked" as const),
          detail: "文本格式跳过 OCR，直接使用已抽取的结构化内容",
        };
      }
      if (stage.capability === "planned") return { ...stage, status: "blocked" as const };
      return stage;
    }),
  };
}

export function nextAction(job: DocumentJob): DocumentStageId | undefined {
  for (const stage of job.stages) {
    if (stage.status === "done") continue;
    if (stage.status !== "idle" || stage.capability === "planned") return undefined;
    return stage.id;
  }
  return undefined;
}
