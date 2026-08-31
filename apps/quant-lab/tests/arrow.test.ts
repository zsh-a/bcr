import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";
import { decodeMarketArrow, encodeMarketArrow } from "../src/arrow";
import { generateDemoMarket } from "../src/engine";

describe("Quant Arrow format", () => {
  it("以稳定 schema 编码并无损恢复 OHLCV 批次", () => {
    const bars = generateDemoMarket(96);
    const bytes = encodeMarketArrow(bars);
    const table = tableFromIPC(bytes);

    expect(table.numRows).toBe(96);
    expect(table.schema.fields.map((field) => field.name)).toEqual([
      "date",
      "open",
      "high",
      "low",
      "close",
      "volume",
    ]);
    expect(decodeMarketArrow(bytes)).toEqual(bars);
  });

  it("拒绝损坏的 Arrow IPC", () => {
    expect(() => decodeMarketArrow(new Uint8Array([1, 2, 3, 4]))).toThrow("Arrow");
  });
});
