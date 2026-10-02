import { definition } from "./app-definition";
import { FileStack } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Document Studio — cross-workspace ingest/extract/translate pipeline. */
/** Operations this app contributes to the host compute worker. */
const DOCUMENT_COMPUTE = {
  backends: {
    wasm: ["document.ocr.onnx"],
    js: ["document.extract", "document.translate.fixture", "document.typeset.preview"],
  },
} as const;

export const manifest = {
  ...definition,
  icon: FileStack,
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    field: typeof search["field"] === "string" ? search["field"] : undefined,
    job: typeof search["job"] === "string" ? search["job"] : undefined,
    handoff: typeof search["handoff"] === "string" ? search["handoff"] : undefined,
    block: typeof search["block"] === "string" ? search["block"] : undefined,
  }),
  compute: DOCUMENT_COMPUTE,
} as const satisfies AppManifest;
