import { Effect } from "effect";
import { DEFAULT_DOCUMENT_OCR_SETTINGS, decodeDocumentContentPackage } from "@bcr/document-core";
import type { KnowledgeStore } from "./store";
import { attachmentPath, isPreviewImage, type KnowledgeAttachment } from "./attachmentModel";

export const canReadAttachmentText = (asset: KnowledgeAttachment) =>
  isPreviewImage(asset.mime) ||
  asset.mime.startsWith("text/") ||
  asset.mime === "application/pdf" ||
  /\.(?:epub|docx|fb2|md|markdown|txt|html|csv|json|ya?ml|toml|log|js|ts|py|rs|css)$/iu.test(
    asset.name,
  );
const rawText = (asset: KnowledgeAttachment) =>
  !isPreviewImage(asset.mime) &&
  asset.mime !== "application/pdf" &&
  ((asset.mime.startsWith("text/") && asset.mime !== "text/html") ||
    /\.(?:md|markdown|txt|csv|json|ya?ml|toml|log|js|ts|py|rs|css)$/iu.test(asset.name));
const PAGE_BYTES = 48 * 1024;
type TextPage = { page: number; pages: number; label: string; text: string; engine: string };
/** Each derived page is disposable and keyed by immutable source hash and extraction version. */
export async function readAttachmentText(
  store: KnowledgeStore,
  asset: KnowledgeAttachment,
  options: {
    page?: number;
    offset?: number;
    ocr?: boolean;
    language?: "en" | "ja";
    signal?: AbortSignal;
  } = {},
) {
  const page = options.page ?? 1,
    offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100_000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error("附件页码或读取位置无效");
  if (!canReadAttachmentText(asset)) throw new Error("该附件暂无文本适配器，可下载原文件");
  options.signal?.throwIfAborted();
  const binary = store.binary;
  if (!binary) throw new Error("附件文件存储不可用");
  const key = `artifacts/knowledge/attachments/text/${asset.hash}/v1-${options.language ?? "en"}-${page}.json`;
  const cached = await binary.get(key);
  let result: TextPage;
  if (cached) {
    const decoded = JSON.parse(new TextDecoder().decode(cached)) as TextPage;
    if (
      typeof decoded.text !== "string" ||
      typeof decoded.label !== "string" ||
      typeof decoded.engine !== "string" ||
      decoded.text.length > 2_000_000 ||
      decoded.page !== page ||
      !Number.isSafeInteger(decoded.pages) ||
      decoded.pages < page
    )
      throw new Error("附件文本索引损坏，请重新提取");
    result = decoded;
  } else {
    const blob = await store.attachments.require(asset);
    if (rawText(asset)) {
      const pages = Math.max(1, Math.ceil(blob.size / PAGE_BYTES));
      if (page > pages) throw new Error("附件页码超出范围");
      const start = await utf8Boundary(blob, (page - 1) * PAGE_BYTES),
        end = await utf8Boundary(blob, Math.min(page * PAGE_BYTES, blob.size));
      result = {
        page,
        pages,
        label: `第 ${page} 段`,
        text: await blob.slice(start, end).text(),
        engine: "utf8-v1",
      };
    } else if (isPreviewImage(asset.mime)) {
      if (page !== 1) throw new Error("图片仅有一页");
      if (!options.ocr) throw new Error("图片尚未识别文字，请开启 OCR 或在附件预览中提取文本");
      const compute = store.compute;
      if (!compute) throw new Error("本地 OCR 计算服务不可用");
      const language = options.language ?? "en",
        settings = DEFAULT_DOCUMENT_OCR_SETTINGS;
      const handle = await Effect.runPromise(
        compute.scheduler.submit({
          id: `knowledge-ocr-${crypto.randomUUID()}`,
          operation: "document.ocr.onnx",
          runtime: "wasm",
          inputs: [
            {
              id: attachmentPath(asset.hash),
              hash: asset.hash,
              storage: "opfs",
              type: "file/image",
              format: asset.mime,
              port: "source",
            },
          ],
          outputs: [
            { name: "content", type: "document/content-package", storage: "opfs", format: "json" },
          ],
          resources: { memoryMB: 1536, threads: 1 },
          cache: { enabled: true },
          config: {
            sourceName: asset.name,
            sourceLanguage: language,
            adapter: language === "ja" ? "manga.onnx" : settings.adapter,
            model: language === "ja" ? "onnx-community/manga-ocr-base-ONNX" : settings.model,
            device: "wasm",
            regions: [
              {
                id: "page-1",
                label: "Page 1",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                writingMode: "horizontal-tb",
                sourceText: "",
                confidence: 0,
              },
            ],
          },
        }),
      );
      const cancel = () => {
        void Effect.runPromise(handle.cancel);
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (options.signal?.aborted) cancel();
        const outputs = await Effect.runPromise(handle.await);
        options.signal?.throwIfAborted();
        if (!outputs[0]) throw new Error("OCR 未返回识别结果");
        const data = await Effect.runPromise(compute.artifacts.get(outputs[0]));
        const content = decodeDocumentContentPackage(JSON.parse(new TextDecoder().decode(data)));
        if (!content) throw new Error("OCR 文本格式无效");
        result = {
          page: 1,
          pages: 1,
          label: "图片识别文本",
          text: content.blocks.map((block) => block.text).join("\n"),
          engine: `document-ocr-v1-${language}`,
        };
      } finally {
        options.signal?.removeEventListener("abort", cancel);
      }
    } else {
      const { readReaderFileTextPage } = await import("@bcr/reader-studio/adapters");
      result = await readReaderFileTextPage(
        new File([blob], asset.name, { type: asset.mime }),
        asset.id,
        page,
        options.signal,
      );
    }
    options.signal?.throwIfAborted();
    if (result.text.length > 2_000_000) throw new Error("附件单页文本过长，请在 Reader 中查看");
    await binary.put(key, new TextEncoder().encode(JSON.stringify(result)));
  }
  options.signal?.throwIfAborted();
  if (offset > result.text.length) throw new Error("读取位置超出当前页文本范围");
  let end = Math.min(offset + 12_000, result.text.length);
  if (end < result.text.length && /[\ud800-\udbff]/u.test(result.text.charAt(end - 1))) end--;
  const text = result.text.slice(offset, end);
  return {
    attachmentId: asset.id,
    name: asset.name,
    version: asset.hash,
    page: result.page,
    totalPages: result.pages,
    label: result.label,
    engine: result.engine,
    offset,
    text,
    nextOffset: offset + text.length < result.text.length ? offset + text.length : null,
    nextPage: page < result.pages ? page + 1 : null,
  };
}
async function utf8Boundary(blob: Blob, offset: number) {
  if (!offset || offset >= blob.size) return offset;
  const from = Math.max(0, offset - 3),
    bytes = new Uint8Array(await blob.slice(from, offset + 1).arrayBuffer());
  let index = offset - from;
  while (index > 0 && (bytes[index]! & 0xc0) === 0x80) index--;
  return from + index;
}
