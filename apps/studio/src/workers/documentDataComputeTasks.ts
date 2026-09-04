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
import { createDataTablePackage, type DataCell, type DataFormat } from "@bcr/data-core";
import type { WorkerContext } from "@bcr/runtime-worker";
import {
  configString,
  DATA_MAX_BYTES,
  opfs,
  readJsonArtifact,
  sizeOf,
  throwIfAborted,
  WINDOW,
  writeJsonArtifact,
  writeTypedJsonArtifact,
} from "./computeShared";

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

function dataFormat(value: string): DataFormat {
  return value === "json" || value === "ndjson" ? value : "csv";
}

function dataCell(value: unknown): DataCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) return null;
    if (text === "true") return true;
    if (text === "false") return false;
    // Keep zero-padded identifiers as strings; only coerce canonical numbers.
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text)) {
      const number = Number(text);
      if (Number.isFinite(number)) return number;
    }
    return value.replace(/\r\n?/gu, "\n").trim();
  }
  return JSON.stringify(value);
}

function delimiterFor(line: string): string {
  const candidates = [",", "\t", ";", "|"];
  return (
    candidates
      .map((delimiter) => ({ delimiter, count: line.split(delimiter).length - 1 }))
      .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ","
  );
}

/** Small RFC 4180-compatible parser used only for the preview projection. */
function parseDelimited(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? "";
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && raw[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += character;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }
  return rows;
}

function objectRows(values: ReadonlyArray<unknown>): {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<DataCell>>;
} {
  const records = values.filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );
  if (records.length === values.length && records.length > 0) {
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
    return {
      columns,
      rows: records.map((record) => columns.map((column) => dataCell(record[column]))),
    };
  }
  const arrays = values.filter((value): value is ReadonlyArray<unknown> => Array.isArray(value));
  if (arrays.length === values.length && arrays.length > 0) {
    const width = Math.max(0, ...arrays.map((row) => row.length));
    return {
      columns: Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      rows: arrays.map((row) => Array.from({ length: width }, (_, index) => dataCell(row[index]))),
    };
  }
  return {
    columns: ["Value"],
    rows: values.map((value) => [dataCell(value)]),
  };
}

function parseStructuredData(
  raw: string,
  format: DataFormat,
): {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<DataCell>>;
} {
  if (format === "csv") {
    const parsed = parseDelimited(raw, delimiterFor(raw.split(/\r?\n/u)[0] ?? ""));
    const header = parsed[0] ?? [];
    return {
      columns: header.map((value, index) => value.trim() || `Column ${index + 1}`),
      rows: parsed.slice(1).map((row) => row.map(dataCell)),
    };
  }
  const values: unknown[] = [];
  if (format === "ndjson") {
    for (const line of raw.split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      try {
        values.push(JSON.parse(line) as unknown);
      } catch {
        values.push(line);
      }
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(raw);
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      values.push(raw);
    }
  }
  return objectRows(values);
}

async function readDataText(
  task: { config?: Record<string, unknown> | undefined },
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<{ readonly raw: string; readonly sampled: boolean }> {
  const total = sizeOf(task);
  const decoder = new TextDecoder();
  let raw = "";
  let offset = 0;
  let readBytes = 0;
  let sampled = false;
  while (offset < DATA_MAX_BYTES || total === 0) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    const remaining = DATA_MAX_BYTES - readBytes;
    if (remaining <= 0) {
      sampled = true;
      break;
    }
    const slice = chunk.byteLength > remaining ? chunk.slice(0, remaining) : chunk;
    raw += decoder.decode(slice, { stream: true });
    readBytes += slice.byteLength;
    offset += chunk.byteLength;
    if (slice.byteLength < chunk.byteLength) {
      sampled = true;
      break;
    }
    if (total > 0) ctx.progress(Math.min(0.72, (offset / total) * 0.72));
    if (chunk.byteLength < WINDOW) break;
  }
  raw += decoder.decode();
  if (total > DATA_MAX_BYTES) sampled = true;
  return { raw, sampled };
}

/** Parse a bounded preview while keeping the immutable source artifact intact. */
export async function dataParseTable(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("data.parse.table requires a source artifact");
  const format = dataFormat(configString(task, "format"));
  const { raw, sampled } = await readDataText(task, input, ctx);
  const parsed = parseStructuredData(raw, format);
  const table = createDataTablePackage({
    id: `data-table/${input.hash ?? input.id}`,
    format,
    sourceName: configString(task, "sourceName") || input.id,
    sourceRef: input,
    sourceHash: input.hash,
    columnNames: parsed.columns,
    rows: parsed.rows,
    sampled,
    createdAt: Date.now(),
  });
  ctx.progress(0.9);
  const out = await writeTypedJsonArtifact("data", "table", "data/table", table);
  ctx.progress(1);
  return [out];
}

/** Text/HTML/FB2 extraction: streamed source read → immutable JSON artifact. */
export async function documentExtract(
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
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(out), bytes);
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

export async function documentTranslateFixture(
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

export async function documentTypesetPreview(
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
  const out = await writeJsonArtifact("typeset-preview", {
    version: 1,
    adapter: "preview.typeset",
    sourceContentId: translated.sourceContentId,
    sourceName: translated.sourceName,
    targetLanguage: translated.targetLanguage,
    blocks,
    overflowCount,
  } satisfies TypesetDocument);
  ctx.progress(1);
  return [out];
}
