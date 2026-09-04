import type { DataCell, DataTablePackage } from "@bcr/data-core";

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function tableSearchPreview(table: DataTablePackage): string {
  return table.rows
    .slice(0, 24)
    .flatMap((row) => row.map((value) => (value === null ? "" : String(value))))
    .join(" ")
    .slice(0, 24_000);
}

function escapeCsv(value: DataCell): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function download(text: string, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function downloadDataTable(table: DataTablePackage, format: "csv" | "json"): void {
  if (format === "json") {
    download(JSON.stringify(table, null, 2), `${table.sourceName}.table.json`, "application/json");
    return;
  }
  const csv = [
    table.columns.map((column) => escapeCsv(column.name)).join(","),
    ...table.rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");
  download(csv, `${table.sourceName}.preview.csv`, "text/csv;charset=utf-8");
}
