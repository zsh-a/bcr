import { describe, expect, it } from "vitest";
import { createDocumentJob, markReadyStages, stageById, updateStage } from "@bcr/document-core";
import { documents } from "../src/store";

describe("Document task idempotency", () => {
  it("merges repeated source Artifact handoffs without downgrading stages", () => {
    const sourceRef = {
      id: "document/source/idempotent",
      type: "file/txt",
      storage: "opfs" as const,
      format: "text/plain",
      hash: "idempotent-source",
    };
    const first = markReadyStages(
      createDocumentJob({
        id: "document-original-idempotent",
        name: "idempotent.txt",
        format: "txt",
        size: 8,
        sourceRef,
      }),
    );
    const incoming = updateStage(
      markReadyStages(
        createDocumentJob({
          id: "document-handoff-idempotent",
          name: "idempotent.txt",
          format: "txt",
          size: 8,
          sourceRef,
          sourceTextPreview: "来自交接的内容",
        }),
      ),
      "extract",
      {
        status: "done",
        progress: 1,
        artifact: {
          id: "document/content/idempotent",
          type: "document/content-package",
          storage: "opfs",
          format: "json",
        },
      },
    );

    try {
      const firstId = documents.addJob(first);
      const mergedId = documents.addJob(incoming);
      const matching = documents
        .getSnapshot()
        .jobs.filter((job) => job.sourceRef?.hash === "idempotent-source");
      expect(mergedId).toBe(firstId);
      expect(matching).toHaveLength(1);
      expect(stageById(matching[0]!.stages, "extract")).toMatchObject({
        status: "done",
        artifact: { id: "document/content/idempotent" },
      });
    } finally {
      documents.removeJob(first.id);
    }
  });
});
