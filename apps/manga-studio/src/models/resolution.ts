import {
  type MangaOcrDevice,
  type MangaResolvedDevice,
  type MangaAdapterResolutionOptions,
  type MangaAdapterExecution,
  type MangaOcrAdapterId,
  type MangaSourceLanguage,
  type MangaOcrAdapterResolution,
  type MangaTranslationEngineId,
  type MangaTranslationAdapterResolution,
  type MangaAdapterFallbackReason,
  type MangaCleanMode,
} from "../project/model";
import { OCR_MODEL_MANIFESTS, TRANSLATION_MODEL_MANIFESTS } from "./catalog";

/** Browser capability probe kept in one place so UI and Worker use the same rule. */
export function mangaWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Resolve a local model device. A missing WebGPU capability is always explicit. */
export function resolveMangaDevice(
  requestedDevice: MangaOcrDevice,
  webgpuAvailable = mangaWebGpuAvailable(),
): {
  readonly requestedDevice: MangaOcrDevice;
  readonly effectiveDevice: Extract<MangaResolvedDevice, "webgpu" | "wasm">;
  readonly fallbackReason?: "webgpu-unavailable";
} {
  if (requestedDevice === "wasm") {
    return { requestedDevice, effectiveDevice: "wasm" };
  }
  if (webgpuAvailable) {
    return { requestedDevice, effectiveDevice: "webgpu" };
  }
  return {
    requestedDevice,
    effectiveDevice: "wasm",
    fallbackReason: "webgpu-unavailable",
  };
}

export function requestedDevice(
  options: MangaAdapterResolutionOptions | undefined,
): MangaOcrDevice {
  const value = options?.device;
  return value === "webgpu" || value === "wasm" ? value : "auto";
}

function withOptionalModel(
  execution: MangaAdapterExecution,
  model: string | undefined,
): MangaAdapterExecution {
  return model === undefined || model.trim().length === 0 ? execution : { ...execution, model };
}

/** Resolve OCR language, adapter readiness and device before a task is submitted. */
export function resolveMangaOcrAdapter(
  adapter: MangaOcrAdapterId,
  sourceLanguage: MangaSourceLanguage,
  options?: MangaAdapterResolutionOptions,
): MangaOcrAdapterResolution {
  const manifest = OCR_MODEL_MANIFESTS.find((candidate) => candidate.id === adapter);
  if (manifest === undefined) {
    throw new Error(`unknown manga OCR adapter: ${adapter}`);
  }
  const device = requestedDevice(options);
  const model = options?.model ?? manifest.model;
  if (adapter !== "review.manual" && !manifest.languages.includes(sourceLanguage)) {
    const execution = withOptionalModel(
      {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: "review.manual",
        runtime: "review",
        requestedDevice: device,
        effectiveDevice: "review",
        sourceLanguage,
        fallbackReason: "language-unsupported",
      },
      model,
    );
    const effectiveManifest = OCR_MODEL_MANIFESTS.find(
      (candidate) => candidate.id === "review.manual",
    );
    if (effectiveManifest === undefined) throw new Error("review OCR adapter manifest is missing");
    return { manifest, effectiveManifest, execution };
  }
  if (adapter === "review.manual") {
    return {
      manifest,
      effectiveManifest: manifest,
      execution: {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: "review",
        requestedDevice: device,
        effectiveDevice: "review",
        sourceLanguage,
      },
    };
  }
  const resolvedDevice = resolveMangaDevice(device, options?.webgpuAvailable);
  return {
    manifest,
    effectiveManifest: manifest,
    execution: withOptionalModel(
      {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: manifest.runtime,
        requestedDevice: resolvedDevice.requestedDevice,
        effectiveDevice: resolvedDevice.effectiveDevice,
        sourceLanguage,
        ...(resolvedDevice.fallbackReason === undefined
          ? {}
          : { fallbackReason: resolvedDevice.fallbackReason }),
      },
      model,
    ),
  };
}

/** Resolve translation engine/model and make missing-model fallback observable. */
export function resolveMangaTranslationAdapter(
  adapter: MangaTranslationEngineId,
  sourceLanguage: MangaSourceLanguage,
  options?: MangaAdapterResolutionOptions,
): MangaTranslationAdapterResolution {
  const manifest = TRANSLATION_MODEL_MANIFESTS.find((candidate) => candidate.id === adapter);
  if (manifest === undefined) {
    throw new Error(`unknown manga translation adapter: ${adapter}`);
  }
  const device = requestedDevice(options);
  const model = options?.model ?? manifest.models[sourceLanguage];
  if (adapter === "fixture" || model === undefined || model.trim().length === 0) {
    const fallbackReason =
      adapter === "fixture" ? undefined : ("model-missing" satisfies MangaAdapterFallbackReason);
    const effectiveManifest = TRANSLATION_MODEL_MANIFESTS.find(
      (candidate) => candidate.id === "fixture",
    );
    if (effectiveManifest === undefined) throw new Error("fixture translation manifest is missing");
    return {
      manifest,
      effectiveManifest,
      execution: withOptionalModel(
        {
          kind: "translation",
          requestedAdapter: adapter,
          effectiveAdapter: "fixture",
          runtime: "fixture",
          requestedDevice: device,
          effectiveDevice: "fixture",
          sourceLanguage,
          targetLanguage: "zh",
          ...(fallbackReason === undefined ? {} : { fallbackReason }),
        },
        model,
      ),
    };
  }
  const resolvedDevice = resolveMangaDevice(device, options?.webgpuAvailable);
  return {
    manifest,
    effectiveManifest: manifest,
    execution: withOptionalModel(
      {
        kind: "translation",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: manifest.runtime,
        requestedDevice: resolvedDevice.requestedDevice,
        effectiveDevice: resolvedDevice.effectiveDevice,
        sourceLanguage,
        targetLanguage: "zh",
        ...(resolvedDevice.fallbackReason === undefined
          ? {}
          : { fallbackReason: resolvedDevice.fallbackReason }),
      },
      model,
    ),
  };
}

export function resolveMangaCleanMode(mode: MangaCleanMode): {
  readonly requestedMode: MangaCleanMode;
  readonly effectiveMode: "fill";
  readonly adapter: "fill";
  readonly fallbackReason?: "inpaint-adapter-not-ready";
} {
  if (mode === "inpaint") {
    return {
      requestedMode: mode,
      effectiveMode: "fill",
      adapter: "fill",
      fallbackReason: "inpaint-adapter-not-ready",
    };
  }
  return { requestedMode: mode, effectiveMode: "fill", adapter: "fill" };
}
