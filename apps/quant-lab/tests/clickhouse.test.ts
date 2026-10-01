import { readFileSync } from "node:fs";
import { MemoryStore } from "@bcr/storage-opfs";
import { artifactPath } from "@bcr/core";
import { Table, RecordBatchStreamWriter, tableFromIPC, vectorFromArray, Utf8 } from "apache-arrow";
import { beforeAll, describe, expect, it } from "vitest";
import initQuant, { ClickHouseNormalizer } from "../../../crates/quant/pkg/bcr_quant.js";
import initKernels from "../../../crates/kernels/pkg/bcr_kernels.js";
import { loadClickHouse } from "../src/jsg/clickhouse-load";
import {
  clickHouseClient,
  normalizeConnection,
  prepareCalendar,
  publicProfile,
  ResponseTooLarge,
  type ClickHouseConnection,
} from "../src/jsg/clickhouse-http";

beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
  await initKernels({
    module_or_path: readFileSync(
      new URL("../../../crates/kernels/pkg/bcr_kernels_bg.wasm", import.meta.url),
    ),
  });
});
const connection: ClickHouseConnection = {
  url: "http://localhost:8123/",
  database: "stock_data",
  user: "reader",
  password: "test-session-secret",
};
const range = { start: "2024-01-02", end: "2024-01-12", strictPit: false, refresh: false };
const calendar: string[] = [];
for (let i = 0; i < 150; i++) {
  const d = new Date(Date.UTC(2023, 10, 1 + i));
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) calendar.push(d.toISOString().slice(0, 10));
}
function rawArrow(dates: string[], duplicate = false) {
  const entries = dates.flatMap((date) =>
    [0, 1].map((id) => ({
      date: Number(date.replaceAll("-", "")),
      code: duplicate ? "sz.001001" : `sz.00100${id + 1}`,
    })),
  );
  const n = entries.length;
  return new Table({
    date: vectorFromArray(new Uint32Array(entries.map((e) => e.date))),
    code: vectorFromArray(
      entries.map((e) => e.code),
      new Utf8(),
    ),
    industry_code: vectorFromArray(
      entries.map(() => "tech"),
      new Utf8(),
    ),
    ...Object.fromEntries(
      ["open", "high", "low", "close", "preclose", "adjfactor", "profit", "shares"].map((key) => [
        key,
        vectorFromArray(new Float64Array(n).fill(key === "adjfactor" ? 1 : 10)),
      ]),
    ),
    is_st: vectorFromArray(new Uint8Array(n)),
    tradable: vectorFromArray(new Uint8Array(n).fill(1)),
    breadth_member: vectorFromArray(new Uint8Array(n).fill(1)),
    selection_member: vectorFromArray(new Uint8Array(n).fill(1)),
  });
}
const json = (rows: unknown[]) =>
  new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
function fixtureFetch(onArrow?: (index: number) => void) {
  const requests: string[] = [];
  let arrowCount = 0;
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const sql = options?.body;
    if (typeof sql !== "string") throw new Error("expected SQL request body");
    requests.push(sql);
    expect(url.searchParams.get("readonly")).toBe("1");
    expect(url.searchParams.get("output_format_arrow_compression_method")).toBe("none");
    expect(url.username).toBe("");
    expect(url.searchParams.has("password")).toBe(false);
    if (sql.includes("FORMAT ArrowStream")) {
      onArrow?.(++arrowCount);
      const selected = calendar.filter(
        (d) => d >= url.searchParams.get("param_start")! && d <= url.searchParams.get("param_end")!,
      );
      const bytes = RecordBatchStreamWriter.writeAll(rawArrow(selected)).toUint8Array(true);
      // Chunks are deliberately unrelated to either IPC message or trading-day boundaries.
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 97)
              controller.enqueue(bytes.slice(offset, offset + 97));
            controller.close();
          },
        }),
      );
    }
    if (sql.includes("version()")) return json([{ version: "fixture" }]);
    if (sql.includes("min(date)"))
      return json([{ firstDate: calendar[0], lastDate: calendar.at(-1) }]);
    if (sql.includes("system.columns")) return json([]);
    if (sql.includes("ORDER BY calendar_date DESC"))
      return json(
        calendar
          .slice(-2)
          .reverse()
          .map((date) => ({ date })),
      );
    if (sql.includes("FROM trade_dates")) return json(calendar.map((date) => ({ date })));
    if (sql.includes("DISTINCT code")) return json([{ code: "sz.001001" }, { code: "sz.001002" }]);
    if (sql.includes("DISTINCT industry_code")) return json([{ industry_code: "tech" }]);
    throw new Error("unexpected fixture query");
  };
  return { fetcher, requests };
}

