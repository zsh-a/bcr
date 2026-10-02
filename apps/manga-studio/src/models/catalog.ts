import {
  type MangaOcrModelManifest,
  type MangaTranslationModelManifest,
  type MangaCleanModelManifest,
} from "../project/model";

export const OCR_MODEL_MANIFESTS: ReadonlyArray<MangaOcrModelManifest> = [
  {
    id: "review.manual",
    label: "Review / 手工区域",
    runtime: "review",
    languages: ["ja", "en", "ko"],
    status: "ready",
    detail: "固化人工区域，不读取像素",
  },
  {
    id: "vision.onnx",
    label: "Local ONNX / 实验",
    model: "Xenova/trocr-small-printed",
    runtime: "wasm",
    languages: ["en"],
    status: "experimental",
    detail: "浏览器内按区域识别；模型主要面向 Latin 印刷体",
  },
  {
    id: "manga.onnx",
    label: "Manga OCR / 日本語",
    model: "onnx-community/manga-ocr-base-ONNX",
    runtime: "wasm",
    languages: ["ja"],
    status: "experimental",
    detail: "面向日文漫画的横/竖排识别；支持振假名与复杂字体，结果仍需人工审校",
  },
];

/** Translation catalog is deliberately explicit so a language never silently picks a wrong model. */
export const TRANSLATION_MODEL_MANIFESTS: ReadonlyArray<MangaTranslationModelManifest> = [
  {
    id: "fixture",
    label: "Fixture / 离线演示",
    models: {},
    runtime: "fixture",
    status: "ready",
    detail: "确定性离线映射，适合审校 UI 与队列回归",
  },
  {
    id: "local",
    label: "Local ONNX / 实验",
    models: {
      ja: "Xenova/nllb-200-distilled-600M",
      en: "Xenova/nllb-200-distilled-600M",
      ko: "Xenova/nllb-200-distilled-600M",
    },
    runtime: "wasm",
    status: "experimental",
    detail: "浏览器内懒加载多语 NLLB；模型较大，译文仍需人工审校",
  },
];

/** Cleaning stays explicit: generated inpainting is not silently replaced by a fill. */
export const CLEAN_MODEL_MANIFESTS: ReadonlyArray<MangaCleanModelManifest> = [
  {
    id: "fill",
    label: "Fill / 稳定",
    runtime: "fixture",
    status: "ready",
    detail: "基于区域掩码的可追溯填充，适合预览与导出",
  },
  {
    id: "inpaint.onnx",
    label: "Inpaint / 实验",
    runtime: "wasm",
    status: "experimental",
    detail: "生成式修复尚未接入；当前请求会显式回退 Fill",
  },
];
