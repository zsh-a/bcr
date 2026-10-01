import { describe, expect, it, vi } from "vitest";
import { instrumentsFor, MarketTrendService, type MarketHistorySeries } from "../src";

const instrument = instrumentsFor("CN")[0]!;
const now = Date.UTC(2026, 9, 1);

function history(): MarketHistorySeries {
  return {
    instrument,
    range: "1M",
    bars: Array.from({ length: 30 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      timestamp: null,
      open: 100,
      high: 120,
      low: 90,
      close: 100 + index + (index % 2 ? 5 : -5),
      volume: 1_000,
      amount: null,
    })),
    quality: "delayed",
    receivedAt: now,
    source: "real upstream fixture",
    errors: [],
  };
}

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

describe("Real asset price trends", () => {
  it("sorts and deduplicates real closes, ignores invalid prices, and keeps the latest 20 sessions", async () => {
    const series = history();
    const loadHistory = vi.fn(async () => ({
      ...series,
      bars: [
        ...series.bars.toReversed(),
        { ...series.bars[0]!, close: NaN },
        { ...series.bars[29]!, close: 135 },
      ],
    }));
    const service = new MarketTrendService({ id: "fixture", loadHistory }, null, () => now);
    const result = await service.load(instrument);
    expect(loadHistory).toHaveBeenCalledWith({ instrument, range: "1M" }, undefined);
    expect(result?.quality).toBe("delayed");
    expect(result?.points).toHaveLength(20);
    expect(result?.points[0]).toEqual({ date: "2026-09-11", close: 105 });
    expect(result?.points.at(-1)).toEqual({ date: "2026-09-30", close: 135 });
    expect(result?.points.map((point) => point.close)).not.toEqual([100, 135]);
  });

  it("reuses a compact persistent cache for quote refreshes and reloads, then revalidates after one hour", async () => {
    let clock = now;
    const storage = memoryStorage();
    const loadHistory = vi.fn(async () => history());
    const provider = { id: "fixture", loadHistory };
    const service = new MarketTrendService(provider, storage, () => clock);
    await service.load(instrument);
    clock += 60_000;
    const cached = await service.load(instrument);
    expect(cached?.quality).toBe("cached");
    expect(cached?.receivedAt).toBe(now);
    const reloaded = await new MarketTrendService(provider, storage, () => clock).load(instrument);
    expect(reloaded?.points).toEqual(cached?.points);
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(storage.entries.size).toBe(1);
    expect([...storage.entries.values()][0]!.length).toBeLessThan(2_048);
    clock = now + 60 * 60_000;
    await service.load(instrument);
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it("retains real cache and its original timestamp on upstream failure, with a retry backoff", async () => {
    let clock = now;
    const loadHistory = vi
      .fn()
      .mockResolvedValueOnce(history())
      .mockRejectedValue(new Error("offline"));
    const service = new MarketTrendService({ id: "fixture", loadHistory }, null, () => clock);
    const live = await service.load(instrument);
    clock += 60 * 60_000;
    const stale = await service.load(instrument);
    expect(stale).toEqual({ ...live, quality: "cached" });
    await service.load(instrument);
    expect(loadHistory).toHaveBeenCalledTimes(2);
    clock += 5 * 60_000;
    await service.load(instrument);
    expect(loadHistory).toHaveBeenCalledTimes(3);
  });

  it("does not invent a curve when history is unavailable, simulated, or only two points long", async () => {
    const series = history();
    for (const loadHistory of [
      vi.fn(async () => {
        throw new Error("offline");
      }),
      vi.fn(async () => ({ ...series, quality: "demo" as const })),
      vi.fn(async () => ({ ...series, bars: series.bars.slice(0, 2) })),
    ]) {
      const storage = memoryStorage();
      const service = new MarketTrendService({ id: "fixture", loadHistory }, storage, () => now);
      expect(await service.load(instrument)).toBeNull();
      expect(await service.load(instrument)).toBeNull();
      expect(loadHistory).toHaveBeenCalledTimes(1);
      expect(storage.entries.size).toBe(0);
    }
  });

  it("rejects corrupt, simulated, unordered or mismatched cached prices", async () => {
    const storage = memoryStorage();
    const seed = new MarketTrendService(
      { id: "fixture", loadHistory: async () => history() },
      storage,
      () => now,
    );
    const trend = await seed.load(instrument);
    const key = [...storage.entries.keys()][0]!;
    for (const invalid of [
      "broken JSON",
      JSON.stringify({ storedAt: now, trend: { ...trend, quality: "demo" } }),
      JSON.stringify({ storedAt: now, trend: { ...trend, instrumentId: "different" } }),
      JSON.stringify({ storedAt: now, trend: { ...trend, points: trend!.points.toReversed() } }),
      JSON.stringify({
        storedAt: now,
        trend: { ...trend, points: [{ date: "invalid", close: 100 }] },
      }),
    ]) {
      storage.setItem(key, invalid);
      const loadHistory = vi.fn(async () => history());
      expect(
        await new MarketTrendService({ id: "fixture", loadHistory }, storage, () => now).load(
          instrument,
        ),
      ).toEqual(trend);
      expect(loadHistory).toHaveBeenCalledTimes(1);
    }
  });

  it("cancels before persisting or applying a failure backoff", async () => {
    const storage = memoryStorage();
    const abort = new AbortController();
    const loadHistory = vi.fn(async () => {
      if (loadHistory.mock.calls.length === 1) abort.abort();
      return history();
    });
    const service = new MarketTrendService({ id: "fixture", loadHistory }, storage, () => now);
    await expect(service.load(instrument, abort.signal)).rejects.toThrow();
    expect(storage.entries.size).toBe(0);
    expect(await service.load(instrument)).not.toBeNull();
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });
});
