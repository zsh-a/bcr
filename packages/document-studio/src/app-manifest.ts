import { FileStack } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Document Studio — cross-workspace ingest/extract/translate pipeline. */
export const manifest: AppManifest = {
  id: "documents",
  title: "Document Studio",
  path: "/documents",
  icon: FileStack,
  description: "文档流水线入口 · Ingest / Extract / OCR / Translate / Handoff · DOCX",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    field: typeof search["field"] === "string" ? search["field"] : undefined,
    job: typeof search["job"] === "string" ? search["job"] : undefined,
    handoff: typeof search["handoff"] === "string" ? search["handoff"] : undefined,
    block: typeof search["block"] === "string" ? search["block"] : undefined,
  }),
  compute: {
    module: () => import("./compute"),
    backends: {
      wasm: ["document.ocr.onnx"],
      js: ["document.extract", "document.translate.fixture", "document.typeset.preview"],
    },
  },
};
