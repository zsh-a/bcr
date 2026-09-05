import { artifactPath, type ArtifactRef } from "@bcr/core";
import { createDataTablePackage, type DataCell, type DataFormat } from "@bcr/data-core";
import {
  configString,
  sizeOf,
  throwIfAborted,
  WINDOW,
  type ArtifactIO,
  type WorkerContext,
} from "@bcr/runtime-worker";
const DATA_MAX_BYTES = 16 * 1024 * 1024;

export function createDataCompute(io: ArtifactIO) {
  const { store: binary, writeTypedJsonArtifact } = io;
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
        rows: arrays.map((row) =>
          Array.from({ length: width }, (_, index) => dataCell(row[index])),
        ),
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
      const chunk = await binary.readRange(artifactPath(input), offset, WINDOW);
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
  async function dataParseTable(
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

  return { dataParseTable };
}
