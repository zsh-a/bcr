import { describe, expect, it } from "vitest";
import { createDataTablePackage, dataTableStats, decodeDataTablePackage } from "../src";

describe("data table package", () => {
  it("normalizes columns, duplicate names and inferred types", () => {
    const table = createDataTablePackage({
      id: "table-1",
      format: "csv",
      sourceName: "metrics.csv",
      columnNames: ["Date", "Value", "Value"],
      rows: [
        ["2026-09-01", 12, true],
        ["2026-09-02", null, false],
      ],
      sampled: true,
    });
    expect(table.columns.map((column) => [column.name, column.type])).toEqual([
      ["Date", "date"],
      ["Value", "number"],
      ["Value 2", "boolean"],
    ]);
    expect(dataTableStats(table)).toMatchObject({
      rowCount: 2,
      columnCount: 3,
      numericColumns: 1,
      emptyCells: 1,
    });
    expect(decodeDataTablePackage(table)).toEqual(table);
  });

  it("rejects malformed rows and package metadata", () => {
    expect(decodeDataTablePackage({ version: 1, rows: [] })).toBeUndefined();
    const table = createDataTablePackage({
      id: "table-2",
      format: "json",
      sourceName: "data.json",
      rows: [["ok"]],
    });
    expect(
      decodeDataTablePackage({
        ...table,
        rows: [["ok", "extra"]],
      }),
    ).toBeUndefined();
  });
});
