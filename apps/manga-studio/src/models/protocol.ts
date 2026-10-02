import {
  type MangaAdapterExecution,
  type MangaOcrLine,
  type MangaOcrArtifact,
  type MangaTranslationArtifact,
  type MangaTranslationLine,
} from "../project/model";

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function oneOf<T extends string>(value: unknown, values: ReadonlyArray<T>): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodeMangaAdapterExecution(
  value: unknown,
  kind: MangaAdapterExecution["kind"],
): MangaAdapterExecution | undefined {
  if (value === undefined) return undefined;
  const candidate = recordValue(value);
  if (candidate === undefined) throw new Error("manga adapter execution must be an object");
  if (candidate["kind"] !== kind) throw new Error("manga adapter execution kind mismatch");
  const ocrAdapters = ["review.manual", "vision.onnx", "manga.onnx"] as const;
  const translationAdapters = ["fixture", "local"] as const;
  const adapters = kind === "ocr" ? ocrAdapters : translationAdapters;
  if (!oneOf(candidate["requestedAdapter"], adapters)) {
    throw new Error("manga adapter execution requestedAdapter is invalid");
  }
  if (!oneOf(candidate["effectiveAdapter"], adapters)) {
    throw new Error("manga adapter execution effectiveAdapter is invalid");
  }
  if (!oneOf(candidate["runtime"], ["review", "fixture", "wasm", "webgpu", "webcodecs", "js"])) {
    throw new Error("manga adapter execution runtime is invalid");
  }
  if (!oneOf(candidate["requestedDevice"], ["auto", "webgpu", "wasm"])) {
    throw new Error("manga adapter execution requestedDevice is invalid");
  }
  if (!oneOf(candidate["effectiveDevice"], ["review", "fixture", "webgpu", "wasm"])) {
    throw new Error("manga adapter execution effectiveDevice is invalid");
  }
  if (
    candidate["phase"] !== undefined &&
    !oneOf(candidate["phase"], ["queued", "loading-model", "running", "completed"])
  ) {
    throw new Error("manga adapter execution phase is invalid");
  }
  if (candidate["cache"] !== undefined && !oneOf(candidate["cache"], ["hit", "miss", "disabled"])) {
    throw new Error("manga adapter execution cache is invalid");
  }
  if (
    candidate["fallbackReason"] !== undefined &&
    !oneOf(candidate["fallbackReason"], [
      "language-unsupported",
      "webgpu-unavailable",
      "webgpu-init-failed",
      "adapter-not-ready",
      "model-missing",
      "missing-input",
    ])
  ) {
    throw new Error("manga adapter execution fallbackReason is invalid");
  }
  if (candidate["model"] !== undefined && typeof candidate["model"] !== "string") {
    throw new Error("manga adapter execution model is invalid");
  }
  if (candidate["modelUsed"] !== undefined && typeof candidate["modelUsed"] !== "boolean") {
    throw new Error("manga adapter execution modelUsed is invalid");
  }
  if (
    candidate["modelLoadDurationMs"] !== undefined &&
    (typeof candidate["modelLoadDurationMs"] !== "number" ||
      !Number.isFinite(candidate["modelLoadDurationMs"]) ||
      candidate["modelLoadDurationMs"] < 0)
  ) {
    throw new Error("manga adapter execution modelLoadDurationMs is invalid");
  }
  if (
    candidate["sourceLanguage"] !== undefined &&
    !oneOf(candidate["sourceLanguage"], ["ja", "en", "ko"])
  ) {
    throw new Error("manga adapter execution sourceLanguage is invalid");
  }
  if (candidate["targetLanguage"] !== undefined && candidate["targetLanguage"] !== "zh") {
    throw new Error("manga adapter execution targetLanguage is invalid");
  }
  if (candidate["telemetry"] !== undefined) {
    const telemetry = recordValue(candidate["telemetry"]);
    const integer = (key: string): boolean => {
      const number = telemetry?.[key];
      return typeof number === "number" && Number.isInteger(number) && number >= 0;
    };
    if (
      telemetry === undefined ||
      telemetry["unit"] !== "line" ||
      !integer("total") ||
      !integer("completed") ||
      (telemetry["completed"] as number) > (telemetry["total"] as number) ||
      (telemetry["glossaryExactHits"] !== undefined &&
        (!integer("glossaryExactHits") ||
          (telemetry["glossaryExactHits"] as number) > (telemetry["total"] as number))) ||
      (telemetry["batchSize"] !== undefined &&
        (!integer("batchSize") || (telemetry["batchSize"] as number) === 0))
    ) {
      throw new Error("manga adapter execution telemetry is invalid");
    }
  }
  return candidate as unknown as MangaAdapterExecution;
}

