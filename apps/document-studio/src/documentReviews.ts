import { contentHash, type ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  createDocumentTranslationPackage,
  invalidateDownstream,
  stageById,
  updateStage,
  type DocumentContentPackage,
  type DocumentJob,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import type { RuntimeServices } from "@bcr/react";
import { Effect } from "effect";
import { documents } from "./store";

/** Persist a human review as a new immutable Translation Package Artifact. */
export async function saveDocumentTranslationReview(
  services: RuntimeServices,
  job: DocumentJob,
  translation: DocumentTranslationPackage,
  updates: Readonly<Record<string, string>>,
): Promise<void> {
  const changed = translation.blocks.some(
    (block) => Object.hasOwn(updates, block.id) && updates[block.id] !== block.translatedText,
  );
  if (!changed) {
    documents.setNotice("没有检测到译文修改");
    return;
  }
  const blocks = translation.blocks.map((block) => {
    if (!Object.hasOwn(updates, block.id)) return block;
    const translatedText = updates[block.id]?.replace(/\r\n?/gu, "\n").trim() ?? "";
    return {
      ...block,
      translatedText,
      status: translatedText.length > 0 ? ("translated" as const) : ("needs-review" as const),
    };
  });
  const payload = createDocumentTranslationPackage({
    id: translation.id,
    sourceContentId: translation.sourceContentId,
    sourceName: translation.sourceName,
    format: translation.format,
    ...(translation.sourceLanguage === undefined
      ? {}
      : { sourceLanguage: translation.sourceLanguage }),
    targetLanguage: translation.targetLanguage,
    metadata: translation.metadata,
    ...(translation.sourceRef === undefined ? {} : { sourceRef: translation.sourceRef }),
    blocks,
    adapter: "review.manual",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const artifact: ArtifactRef = {
    id: `document/translations/review/${hash}`,
    type: "document/translation-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(artifact, bytes));
  const current = documents.getJob(job.id);
  if (current !== undefined) {
    const stage = stageById(current.stages, "translate");
    const reviewed = updateStage(current, "translate", {
      status: "done",
      progress: 1,
      artifact,
      adapter: "review.manual",
      ...(stage?.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
    });
    documents.replaceJob(invalidateDownstream(reviewed, "translate"));
  }
  documents.setNotice("人工修订已保存为新的 Translation Package");
}

/** Persist OCR text corrections while retaining the original geometry. */
export async function saveDocumentOcrReview(
  services: RuntimeServices,
  job: DocumentJob,
  content: DocumentContentPackage,
  updates: Readonly<Record<string, string>>,
): Promise<void> {
  const changed = content.blocks.some(
    (block) => Object.hasOwn(updates, block.id) && updates[block.id] !== block.text,
  );
  if (!changed) {
    documents.setNotice("没有检测到 OCR 文本修改");
    return;
  }
  const blocks = content.blocks.map((block) => {
    if (!Object.hasOwn(updates, block.id)) return block;
    return {
      ...block,
      text: updates[block.id]?.replace(/\r\n?/gu, "\n").trim() ?? "",
    };
  });
  const payload = createDocumentContentPackage({
    id: content.id,
    format: content.format,
    sourceName: content.sourceName,
    metadata: content.metadata,
    ...(content.sourceRef === undefined ? {} : { sourceRef: content.sourceRef }),
    ...(content.provenance.sourceHash === undefined
      ? {}
      : { sourceHash: content.provenance.sourceHash }),
    blocks,
    adapter: "document.ocr.review",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const artifact: ArtifactRef = {
    id: `document/content/review/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(artifact, bytes));
  const current = documents.getJob(job.id);
  if (current !== undefined) {
    const stage = stageById(current.stages, "ocr");
    const reviewed = updateStage(current, "ocr", {
      status: "done",
      progress: 1,
      artifact,
      adapter: "document.ocr.review",
      execution: {
        runtime: "js",
        operation: "document.ocr.review",
        cache: "disabled",
      },
      ...(stage?.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
    });
    documents.replaceJob(invalidateDownstream(reviewed, "ocr"));
  }
  documents.setNotice("OCR 文本修订已保存；下游翻译与排版需要重新运行");
}
