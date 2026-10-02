import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { downloadArchive } from "../src/binance/archive";
import { DAY, defaultBinanceRequest, validateBinanceRequest } from "../src/binance/model";
import { parseFundingCsv, parseMinuteCsv } from "../src/binance/parse";
import { candleWindows, fundingMonths } from "../src/binance/plan";
import { aggregateMinuteBars } from "../src/binance/timeframe";

const time = Date.UTC(2024, 0, 1);
const csv = `${time},100,101,99,100,1,${time + 59999},0,1,0,0,0\n`;
describe("Binance official archive data", () => {
  it("plans extra warmup without extending the requested funding or trade window", () => {
    const request = { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01", warmupDays: 3 };
    const range = validateBinanceRequest(request);
    expect(range.warmup).toBe(time - 3 * DAY);
    expect(range.start).toBe(time);
    expect(candleWindows(request).reduce((n, w) => n + w.to - w.from, 0)).toBe(4 * DAY);
    expect(fundingMonths(request)).toEqual(["2024-01"]);
    for (const days of [0, 1.5, 251, NaN])
      expect(() => validateBinanceRequest({ ...request, warmupDays: days })).toThrow();
  });
  it("aggregates OHLCV on UTC boundaries and omits incomplete candles", () => {
    const bars = Array.from({ length: 11 }, (_, i) => ({
      time: time + i * 60000,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: i + 1,
    }));
    expect(aggregateMinuteBars(bars, 5)).toEqual([
      { time, open: 100, high: 106, low: 99, close: 105, volume: 15 },
      { time: time + 300000, open: 105, high: 111, low: 104, close: 110, volume: 40 },
    ]);
    expect(aggregateMinuteBars(bars.slice(2), 5)).toHaveLength(1);
    expect(() => aggregateMinuteBars([bars[0]!, bars[2]!], 5)).toThrow("连续");
  });
  it("uses complete monthly windows and daily edges, including one warmup day", () => {
    const windows = candleWindows({ symbol: "BTCUSDT", start: "2024-01-01", end: "2024-02-29" });
    expect(windows.map((w) => [w.period, w.date])).toEqual([
      ["daily", "2023-12-31"],
      ["monthly", "2024-01"],
      ["monthly", "2024-02"],
    ]);
    expect(windows.reduce((n, w) => n + w.to - w.from, 0)).toBe(61 * DAY);
    expect(fundingMonths({ symbol: "BTCUSDT", start: "2024-01-31", end: "2024-02-01" })).toEqual([
      "2024-01",
      "2024-02",
    ]);
  });
  it("chooses a published funding month and rejects invalid dates, future dates and spot symbols", () => {
    expect(defaultBinanceRequest(new Date("2026-10-02T00:00:00Z"))).toEqual({
      symbol: "BTCUSDT",
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(() =>
      validateBinanceRequest({ symbol: "BTCUSDT", start: "2024-02-30", end: "2024-03-01" }),
    ).toThrow();
    expect(() =>
      validateBinanceRequest({ symbol: "BTCUSD", start: "2024-01-01", end: "2024-01-01" }),
    ).toThrow();
    expect(() =>
      validateBinanceRequest({ symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01" }, time),
    ).toThrow();
  });
  it("accepts USD-M millisecond CSVs with or without headers and rejects microseconds or gaps", () => {
    expect(parseMinuteCsv(csv)[0]?.time).toBe(time);
    expect(parseMinuteCsv("open_time,open,high,low,close,volume,close_time\n" + csv)).toHaveLength(
      1,
    );
    expect(() => parseMinuteCsv(csv.replace(String(time), String(time * 1000)))).toThrow();
    expect(() =>
      parseMinuteCsv(
        csv +
          csv
            .replace(String(time), String(time + 120000))
            .replace(String(time + 59999), String(time + 179999)),
      ),
    ).toThrow();
    expect(() => parseMinuteCsv(csv.replace(",101,", ",98,"))).toThrow();
  });
  it("preserves signed funding and exact settlement timestamps", () => {
    expect(
      parseFundingCsv(`calc_time,funding_interval_hours,last_funding_rate\n${time + 1},8,-0.0001`),
    ).toEqual([{ time: time + 1, intervalHours: 8, rate: -0.0001 }]);
    expect(() => parseFundingCsv(`${time},8,NaN`)).toThrow();
    expect(() => parseFundingCsv(`${time},8,.001\n${time},8,.001`)).toThrow();
  });
  it("validates the downloaded ZIP before exposing its CSV", async () => {
    const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await zip.add("BTCUSDT-1m-2024-01-01.csv", new TextReader(csv), { level: 0 });
    const bytes = await zip.close();
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const fetcher = (checksum: string) =>
      (async (url: string | URL | Request) =>
        (url instanceof Request ? url.url : url.toString()).endsWith("CHECKSUM")
          ? new Response(`${checksum}  archive.zip`)
          : new Response(bytes)) as typeof fetch;
    const signal = new AbortController().signal;
    expect(
      (await downloadArchive("https://data.binance.vision/archive.zip", signal, fetcher(hash))).csv,
    ).toBe(csv);
    await expect(
      downloadArchive("https://data.binance.vision/archive.zip", signal, fetcher("0".repeat(64))),
    ).rejects.toThrow("SHA-256");
    await expect(
      downloadArchive(
        "https://data.binance.vision/archive.zip",
        signal,
        (async () => new Response(null, { status: 404 })) as typeof fetch,
      ),
    ).rejects.toThrow("404");
  });
});
