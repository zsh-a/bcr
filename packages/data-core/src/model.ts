import type { ArtifactRef } from "@bcr/core";

export type DataFormat = "csv" | "json" | "ndjson";
export type DataColumnType = "string" | "number" | "boolean" | "date" | "null";
export type DataCell = string | number | boolean | null;
export type DataRow = ReadonlyArray<DataCell>;

export interface DataColumn {
  readonly id: string;
  readonly name: string;
  readonly type: DataColumnType;
  readonly nullCount: number;
}

export interface DataTableProvenance {
  readonly adapter: string;
  readonly createdAt: number;
  readonly sourceHash?: string | undefined;
  readonly sampled: boolean;
}

/** Versioned, format-neutral table projection shared by Data and Quant. */
export interface DataTablePackage {
  readonly version: 1;
  readonly id: string;
  readonly format: DataFormat;
  readonly sourceName: string;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly rowCount: number;
  readonly columns: ReadonlyArray<DataColumn>;
  readonly rows: ReadonlyArray<DataRow>;
  readonly provenance: DataTableProvenance;
}

export interface DataTableInput {
  readonly id: string;
  readonly format: DataFormat;
  readonly sourceName: string;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly sourceHash?: string | undefined;
  readonly rows: ReadonlyArray<DataRow>;
  readonly columnNames?: ReadonlyArray<string> | undefined;
  readonly sampled?: boolean | undefined;
  readonly createdAt?: number | undefined;
}

const COLUMN_TYPES: ReadonlySet<DataColumnType> = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "null",
]);

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const name = value.replace(/\s+/gu, " ").trim();
  return name.length > 0 ? name.slice(0, 120) : fallback;
}

function cell(value: unknown): DataCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.replace(/\r\n?/gu, "\n").trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return String(value);
}

function typeOfCell(value: DataCell): DataColumnType {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (/^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/u.test(value)) return "date";
  return "string";
}

function mergeType(current: DataColumnType, next: DataColumnType): DataColumnType {
  if (next === "null") return current;
  if (current === "null") return next;
  if (current === next) return current;
  return "string";
}

function uniqueNames(names: ReadonlyArray<string>, count: number): ReadonlyArray<string> {
  const used = new Map<string, number>();
  return Array.from({ length: count }, (_, index) => {
    const base = cleanName(names[index], `Column ${index + 1}`);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base} ${seen + 1}`;
  });
}

/** Normalize cells, headers and inferred column types at the package boundary. */
export function createDataTablePackage(input: DataTableInput): DataTablePackage {
  const width = Math.max(input.columnNames?.length ?? 0, ...input.rows.map((row) => row.length), 0);
  const names = uniqueNames(input.columnNames ?? [], width);
  const rows = input.rows.map((row) =>
    Array.from({ length: width }, (_, index) => cell(row[index])),
  );
  const columns = Array.from({ length: width }, (_, index) => {
    let type: DataColumnType = "null";
    let nullCount = 0;
    for (const row of rows) {
      const value = row[index] ?? null;
      const valueType = typeOfCell(value);
      if (valueType === "null") nullCount += 1;
      type = mergeType(type, valueType);
    }
    return {
      id: `column-${index + 1}`,
      name: names[index] ?? `Column ${index + 1}`,
      type,
      nullCount,
    } satisfies DataColumn;
  });
  return {
    version: 1,
    id: input.id,
    format: input.format,
    sourceName: cleanName(input.sourceName, "Untitled data"),
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    rowCount: Math.max(0, input.rows.length),
    columns,
    rows,
    provenance: {
      adapter: "data.table.v1",
      createdAt: input.createdAt ?? Date.now(),
      ...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
      sampled: input.sampled === true,
    },
  };
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    (candidate.storage === "memory" ||
      candidate.storage === "shared-memory" ||
      candidate.storage === "opfs")
  );
}

function isDataCell(value: unknown): value is DataCell {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Strictly decode persisted table artifacts; malformed data never enters UI state. */
export function decodeDataTablePackage(value: unknown): DataTablePackage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DataTablePackage>;
  const rowCount = candidate.rowCount;
  if (
    candidate.version !== 1 ||
    typeof candidate.id !== "string" ||
    (candidate.format !== "csv" && candidate.format !== "json" && candidate.format !== "ndjson") ||
    typeof candidate.sourceName !== "string" ||
    typeof rowCount !== "number" ||
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    !Array.isArray(candidate.columns) ||
    !Array.isArray(candidate.rows) ||
    typeof candidate.provenance !== "object" ||
    candidate.provenance === null
  ) {
    return undefined;
  }
  const columns = candidate.columns.filter((column): column is DataColumn => {
    if (typeof column !== "object" || column === null) return false;
    const item = column as Partial<DataColumn>;
    const nullCount = item.nullCount;
    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.type === "string" &&
      COLUMN_TYPES.has(item.type as DataColumnType) &&
      typeof nullCount === "number" &&
      Number.isInteger(nullCount) &&
      nullCount >= 0
    );
  });
  if (columns.length !== candidate.columns.length) return undefined;
  const rows = candidate.rows.filter(
    (row): row is DataRow => Array.isArray(row) && row.every(isDataCell),
  );
  if (rows.length !== candidate.rows.length || rows.some((row) => row.length !== columns.length)) {
    return undefined;
  }
  const provenance = candidate.provenance as Partial<DataTableProvenance>;
  if (
    typeof provenance.adapter !== "string" ||
    typeof provenance.createdAt !== "number" ||
    !Number.isFinite(provenance.createdAt) ||
    typeof provenance.sampled !== "boolean"
  ) {
    return undefined;
  }
  const sourceRef = isArtifactRef(candidate.sourceRef) ? candidate.sourceRef : undefined;
  const sourceHash =
    typeof provenance.sourceHash === "string" && provenance.sourceHash.length > 0
      ? provenance.sourceHash
      : undefined;
  return {
    version: 1,
    id: candidate.id,
    format: candidate.format,
    sourceName: candidate.sourceName,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    rowCount,
    columns,
    rows,
    provenance: {
      adapter: provenance.adapter,
      createdAt: provenance.createdAt,
      ...(sourceHash === undefined ? {} : { sourceHash }),
      sampled: provenance.sampled,
    },
  };
}

export function dataTableStats(table: DataTablePackage): {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly numericColumns: number;
  readonly emptyCells: number;
} {
  return {
    rowCount: table.rowCount,
    columnCount: table.columns.length,
    numericColumns: table.columns.filter((column) => column.type === "number").length,
    emptyCells: table.columns.reduce((total, column) => total + column.nullCount, 0),
  };
}
