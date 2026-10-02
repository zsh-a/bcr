import { createMangaCompute } from "../execution/compute";
import { createArtifactIO, defineWorker, type OperationHandler } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import { MANGA_COMPUTE } from "../execution/operations";
const handlers = createMangaCompute(createArtifactIO(new OpfsStore("manga"), "opfs"));
defineWorker({
  "manga.ocr.onnx": handlers.mangaOcrOnnx,
  "manga.model.preload": handlers.mangaModelPreload,
  "manga.translate.onnx": handlers.mangaTranslateOnnx,
  "manga.ocr.review": handlers.mangaOcrReview,
  "manga.clean.preview": handlers.mangaCleanPreview,
} satisfies Record<(typeof MANGA_COMPUTE)[keyof typeof MANGA_COMPUTE][number], OperationHandler>);
