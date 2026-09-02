import type { DocumentJob, DocumentStageId, DocumentStageState } from "./model";

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

export function markReadyStages(job: DocumentJob): DocumentJob {
  return {
    ...job,
    updatedAt: Date.now(),
    stages: job.stages.map((stage) => {
      if (stage.id === "ingest" || stage.id === "normalize") {
        return { ...stage, status: "done" as const, progress: 1 };
      }
      if (stage.capability === "planned") return { ...stage, status: "blocked" as const };
      return stage;
    }),
  };
}

export function nextAction(job: DocumentJob): DocumentStageId | undefined {
  return job.stages.find((stage) => stage.status === "idle" && stage.capability !== "planned")?.id;
}
