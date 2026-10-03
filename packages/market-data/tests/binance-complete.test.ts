import { describe, expect, it } from "vitest";
import { completeMinuteArchive } from "../src/binance/complete";
import { DAY, MINUTE } from "../src/binance/model";
import { inspectMinuteCsv, parseMinuteCsv } from "../src/binance/parse";
import { candleArchive, type ArchiveWindow } from "../src/binance/plan";

const from = Date.UTC(2024, 1, 1),
  to = Date.UTC(2024, 2, 1);
const month: ArchiveWindow = { from, to, period: "monthly", date: "2024-02" };
function csv(start: number, end: number, missing = new Set<number>(), price = 100) {
  return Array.from({ length: (end - start) / MINUTE }, (_, i) => start + i * MINUTE)
    .filter((time) => !missing.has(time))
    .map(
      (time) =>
        `${time},${price},${price + 1},${price - 1},${price},1,${time + MINUTE - 1},keep-extra-fields`,
    )
    .join("\n");
}
function source(window: ArchiveWindow, data: string) {
  return { csv: data, url: candleArchive("BTCUSDT", window, true), checksum: "a".repeat(64) };
}

describe("verified Binance monthly calendar recovery", () => {
  it("restores leading, interior and trailing missing minutes by replacing entire official UTC days", async () => {
    const missing = new Set([from, from + 14 * DAY + 10 * MINUTE, to - MINUTE]);
    const original = source(
      month,
      "open_time,open,high,low,close,volume,close_time\n" + csv(from, to, missing),
    );
    const requested: string[] = [];
    const result = await completeMinuteArchive(original, month, async (window) => {
      requested.push(window.date);
      return source(window, csv(window.from, window.to, new Set(), 200));
    });
    expect(requested).toEqual(["2024-02-01", "2024-02-15", "2024-02-29"]);
    expect(result.replacements.map((r) => r.date)).toEqual(requested);
    const bars = parseMinuteCsv(result.csv);
    expect(bars).toHaveLength(29 * 1440);
    expect(bars.at(-1)?.time).toBe(to - MINUTE);
    expect(bars[1]?.open).toBe(200); // Complete daily replacement, not just a fabricated missing bar.
    expect(bars[1440]?.open).toBe(100);
    expect(result.csv).toContain("keep-extra-fields");
    expect(original.csv).not.toContain(",200,");
  });
  it("recovers a whole missing day and returns complete archives unchanged", async () => {
    const missing = new Set(Array.from({ length: 1440 }, (_, i) => from + DAY + i * MINUTE));
    const original = source(month, csv(from, to, missing));
    const repaired = await completeMinuteArchive(original, month, async (day) =>
      source(day, csv(day.from, day.to)),
    );
    expect(repaired.replacements).toHaveLength(1);
    const complete = source(month, repaired.csv);
    const result = await completeMinuteArchive(complete, month, async () => {
      throw new Error("unexpected download");
    });
    expect(result).toEqual({ csv: complete.csv, replacements: [] });
  });
  it("fails closed when the daily source is incomplete, unavailable or outside its date", async () => {
    const original = source(month, csv(from + MINUTE, to));
    await expect(
      completeMinuteArchive(original, month, async (day) =>
        source(day, csv(day.from + MINUTE, day.to)),
      ),
    ).rejects.toThrow("2024-02-01.zip：官方日档案仍缺少分钟");
    await expect(
      completeMinuteArchive(original, month, async () => {
        throw new Error("SHA-256 校验失败");
      }),
    ).rejects.toThrow("SHA-256");
    await expect(
      completeMinuteArchive(original, month, async (day) =>
        source(day, csv(day.from - MINUTE, day.to)),
      ),
    ).rejects.toThrow("日期之外");
  });
  it("never repairs corrupted quotes, empty values, duplicate timestamps or unordered rows", async () => {
    const one = csv(from, from + MINUTE),
      next = csv(from + MINUTE, from + 2 * MINUTE);
    for (const data of [
      one.replace(",101,", ",98,"),
      one.replace(",1,", ",,"),
      `${one}\n${one}`,
      `${next}\n${one}`,
      "",
    ]) {
      await expect(
        completeMinuteArchive(source(month, data), month, async () => {
          throw new Error("unexpected download");
        }),
      ).rejects.not.toThrow("unexpected download");
    }
    expect(
      inspectMinuteCsv(`${one}\n${csv(from + 2 * MINUTE, from + 3 * MINUTE)}`).bars,
    ).toHaveLength(2);
    expect(() => parseMinuteCsv(`${one}\n${csv(from + 2 * MINUTE, from + 3 * MINUTE)}`)).toThrow(
      "行情不连续",
    );
  });
});
