import { describe, expect, it } from "vitest";
import { clickHouseClient, DEFAULT_CONNECTION, type MetadataRow } from "../src/jsg/clickhouse-http";
import { loadDisplayNames, nameQueries, namesCacheKey } from "../src/jsg/clickhouse-names";
import {
  displayLabel,
  displayName,
  EMPTY_DISPLAY_NAMES,
  nameMatches,
  mergeDisplayNames,
  parseDisplayNames,
  subsetNames,
} from "../src/jsg/display-names";
import { demoResearch } from "../src/jsg/demo";
import { parseManifest } from "../src/jsg/model";

const columns = (table: string, names: string[]) => names.map((name) => ({ table, name }));
describe("research display names", () => {
  it("reads the latest nonblank names using either industry schema, independently of trading dates", async () => {
    for (const sectorColumn of ["industry_name", "industry"]) {
      const queries: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (typeof init?.body !== "string") throw new Error("expected SQL body");
        const sql = init.body;
        queries.push(sql);
        expect(url.searchParams.get("readonly")).toBe("1");
        const rows = sql.includes("system.columns")
          ? [
              ...columns("stock_daily_meta", ["code", "name", "last_update_date"]),
              ...columns("industry_info", ["industry_code", sectorColumn, "enter_date"]),
            ]
          : sql.includes("FROM stock_daily_meta")
            ? [{ code: "sz.002316", display_name: "亚联发展" }]
            : [{ code: "801790", display_name: "非银金融" }];
        return new Response(rows.map((row) => JSON.stringify(row)).join("\n"));
      };
      const names = await loadDisplayNames(
        clickHouseClient(DEFAULT_CONNECTION, fetcher),
        new AbortController().signal,
      );
      expect(displayLabel(names, "instruments", "sz.002316")).toBe("亚联发展 · sz.002316");
      expect(displayLabel(names, "industries", "801790")).toBe("非银金融 · 801790");
      expect(queries.find((sql) => sql.includes("FROM industry_info"))).toContain(
        `ifNull(${sectorColumn},'')`,
      );
      expect(queries.every((sql) => !sql.includes("stock_daily FINAL"))).toBe(true);
      expect(Number.isFinite(Date.parse(names.capturedAt!))).toBe(true);
    }
  });
  it("does not query missing optional tables and falls back from an empty industry_name", () => {
    expect(nameQueries([])).toEqual({ instruments: undefined, industries: undefined });
    const sql = nameQueries([
      ...columns("industry_info", ["industry_code", "industry_name", "industry"]),
    ]).industries;
    expect(sql).toContain("coalesce(nullIf(");
    expect(sql).not.toContain("enter_date");
  });
  it("skips malformed optional labels without losing valid stocks or any industry names", async () => {
    const json = async (sql: string): Promise<MetadataRow[]> =>
      sql.includes("system.columns")
        ? [
            ...columns("stock_daily_meta", ["code", "name"]),
            ...columns("industry_info", ["industry_code", "industry_name"]),
          ]
        : sql.includes("FROM stock_daily_meta")
          ? [
              {
                code: "510050",
                display_name: "code\n510050    上证50ETF\nName: name, dtype: object",
              },
              { code: "sz.002316", display_name: " ST亚联 " },
              { code: "empty", display_name: " " },
              { code: "long", display_name: "名".repeat(201) },
              { code: "control", display_name: "无效\u007f名称" },
              { code: "invalid", display_name: null },
              { code: "", display_name: "无代码" },
            ]
          : [
              { code: "801790", display_name: "非银金融" },
              { code: "801960", display_name: "石油石化" },
            ];
    const names = await loadDisplayNames(
      { connection: DEFAULT_CONNECTION, json },
      new AbortController().signal,
    );
    expect(names.instruments).toEqual({ "sz.002316": "ST亚联" });
    expect(names.industries).toEqual({ "801790": "非银金融", "801960": "石油石化" });
    expect(displayLabel(names, "instruments", "510050")).toBe("510050");
    expect(() =>
      parseDisplayNames({ instruments: { "510050": "code\n510050    上证50ETF" }, industries: {} }),
    ).toThrow();
  });
  it("preserves cached valid labels when a refresh omits a malformed source record", () => {
    const cached = {
      instruments: { "510050": "上证50ETF", "sz.002316": "亚联发展" },
      industries: { "801790": "非银金融" },
      capturedAt: "2026-09-01T00:00:00Z",
    };
    const loaded = {
      instruments: { "sz.002316": "ST亚联" },
      industries: { "801960": "石油石化" },
      capturedAt: "2026-10-01T00:00:00Z",
    };
    expect(mergeDisplayNames(cached, loaded)).toEqual({
      instruments: { "510050": "上证50ETF", "sz.002316": "ST亚联" },
      industries: { "801790": "非银金融", "801960": "石油石化" },
      capturedAt: loaded.capturedAt,
    });
    expect(cached.instruments["sz.002316"]).toBe("亚联发展");
  });
  it("rejects ambiguous duplicate source names and invalid snapshot dictionaries", async () => {
    const json = async (sql: string): Promise<MetadataRow[]> =>
      sql.includes("system.columns")
        ? columns("stock_daily_meta", ["code", "name"])
        : [
            { code: "A", display_name: "甲" },
            { code: "A", display_name: "乙" },
          ];
    await expect(
      loadDisplayNames({ connection: DEFAULT_CONNECTION, json }, new AbortController().signal),
    ).rejects.toThrow("重复");
    expect(() => parseDisplayNames({ instruments: { A: " \n" }, industries: {} })).toThrow();
    expect(() =>
      parseDisplayNames({ instruments: {}, industries: {}, capturedAt: "not-a-date" }),
    ).toThrow();
  });
  it("preserves names on manifest round trips and requires the original code identities", () => {
    const manifest = demoResearch().manifest;
    expect(parseManifest(JSON.parse(JSON.stringify(manifest))).displayNames).toEqual(
      manifest.displayNames,
    );
    expect(() =>
      parseManifest({
        ...manifest,
        displayNames: { instruments: { absent: "错误证券" }, industries: {} },
      }),
    ).toThrow("不属于");
    expect(
      subsetNames(
        { instruments: { A: "甲", B: "乙" }, industries: { tech: "科技", bank: "银行" } },
        ["B"],
        ["tech"],
      ),
    ).toEqual({ instruments: { B: "乙" }, industries: { tech: "科技" } });
    expect(displayName(EMPTY_DISPLAY_NAMES, "industries", "unknown")).toBe("未分类");
    expect(displayName(EMPTY_DISPLAY_NAMES, "instruments", "toString")).toBe("toString");
  });
  it("shares a source dictionary across date ranges without sharing names across servers or users", () => {
    const key = namesCacheKey(DEFAULT_CONNECTION);
    expect(
      namesCacheKey({ ...DEFAULT_CONNECTION, url: DEFAULT_CONNECTION.url.replace(/\/$/u, "") }),
    ).toBe(key);
    expect(namesCacheKey({ ...DEFAULT_CONNECTION, user: "other" })).not.toBe(key);
    expect(namesCacheKey({ ...DEFAULT_CONNECTION, database: "other" })).not.toBe(key);
    expect(namesCacheKey({ ...DEFAULT_CONNECTION, url: "https://example.com/" })).not.toBe(key);
    expect(key).not.toContain(DEFAULT_CONNECTION.url);
  });
  it("resolves partial Chinese names to codes and leaves unknown queries empty", () => {
    const names = { instruments: { A: "亚联发展", B: "创新发展", C: "蓝天" }, industries: {} };
    expect(nameMatches(names, "发展")).toEqual(["A", "B"]);
    expect(nameMatches(names, "不存在")).toEqual([]);
    expect(nameMatches(names, "  ")).toEqual([]);
  });
});
