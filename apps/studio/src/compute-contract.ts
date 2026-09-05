/** Backend routes are shared by the host and checked against the Worker handlers. */
export const COMPUTE_OPERATIONS = {
  wasm: [
    "hash.blake3",
    "audio.waveform",
    "document.ocr.onnx",
    "manga.ocr.onnx",
    "manga.model.preload",
    "manga.translate.onnx",
  ],
  js: [
    "document.extract",
    "data.parse.table",
    "document.translate.fixture",
    "document.typeset.preview",
    "manga.ocr.review",
    "manga.clean.preview",
  ],
} as const;
export type StudioOperation = (typeof COMPUTE_OPERATIONS)[keyof typeof COMPUTE_OPERATIONS][number];
