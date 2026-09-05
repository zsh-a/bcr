import { createDataCompute } from "@bcr/data-studio/compute";
import { createDocumentCompute } from "@bcr/document-studio/compute";
import { createMangaCompute } from "@bcr/manga-studio/compute";
import { createKernelCompute } from "@bcr/media-studio/compute";
import type { OperationHandler } from "@bcr/runtime-worker";
import { createArtifactIO, defineWorker } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import type { StudioOperation } from "../compute-contract";

const io = createArtifactIO(new OpfsStore("studio"), "opfs");
const { documentExtract, documentTranslateFixture, documentTypesetPreview } =
  createDocumentCompute(io);
const { dataParseTable } = createDataCompute(io);
const {
  documentOcrOnnx,
  mangaCleanPreview,
  mangaModelPreload,
  mangaOcrOnnx,
  mangaOcrReview,
  mangaTranslateOnnx,
} = createMangaCompute(io);
const { audioWaveform, hashBlake3 } = createKernelCompute(io);

/**
 * Compute Worker composition root.
 *
 * Each task family owns its parsing/model logic; this file only maps stable
 * graph operation IDs to handlers.
 */
defineWorker({
  "hash.blake3": (task, ctx) => {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("hash.blake3 requires an input");
    return hashBlake3(task, input, ctx);
  },
  "audio.waveform": (task, ctx) => {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("audio.waveform requires an input");
    return audioWaveform(task, input, ctx);
  },
  "document.extract": (task, ctx) => documentExtract(task, ctx),
  "data.parse.table": (task, ctx) => dataParseTable(task, ctx),
  "document.ocr.onnx": (task, ctx) => documentOcrOnnx(task, ctx),
  "document.translate.fixture": (task, ctx) => documentTranslateFixture(task, ctx),
  "document.typeset.preview": (task, ctx) => documentTypesetPreview(task, ctx),
  "manga.ocr.review": (task, ctx) => mangaOcrReview(task, ctx),
  "manga.ocr.onnx": (task, ctx) => mangaOcrOnnx(task, ctx),
  "manga.model.preload": (task, ctx) => mangaModelPreload(task, ctx),
  "manga.translate.onnx": (task, ctx) => mangaTranslateOnnx(task, ctx),
  "manga.clean.preview": (task, ctx) => mangaCleanPreview(task, ctx),
} satisfies Record<StudioOperation, OperationHandler>);