function decodeMangaOcrLine(value: unknown, index: number): MangaOcrLine {
  const candidate = recordValue(value);
  if (candidate === undefined) throw new Error(`manga OCR line ${index + 1} is invalid`);
  const requiredStrings = ["id", "label", "text"] as const;
  if (requiredStrings.some((key) => typeof candidate[key] !== "string")) {
    throw new Error(`manga OCR line ${index + 1} is invalid`);
  }
  const numeric = ["x", "y", "width", "height", "rotation", "confidence"] as const;
  if (numeric.some((key) => !finite(candidate[key]))) {
    throw new Error(`manga OCR line ${index + 1} has invalid geometry/confidence`);
  }
  const confidence = candidate["confidence"];
  if (!finite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`manga OCR line ${index + 1} confidence is outside 0..1`);
  }
  if (!oneOf(candidate["writingMode"], ["horizontal-tb", "vertical-rl"])) {
    throw new Error(`manga OCR line ${index + 1} writingMode is invalid`);
  }
  if (!oneOf(candidate["status"], ["detected", "needs-review", "reviewed"])) {
    throw new Error(`manga OCR line ${index + 1} status is invalid`);
  }
  return candidate as unknown as MangaOcrLine;
}

/** Decode v1 OCR artifacts, accepting older v1 payloads without execution facts. */
export function decodeMangaOcrArtifact(value: unknown): MangaOcrArtifact {
  const candidate = recordValue(value);
  if (
    candidate === undefined ||
    candidate["version"] !== 1 ||
    !oneOf(candidate["adapter"], ["review.manual", "vision.onnx", "manga.onnx"]) ||
    typeof candidate["sourceName"] !== "string" ||
    candidate["coordinateSpace"] !== "normalized-percent" ||
    !Array.isArray(candidate["lines"])
  ) {
    throw new Error("manga OCR Artifact contract validation failed");
  }
  const lines = candidate["lines"].map((line, index) => decodeMangaOcrLine(line, index));
  const execution = decodeMangaAdapterExecution(candidate["execution"], "ocr");
  return {
    version: 1,
    adapter: candidate["adapter"],
    sourceName: candidate["sourceName"],
    coordinateSpace: "normalized-percent",
    lines,
    ...(execution === undefined ? {} : { execution }),
  };
}

/** Decode v1 translation artifacts and reject adapter/line mismatches early. */
export function decodeMangaTranslationArtifact(value: unknown): MangaTranslationArtifact {
  const candidate = recordValue(value);
  if (
    candidate === undefined ||
    candidate["version"] !== 1 ||
    !oneOf(candidate["adapter"], ["fixture.translate", "local.onnx"]) ||
    typeof candidate["sourceName"] !== "string" ||
    !oneOf(candidate["sourceLanguage"], ["ja", "en", "ko"]) ||
    candidate["targetLanguage"] !== "zh" ||
    !Array.isArray(candidate["lines"])
  ) {
    throw new Error("manga translation Artifact contract validation failed");
  }
  const lines = candidate["lines"].map((line, index) => {
    const item = recordValue(line);
    if (
      item === undefined ||
      typeof item["id"] !== "string" ||
      typeof item["sourceText"] !== "string" ||
      typeof item["translatedText"] !== "string" ||
      item["status"] !== "needs-review"
    ) {
      throw new Error(`manga translation line ${index + 1} is invalid`);
    }
    return item as unknown as MangaTranslationLine;
  });
  const execution = decodeMangaAdapterExecution(candidate["execution"], "translation");
  return {
    version: 1,
    adapter: candidate["adapter"],
    sourceName: candidate["sourceName"],
    sourceLanguage: candidate["sourceLanguage"],
    targetLanguage: "zh",
    lines,
    ...(execution === undefined ? {} : { execution }),
  };
}
