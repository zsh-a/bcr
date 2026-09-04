import {
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  documentContentStats,
  documentTranslationStats,
  stageById,
  type DocumentJob,
} from "@bcr/document-core";
import { useArtifact } from "@bcr/react";
import { useEffect, useMemo, useState } from "react";

function decodeArtifact<T>(
  bytes: Uint8Array | undefined,
  decode: (value: unknown) => T | undefined,
): T | undefined {
  if (bytes === undefined) return undefined;
  try {
    return decode(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch {
    return undefined;
  }
}

/** Decode active pipeline artifacts and keep editable review drafts in sync. */
export function useDocumentArtifacts(active: DocumentJob) {
  const contentRef =
    stageById(active.stages, "extract")?.artifact ??
    stageById(active.stages, "ocr")?.artifact ??
    null;
  const contentBytes = useArtifact(contentRef);
  const contentPackage = useMemo(
    () => decodeArtifact(contentBytes, decodeDocumentContentPackage),
    [contentBytes],
  );
  const contentStats = useMemo(
    () => (contentPackage === undefined ? undefined : documentContentStats(contentPackage)),
    [contentPackage],
  );

  const translationRef = stageById(active.stages, "translate")?.artifact ?? null;
  const translationBytes = useArtifact(translationRef);
  const translationPackage = useMemo(
    () => decodeArtifact(translationBytes, decodeDocumentTranslationPackage),
    [translationBytes],
  );
  const translationStats = useMemo(
    () =>
      translationPackage === undefined ? undefined : documentTranslationStats(translationPackage),
    [translationPackage],
  );

  const [translationDrafts, setTranslationDrafts] = useState<Readonly<Record<string, string>>>({});
  const [ocrDrafts, setOcrDrafts] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    setTranslationDrafts(
      translationPackage === undefined
        ? {}
        : Object.fromEntries(
            translationPackage.blocks.map((block) => [block.id, block.translatedText]),
          ),
    );
  }, [translationPackage]);

  useEffect(() => {
    setOcrDrafts(
      contentPackage === undefined || active.format !== "image"
        ? {}
        : Object.fromEntries(contentPackage.blocks.map((block) => [block.id, block.text])),
    );
  }, [active.format, contentPackage]);

  return {
    contentRef,
    contentPackage,
    contentStats,
    translationRef,
    translationPackage,
    translationStats,
    translationDrafts,
    setTranslationDrafts,
    ocrDrafts,
    setOcrDrafts,
  };
}
