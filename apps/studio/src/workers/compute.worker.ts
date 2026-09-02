import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import init, { peak_f32, StreamingBlake3 } from "../../../../crates/kernels/pkg/bcr_kernels.js";

/**
 * compute.worker（架构文档 §5）：Worker 内加载 Rust WASM kernel。
 * 大文件按 4MB 窗口从 OPFS 流动读取（§4），禁止整段装载。
 */

const WINDOW = 4 * 1024 * 1024;
const WAVEFORM_BUCKETS = 2048;
const opfs = new OpfsStore("studio");

const wasmReady = init();

function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

function sizeOf(task: { config?: Record<string, unknown> | undefined }): number {
  const size = task.config?.["sizeBytes"];
  return typeof size === "number" && size > 0 ? size : 0;
}

async function hashBlake3(
  task: { config?: Record<string, unknown> | undefined },
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const total = sizeOf(task);
  const hasher = new StreamingBlake3();
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    hasher.update(chunk);
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.99, offset / total));
  }
  const hex = hasher.finalize_hex();
  const bytes = new TextEncoder().encode(hex);
  const out: ArtifactRef = {
    id: `hash/${hex}`,
    type: "hash/blake3-hex",
    storage: "opfs",
    hash: hex,
  };
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}

/** 波形提取：按 f32le PCM 分窗，折叠为 2048 桶峰值包络。 */
async function audioWaveform(
  task: { config?: Record<string, unknown> | undefined },
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const total = sizeOf(task);
  // 自适应窗口：每桶至少覆盖一个窗口；小文件用 64KB 细窗，大文件按桶均分
  const window = total > 0 ? Math.max(64 * 1024, Math.ceil(total / WAVEFORM_BUCKETS)) : WINDOW;
  const peaks = new Float32Array(WAVEFORM_BUCKETS);
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, window);
    if (chunk.byteLength < 4) break;
    const samples = new Float32Array(
      chunk.buffer.slice(0, chunk.byteLength - (chunk.byteLength % 4)),
    );
    const windowPeak = peak_f32(samples);
    if (total > 0) {
      const from = Math.floor((offset / total) * WAVEFORM_BUCKETS);
      const to = Math.min(
        WAVEFORM_BUCKETS - 1,
        Math.floor(((offset + chunk.byteLength) / total) * WAVEFORM_BUCKETS),
      );
      for (let i = from; i <= to; i += 1) {
        peaks[i] = Math.max(peaks[i] ?? 0, windowPeak);
      }
    }
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.99, offset / total));
  }
  const bytes = new Uint8Array(peaks.buffer);
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `waveform/${hash}`,
    type: "audio/waveform-peaks",
    storage: "opfs",
    format: "f32le",
    hash,
  };
  // Studio 声明支持跨刷新缓存命中，因此小产物也必须持久化，不能只留在 memory store。
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}

interface ExtractedSection {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  readonly text: string;
}

interface ExtractedDocument {
  readonly version: 1;
  readonly format: string;
  readonly sourceName: string;
  readonly sections: ReadonlyArray<ExtractedSection>;
}

function configString(task: { config?: Record<string, unknown> | undefined }, key: string): string {
  const value = task.config?.[key];
  return typeof value === "string" ? value : "";
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
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    raw += decoder.decode(chunk, { stream: true });
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.92, offset / total));
  }
  raw += decoder.decode();
  const payload: ExtractedDocument = {
    version: 1,
    format: configString(task, "format"),
    sourceName: configString(task, "sourceName"),
    sections: extractSections(raw, configString(task, "format")),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `document/extract/${hash}`,
    type: "document/sections",
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}

interface TranslatedSection extends ExtractedSection {
  readonly translatedText: string;
  readonly status: "needs-review";
}

interface TranslatedDocument {
  readonly version: 1;
  readonly adapter: "fixture.translate";
  readonly sourceName: string;
  readonly sections: ReadonlyArray<TranslatedSection>;
}

interface TypesetSection extends TranslatedSection {
  readonly lineCount: number;
  readonly overflow: boolean;
}

interface TypesetDocument {
  readonly version: 1;
  readonly adapter: "preview.typeset";
  readonly sourceName: string;
  readonly sections: ReadonlyArray<TypesetSection>;
  readonly overflowCount: number;
}

async function readJsonArtifact<T>(ref: ArtifactRef, ctx: WorkerContext): Promise<T> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(ref), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    chunks.push(chunk);
    offset += chunk.byteLength;
  }
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function writeJsonArtifact(kind: string, payload: unknown): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `document/${kind}/${hash}`,
    type: `document/${kind}`,
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(out), bytes);
  return out;
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
  task: { inputs: ReadonlyArray<ArtifactRef> },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.translate requires extracted sections");
  const extracted = await readJsonArtifact<ExtractedDocument>(input, ctx);
  ctx.progress(0.2);
  const sections: TranslatedSection[] = [];
  for (const [index, section] of extracted.sections.entries()) {
    throwIfAborted(ctx);
    sections.push({
      ...section,
      translatedText: fixtureTranslate(section.text),
      status: "needs-review",
    });
    ctx.progress(0.2 + ((index + 1) / Math.max(1, extracted.sections.length)) * 0.7);
  }
  const out = await writeJsonArtifact("translations", {
    version: 1,
    adapter: "fixture.translate",
    sourceName: extracted.sourceName,
    sections,
  } satisfies TranslatedDocument);
  ctx.progress(1);
  return [out];
}

async function documentTypesetPreview(
  task: { inputs: ReadonlyArray<ArtifactRef> },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.typeset requires translated sections");
  const translated = await readJsonArtifact<TranslatedDocument>(input, ctx);
  ctx.progress(0.2);
  const sections: TypesetSection[] = translated.sections.map((section) => {
    const lineCount = Math.max(1, Math.ceil(section.translatedText.length / 28));
    return { ...section, lineCount, overflow: lineCount > 4 };
  });
  const overflowCount = sections.filter((section) => section.overflow).length;
  throwIfAborted(ctx);
  const out = await writeJsonArtifact("typeset-preview", {
    version: 1,
    adapter: "preview.typeset",
    sourceName: translated.sourceName,
    sections,
    overflowCount,
  } satisfies TypesetDocument);
  ctx.progress(1);
  return [out];
}

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
  "document.translate.fixture": (task, ctx) => documentTranslateFixture(task, ctx),
  "document.typeset.preview": (task, ctx) => documentTypesetPreview(task, ctx),
});