describe("ClickHouse browser snapshots", () => {
  it("reuses stable full-calendar partitions for overlapping ranges without mixing refreshed generations", async () => {
    const store = new MemoryStore();
    const fixture = fixtureFetch();
    const signal = new AbortController().signal;
    const load = (selected = range) =>
      loadClickHouse(connection, selected, store, signal, () => undefined, fixture.fetcher);
    const first = await load();
    const extendedRange = { ...range, start: "2024-01-03", end: "2024-01-19" };
    const extended = await load(extendedRange);
    expect(extended.dataset.snapshot?.reusedPartitions).toBeGreaterThan(0);
    expect(
      extended.dataset.partitions.some((p) =>
        first.dataset.partitions.some((old) => old.id === p.id),
      ),
    ).toBe(true);
    expect(extended.dataset.snapshot?.timings?.["reusedBytes"]).toBeGreaterThan(0);
    const refreshed = await load({ ...range, refresh: true });
    expect(refreshed.dataset.snapshot?.reusedPartitions).toBe(0);
    const reloaded = await load(extendedRange);
    expect(reloaded.cached).toBe(false);
    expect(
      reloaded.dataset.partitions.every(
        (p) => !extended.dataset.partitions.some((old) => old.id === p.id),
      ),
    ).toBe(true);
    expect(
      reloaded.dataset.partitions.some((p) =>
        refreshed.dataset.partitions.some((fresh) => fresh.id === p.id),
      ),
    ).toBe(true);
    for (const ref of first.dataset.partitions)
      expect(await store.has(artifactPath(ref))).toBe(true);
  });
  it("rolls back snapshot and generation pointers if partition-index publication fails", async () => {
    const store = new MemoryStore();
    const fixture = fixtureFetch();
    const signal = new AbortController().signal;
    const first = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      fixture.fetcher,
    );
    const before = new Map<string, Uint8Array>();
    for (const path of await store.list("cache/")) before.set(path, (await store.get(path))!);
    const put = store.put.bind(store);
    let fail = true;
    store.put = async (path, bytes) => {
      if (fail && path.startsWith("cache/jsg-partitions/")) {
        fail = false;
        throw new Error("fixture disk failure");
      }
      await put(path, bytes);
    };
    await expect(
      loadClickHouse(
        connection,
        { ...range, refresh: true },
        store,
        signal,
        () => undefined,
        fixture.fetcher,
      ),
    ).rejects.toThrow("fixture disk failure");
    for (const [path, bytes] of before) expect(await store.get(path)).toEqual(bytes);
    const restored = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      async () => {
        throw new Error("unexpected network");
      },
    );
    expect(restored.cached).toBe(true);
    expect(restored.dataset).toEqual(first.dataset);
    expect(await store.list("temp/")).toEqual([]);
  });
  it("reassembles complete days across raw IPC batches and rejects duplicate/missing daily rows", () => {
    const normalizer = new ClickHouseNormalizer('["sz.001001","sz.001002"]', '["tech"]');
    const source = rawArrow(["2024-01-02", "2024-01-03"]);
    const batch = source.batches[0]!;
    const bytes = RecordBatchStreamWriter.writeAll(
      new Table([batch.slice(0, 1), batch.slice(1, 3), batch.slice(3)]),
    ).toUint8Array(true);
    const output = normalizer.normalize(bytes, "[20240102,20240103]");
    expect(tableFromIPC(output).batches.map((b) => b.numRows)).toEqual([2, 2]);
    expect(normalizer.rows()).toBe(4);
    expect(() => normalizer.normalize(bytes, "[20240102,20240103,20240104]")).toThrow();
    expect(() =>
      normalizer.normalize(
        RecordBatchStreamWriter.writeAll(rawArrow(["2024-01-02"], true)).toUint8Array(true),
        "[20240102]",
      ),
    ).toThrow();
    normalizer.free();
  });
  it("uses the full trading calendar across holidays and truncated week ends", () => {
    const all = calendar.filter((d) => d !== "2024-01-05");
    const prepared = prepareCalendar(all, "2024-01-02", "2024-01-11");
    expect(prepared.sessions.find((s) => s.date === 20240104)?.rebalance).toBe(true);
    expect(prepared.sessions.at(-1)?.rebalance).toBe(false);
    expect(prepared.dates.length).toBe(30 + 7);
    expect(() => prepareCalendar(all, range.start, all.at(-1)!)).toThrow(/日历/u);
    expect(() => prepareCalendar(all, "2024-02-30", range.end)).toThrow();
  });
  it("loads streamed snapshots and reuses a complete cache without any network or credential persistence", async () => {
    const store = new MemoryStore();
    const fixture = fixtureFetch();
    const signal = new AbortController().signal;
    const loaded = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      fixture.fetcher,
    );
    expect(loaded.cached).toBe(false);
    expect(loaded.dataset.manifest.calendar.length).toBe(39);
    expect(loaded.dataset.manifest.partitions.reduce((n, p) => n + p.rows, 0)).toBe(78);
    const count = fixture.requests.length;
    const cached = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      fixture.fetcher,
      () => {
        throw new Error("must not request permission for cached data");
      },
    );
    expect(cached.cached).toBe(true);
    expect(cached.dataset).toEqual(loaded.dataset);
    expect(fixture.requests.length).toBe(count);
    for (const path of await store.list()) {
      expect(new TextDecoder().decode(await store.get(path))).not.toContain(connection.password);
      expect(path).not.toContain(connection.password);
    }
    expect(await store.list("temp/")).toEqual([]);
  });
  it("cancellation removes owned partial artifacts without publishing a snapshot", async () => {
    const store = new MemoryStore();
    const abort = new AbortController();
    const fixture = fixtureFetch((i) => {
      if (i === 2) abort.abort();
    });
    await expect(
      loadClickHouse(connection, range, store, abort.signal, () => undefined, fixture.fetcher),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
  it("a failed refresh preserves the previously usable snapshot", async () => {
    const store = new MemoryStore();
    const signal = new AbortController().signal;
    const original = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      fixtureFetch().fetcher,
    );
    const paths = await store.list();
    const failed = fixtureFetch((i) => {
      if (i === 2) throw new Error("source disconnected");
    });
    await expect(
      loadClickHouse(
        connection,
        { ...range, refresh: true },
        store,
        signal,
        () => undefined,
        failed.fetcher,
      ),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(paths);
    const restored = await loadClickHouse(
      connection,
      range,
      store,
      signal,
      () => undefined,
      failed.fetcher,
    );
    expect(restored.cached).toBe(true);
    expect(restored.dataset).toEqual(original.dataset);
  });
  it("rejects incomplete strict data rather than relabeling a snapshot as historical", async () => {
    const store = new MemoryStore();
    await expect(
      loadClickHouse(
        connection,
        { ...range, strictPit: true },
        store,
        new AbortController().signal,
        () => undefined,
        fixtureFetch().fetcher,
      ),
    ).rejects.toThrow(/源库/u);
    expect(await store.list()).toEqual([]);
  });
  it("retries oversized responses with shorter trading-day windows and retains every session", async () => {
    const store = new MemoryStore();
    const fixture = fixtureFetch();
    let oversized = false;
    const fetcher: typeof fetch = (input, options) => {
      if (
        !oversized &&
        typeof options?.body === "string" &&
        options.body.includes("FORMAT ArrowStream")
      ) {
        oversized = true;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                const chunk = new Uint8Array(1024 * 1024);
                for (let i = 0; i < 33; i++) c.enqueue(chunk);
                c.close();
              },
            }),
          ),
        );
      }
      return fixture.fetcher(input, options);
    };
    const result = await loadClickHouse(
      connection,
      range,
      store,
      new AbortController().signal,
      () => undefined,
      fetcher,
    );
    expect(oversized).toBe(true);
    expect(result.dataset.manifest.partitions.every((p) => p.bytes <= 32 * 1024 * 1024)).toBe(true);
    const actualDates: number[] = [];
    for (const ref of result.dataset.partitions) {
      const batches = tableFromIPC((await store.get(artifactPath(ref)))!).batches;
      actualDates.push(...batches.map((b) => Number(b.getChild("date")!.get(0))));
    }
    expect(actualDates).toEqual(result.dataset.manifest.calendar.map((s) => s.date));
    expect(result.dataset.manifest.partitions.reduce((n, p) => n + p.rows, 0)).toBe(78);
    expect(result.dataset.manifest.calendar).toHaveLength(39);
    expect(await store.list("temp/")).toEqual([]);
  });
  it("bounds network streams and never includes credentials in URLs or saved profiles", async () => {
    expect(() =>
      normalizeConnection({ ...connection, url: "http://user:password@localhost:8123/" }),
    ).toThrow();
    expect(() =>
      normalizeConnection({ ...connection, database: "stock_data; SELECT 1" }),
    ).toThrow();
    expect(publicProfile(connection, range)).not.toHaveProperty("password");
    const client = clickHouseClient(
      connection,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(32 * 1024 * 1024 + 1));
              c.close();
            },
          }),
        ),
    );
    const stream = await client.arrow(
      "SELECT 1 FORMAT ArrowStream",
      {},
      new AbortController().signal,
      () => undefined,
    );
    await expect(new MemoryStore().putStream("temporary", stream)).rejects.toBeInstanceOf(
      ResponseTooLarge,
    );
  });
});
