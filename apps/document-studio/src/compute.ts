import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  createDocumentTranslationPackage,
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  type DocumentContentPackage,
  type DocumentFormat,
  type DocumentTranslationBlock,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import type { WorkerContext } from "@bcr/runtime-worker";
import { configString, sizeOf, throwIfAborted, WINDOW, type ArtifactIO } from "@bcr/runtime-worker";

export function createDocumentCompute(io: ArtifactIO) {
  const { store: binary, readJsonArtifact, writeTypedJsonArtifact } = io;
  interface ExtractedSection {
    readonly id: string;
    readonly order: number;
    readonly label: string;
    readonly text: string;
  }

  function documentFormat(value: string): DocumentFormat {
    return value === "txt" ||
      value === "markdown" ||
      value === "html" ||
      value === "docx" ||
      value === "fb2" ||
      value === "epub" ||
      value === "pdf" ||
      value === "cbz" ||
      value === "image"
      ? value
      : "unknown";
  }

  function stripMarkup(raw: string): string {
    return raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(/<\/(?:p|div|section|article|title|h[1-6])\s*>/giu, "\n\n")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&amp;/gu, "&")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&quot;/gu, '"')
      .replace(/&#39;/gu, "'");
  }

  function extractSections(raw: string, format: string): ReadonlyArray<ExtractedSection> {
    const normalized = (format === "html" || format === "fb2" ? stripMarkup(raw) : raw)
      .replace(/\r\n?/gu, "\n")
      .trim();
    const blocks = normalized
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean);
    const sourceBlocks = blocks.length > 0 ? blocks : [normalized || "暂无内容"];
    return sourceBlocks.map((text, order) => {
      const markdownHeading = /^(?:#{1,6})\s+(.+)$/u.exec(text);
      const label =
        markdownHeading?.[1]?.trim() || `${format === "txt" ? "段落" : "Section"} ${order + 1}`;
      return { id: `section-${order + 1}`, order, label, text };
    });
  }

  /** Text/HTML/FB2 extraction: streamed source read → immutable JSON artifact. */
  async function documentExtract(
    task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
    ctx: WorkerContext,
  ): Promise<ReadonlyArray<ArtifactRef>> {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("document.extract requires a source artifact");
    const total = sizeOf(task);
    const decoder = new TextDecoder();
    let raw = "";
    let offset = 0;
    for (;;) {
      throwIfAborted(ctx);
      const chunk = await binary.readRange(artifactPath(input), offset, WINDOW);
      if (chunk.byteLength === 0) break;
      raw += decoder.decode(chunk, { stream: true });
      offset += chunk.byteLength;
      if (total > 0) ctx.progress(Math.min(0.92, offset / total));
    }
    raw += decoder.decode();
    const format = documentFormat(configString(task, "format"));
    const sourceName = configString(task, "sourceName") || input.id;
    const payload = createDocumentContentPackage({
      id: `document-content/${input.hash ?? input.id}`,
      format,
      sourceName,
      sourceRef: input,
      sourceHash: input.hash,
      adapter: "text.extract",
      blocks: extractSections(raw, format).map((section) => ({
        ...section,
        kind: /^(?:#{1,6})\s+/u.test(section.text) ? ("heading" as const) : ("paragraph" as const),
      })),
    });
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const hash = contentHash(bytes);
    const out: ArtifactRef = {
      id: `document/extract/${hash}`,
      type: "document/content-package",
      storage: io.storage,
      format: "json",
      hash,
    };
    await binary.put(artifactPath(out), bytes);
    ctx.progress(1);
    return [out];
  }

  interface TypesetSection extends DocumentTranslationBlock {
    readonly lineCount: number;
    readonly overflow: boolean;
  }

  interface TypesetDocument {
    readonly version: 1;
    readonly adapter: "preview.typeset";
    readonly sourceContentId: string;
    readonly sourceName: string;
    readonly targetLanguage: string;
    readonly blocks: ReadonlyArray<TypesetSection>;
    readonly overflowCount: number;
  }

  async function readDocumentContentArtifact(
    ref: ArtifactRef,
    ctx: WorkerContext,
  ): Promise<DocumentContentPackage> {
    const decoded = decodeDocumentContentPackage(await readJsonArtifact<unknown>(ref, ctx));
    if (decoded === undefined) {
      throw new Error("document.extract Artifact 不是有效的 Content Package");
    }
    return decoded;
  }

  async function readDocumentTranslationArtifact(
    ref: ArtifactRef,
    ctx: WorkerContext,
  ): Promise<DocumentTranslationPackage> {
    const decoded = decodeDocumentTranslationPackage(await readJsonArtifact<unknown>(ref, ctx));
    if (decoded === undefined) {
      throw new Error("document.translate Artifact 不是有效的 Translation Package");
    }
    return decoded;
  }

  const fixtureDictionary: Readonly<Record<string, string>> = {
    "ここから、始めよう。": "就从这里开始吧。",
    もうすぐ春だね: "春天快到了呢",
    "見つけた！": "找到了！",
    静かな午後: "安静的午后",
    ページをめくる: "翻开下一页",
    "また明日。": "明天见。",
  };

  function fixtureTranslate(text: string): string {
    const normalized = text.replace(/\s+/gu, " ").trim();
    return (
      fixtureDictionary[normalized] ?? (normalized.length > 0 ? `待审校：${normalized}` : "待审校")
    );
  }

  async function documentTranslateFixture(
    task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
    ctx: WorkerContext,
  ): Promise<ReadonlyArray<ArtifactRef>> {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("document.translate requires a content package");
    const extracted = await readDocumentContentArtifact(input, ctx);
    ctx.progress(0.2);
    const blocks: DocumentTranslationBlock[] = [];
    for (const [index, section] of extracted.blocks.entries()) {
      throwIfAborted(ctx);
      blocks.push({
        ...section,
        translatedText: fixtureTranslate(section.text),
        status: "needs-review",
      });
      ctx.progress(0.2 + ((index + 1) / Math.max(1, extracted.blocks.length)) * 0.7);
    }
    const sourceLanguage = configString(task, "sourceLanguage") || extracted.metadata.language;
    const payload = createDocumentTranslationPackage({
      id: `translation/${extracted.id}/zh-Hans`,
      sourceContentId: extracted.id,
      sourceName: extracted.sourceName,
      format: extracted.format,
      ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
      targetLanguage: configString(task, "targetLanguage") || "zh-Hans",
      metadata: extracted.metadata,
      sourceRef: input,
      blocks,
      adapter: "fixture.translate",
    });
    const out = await writeTypedJsonArtifact(
      "document",
      "translations",
      "document/translation-package",
      payload,
    );
    ctx.progress(1);
    return [out];
  }

  async function documentTypesetPreview(
    task: { inputs: ReadonlyArray<ArtifactRef> },
    ctx: WorkerContext,
  ): Promise<ReadonlyArray<ArtifactRef>> {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("document.typeset requires a translation package");
    const translated = await readDocumentTranslationArtifact(input, ctx);
    ctx.progress(0.2);
    const blocks: TypesetSection[] = translated.blocks.map((section) => {
      const lineCount = Math.max(1, Math.ceil(section.translatedText.length / 28));
      return { ...section, lineCount, overflow: lineCount > 4 };
    });
    const overflowCount = blocks.filter((section) => section.overflow).length;
    throwIfAborted(ctx);
    const out = await writeTypedJsonArtifact(
      "document",
      "typeset-preview",
      "document/typeset-preview",
      {
        version: 1,
        adapter: "preview.typeset",
        sourceContentId: translated.sourceContentId,
        sourceName: translated.sourceName,
        targetLanguage: translated.targetLanguage,
        blocks,
        overflowCount,
      } satisfies TypesetDocument,
    );
    ctx.progress(1);
    return [out];
  }

  return { documentExtract, documentTranslateFixture, documentTypesetPreview };
}
