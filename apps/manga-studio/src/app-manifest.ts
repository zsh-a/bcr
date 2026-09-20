import { BookOpenText } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Manga Studio — comic OCR, translation, cleaning and CJK typesetting.
 *
 * Contributes the largest handler set to the host compute worker: OCR, model
 * preload, translation and clean preview.
 */
export const manifest: AppManifest = {
  id: "manga",
  title: "Manga Studio",
  path: "/manga",
  icon: BookOpenText,
  description: "漫画翻译工作台 · OCR / 翻译 / 清理 / CJK 排版审校",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    document: typeof search["document"] === "string" ? search["document"] : undefined,
    page: typeof search["page"] === "string" ? search["page"] : undefined,
    region: typeof search["region"] === "string" ? search["region"] : undefined,
  }),
  compute: {
    module: () => import("./compute"),
    backends: {
      wasm: ["manga.ocr.onnx", "manga.model.preload", "manga.translate.onnx"],
      js: ["manga.ocr.review", "manga.clean.preview"],
    },
  },
};
