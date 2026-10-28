import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHINA_ACTIVITY_RELEASES,
  fetchChinaActivitySnapshot,
  parseChinaActivityPages,
  parseChinaActivityRelease,
  type ChinaActivityPage,
} from "../src/cycle/china-activity";
import { bundledChinaActivitySnapshot } from "../src/cycle/china-activity-snapshot";

const fetchedAt = "2026-10-25T12:00:00Z";
const latest = CHINA_ACTIVITY_RELEASES.at(-1)!;
const values = ["5.5", "1.1", "5.2", "-13.2", "-24.9", "-20.6"];
function html(period = "2026-09", published = "2026-10-19", fields = values) {
  const month = Number(period.slice(5, 7));
  const row = (label: string, cells: string[]) =>
    `<tr><td>${label}</td>${cells.map((value) => `<td>${value}</td>`).join("")}</tr>`;
  return `<meta name="PubDate" content="${published.replaceAll("-", "/")} 10:00">
  <p>${period.slice(0, 4)}年综合发布；规模以上工业增加值按可比价计算，其他指标为名义口径。</p>
  <table><tr><td></td><td>规模以上工业增加值环比增速（%）</td></tr><tr><td>9月份</td><td>0.61</td></tr></table>
  <table><tr><td>指 标</td><td>${month}月</td><td>1—${month}月</td></tr>
  <tr><td>绝对量</td><td>同比增长（%）</td><td>绝对量</td><td>同比增长（%）</td></tr>
  ${row("三、规模以上工业增加值", ["…", fields[0]!, "…", "5.3"])}
  ${row("七、社会消费品零售总额（亿元）", ["42433", fields[1]!, "370001", "1.1"])}
  ${row("九、全国城镇调查失业率（%）", [fields[2]!, "0.0（百分点）", "5.2", "0.0（百分点）"])}
  ${row("31个大城市城镇调查失业率", ["99", "0.0（百分点）", "98", "0.0（百分点）"])}
  ${row("新建商品房销售面积（万平方米）", ["…", "…", "56483", fields[3]!])}
  ${row("房屋新开工面积（万平方米）", ["…", "…", "34031", fields[4]!])}
  ${row("房地产开发投资（亿元）", ["…", "…", "53364", fields[5]!])}
  </table>`;
}
const page = (content = html()): ChinaActivityPage => ({ ...latest, html: content });
afterEach(() => vi.unstubAllGlobals());

describe("official Chinese monthly and cumulative release parsing", () => {
  it("separates monthly industrial/retail growth, unemployment level and property YTD columns", () => {
    const release = parseChinaActivityRelease(page(), fetchedAt);
    expect(Object.fromEntries(release.values)).toEqual({
      industrialProduction: 5.5,
      retailNominal: 1.1,
      unemployment: 5.2,
      housingSalesYtd: -13.2,
      housingStartsYtd: -24.9,
      realEstateInvestmentYtd: -20.6,
    });
    expect(release.published).toBe("2026-10-19");
    expect(release.values.get("unemployment")).not.toBe(99);
    expect(release.values.get("industrialProduction")).not.toBe(0.61);
  });

  it("omits combined January/February industrial and retail observations without dropping actual February levels/YTD", () => {
    const release = CHINA_ACTIVITY_RELEASES.find((item) => item.period === "2026-02")!;
    const parsed = parseChinaActivityRelease(
      { ...release, html: html("2026-02", "2026-03-16") },
      fetchedAt,
    );
    expect(parsed.values.has("industrialProduction")).toBe(false);
    expect(parsed.values.has("retailNominal")).toBe(false);
    expect(parsed.values.get("unemployment")).toBe(5.2);
    expect(parsed.values.get("housingSalesYtd")).toBe(-13.2);
  });

  it("preserves zeros, negative values and explicit missing cells without invented source flags", () => {
    const parsed = parseChinaActivityPages(
      [page(html("2026-09", "2026-10-19", ["0", "-0.6", "0", "—", "…", "-0"]))],
      fetchedAt,
    );
    expect(parsed.series.map((series) => series.observations[0]?.value)).toEqual([
      0,
      -0.6,
      0,
      null,
      null,
      -0,
    ]);
    expect(parsed.series.every((series) => series.observations[0]?.status === undefined)).toBe(
      true,
    );
  });

  it("deduplicates the desktop/mobile copy and rejects inconsistent duplicate tables or period values", () => {
    const content = html();
    const duplicated = page(content + content);
    expect(parseChinaActivityRelease(duplicated, fetchedAt).values.size).toBe(6);
    const conflict = page(content + content.replace("<td>5.5</td>", "<td>6.5</td>"));
    expect(() => parseChinaActivityRelease(conflict, fetchedAt)).toThrow(/冲突/u);
    const result = parseChinaActivityPages([page(), page()], fetchedAt);
    expect(result.series.every((series) => series.observations.length === 1)).toBe(true);
    expect(() =>
      parseChinaActivityPages(
        [page(), page(html().replace("<td>5.5</td>", "<td>6.5</td>"))],
        fetchedAt,
      ),
    ).toThrow(/同期/u);
  });

  it("rejects wrong months, years, frequencies, units, malformed dates and untrusted sources", () => {
    for (const period of ["2026-Q3", "2026-13", "2026-11", "2025-09"])
      expect(() => parseChinaActivityRelease({ ...page(), period }, fetchedAt)).toThrow();
    expect(() =>
      parseChinaActivityRelease(page(html().replace("<td>9月</td>", "<td>8月</td>")), fetchedAt),
    ).toThrow(/月份表头/u);
    expect(() =>
      parseChinaActivityRelease(
        page(html().replaceAll("同比增长（%）", "环比增长（%）")),
        fetchedAt,
      ),
    ).toThrow(/主表/u);
    expect(() =>
      parseChinaActivityRelease(page(html().replace("<td>5.5</td>", "<td>NaN</td>")), fetchedAt),
    ).toThrow(/数值/u);
    expect(() =>
      parseChinaActivityRelease(page(html().replace("按可比价计算", "按现价计算")), fetchedAt),
    ).toThrow(/实际口径/u);
    expect(() => parseChinaActivityRelease(page(html("2026-09", "2026-10-99")), fetchedAt)).toThrow(
      /发布日期/u,
    );
    expect(() => parseChinaActivityRelease(page(html("2026-09", "2026-11-01")), fetchedAt)).toThrow(
      /发布日期/u,
    );
    expect(() =>
      parseChinaActivityRelease({ ...page(), url: "https://example.com/nbs.html" }, fetchedAt),
    ).toThrow(/来源地址/u);
    expect(() => parseChinaActivityRelease(page(), "2026-02-30T12:00:00Z")).toThrow(/抓取时间/u);
  });

  it("rejects missing/duplicate indicator rows, truncated columns and invalid unemployment levels", () => {
    expect(() =>
      parseChinaActivityRelease(
        page(html().replace("新建商品房销售面积", "新建商品房销售额")),
        fetchedAt,
      ),
    ).toThrow(/缺失或重复/u);
    expect(() =>
      parseChinaActivityRelease(page(html().replace("<td>-20.6</td>", "")), fetchedAt),
    ).toThrow(/列数/u);
    expect(() =>
      parseChinaActivityRelease(
        page(html("2026-09", "2026-10-19", ["5", "1", "101", "0", "0", "0"])),
        fetchedAt,
      ),
    ).toThrow(/失业率/u);
  });

  it("preserves release-specific URLs/dates and states the limited mixed-release coverage honestly", () => {
    const earlier = CHINA_ACTIVITY_RELEASES[0]!;
    const parsed = parseChinaActivityPages(
      [page(), { ...earlier, html: html("2025-06", "2025-07-15") }],
      fetchedAt,
    );
    for (const series of parsed.series) {
      expect(series.frequency).toBe("M");
      expect(series.unit).toBe("percent");
      expect(series.seasonalAdjustment).toBe("NSA");
      expect(series.sourceUpdatedAt).toBe("2026-10-19");
      expect(series.source.url).toBe(latest.url);
      expect(series.note).toContain(earlier.url);
      expect(series.note).toContain("2025-06（2025-07-15）");
      expect(series.note).toContain("不是统一最新修订版");
      expect(series.observations.map((point) => point.period)).toEqual(["2025-06", "2026-09"]);
    }
    expect(parsed.series.find((series) => series.indicator === "retailNominal")?.note).toContain(
      "名义同比",
    );
    expect(parsed.series.find((series) => series.indicator === "housingStartsYtd")?.note).toContain(
      "累计同比（YTD）",
    );
  });
});

describe("bounded official fetching and frozen activity resource", () => {
  it("fetches the explicit original releases in batches with no network during static resource import", async () => {
    let active = 0,
      maximum = 0;
    const fetch = vi.fn(async (url: string) => {
      active++;
      maximum = Math.max(maximum, active);
      const release = CHINA_ACTIVITY_RELEASES.find((item) => item.url === url)!;
      const date = /t(\d{4})(\d{2})(\d{2})_/u.exec(url)!;
      await Promise.resolve();
      active--;
      return new Response(html(release.period, `${date[1]}-${date[2]}-${date[3]}`));
    });
    vi.stubGlobal("fetch", fetch);
    expect(bundledChinaActivitySnapshot.series).toHaveLength(6);
    expect(fetch).not.toHaveBeenCalled();
    const result = await fetchChinaActivitySnapshot();
    expect(fetch).toHaveBeenCalledTimes(15);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(result.series.map((series) => series.observations.length)).toEqual([
      14, 14, 15, 15, 15, 15,
    ]);
  });

  it("fails on a blocked/truncated response and passes cancellation without overwriting data", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("blocked", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchChinaActivitySnapshot()).rejects.toThrow(/HTTP 403/u);
    fetch.mockImplementation(async () => new Response("<html>broken</html>"));
    await expect(fetchChinaActivitySnapshot()).rejects.toThrow(/发布日期/u);
    const controller = new AbortController();
    controller.abort();
    fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      options.signal?.throwIfAborted();
      return new Response("");
    });
    await expect(fetchChinaActivitySnapshot(controller.signal)).rejects.toThrow();
  });

  it("bundles six actually fetched official series with real source dates and meaningful historical coverage", () => {
    const data = bundledChinaActivitySnapshot;
    expect(data.version).toBe(1);
    expect(Number.isFinite(Date.parse(data.fetchedAt))).toBe(true);
    expect(data.series).toHaveLength(6);
    const expected: Record<string, number> = {
      industrialProduction: 5.5,
      retailNominal: 1.1,
      unemployment: 5.2,
      housingSalesYtd: -13.2,
      housingStartsYtd: -24.9,
      realEstateInvestmentYtd: -20.6,
    };
    for (const series of data.series) {
      expect(series.country).toBe("CHN");
      expect(series.unit).toBe("percent");
      expect(series.frequency).toBe("M");
      expect(series.seasonalAdjustment).toBe("NSA");
      expect(series.observations.length).toBeGreaterThanOrEqual(14);
      expect(series.observations[0]?.period).toBe("2025-06");
      expect(series.observations.at(-1)).toEqual({
        period: "2026-09",
        value: expected[series.indicator],
      });
      expect(series.sourceUpdatedAt).toBe("2026-10-19");
      expect(series.source.licenseUrl).toBe(
        "https://www.stats.gov.cn/wzgl/202302/t20230217_1912857.html",
      );
      expect(series.source.url).toMatch(/^https:\/\/www\.stats\.gov\.cn\//u);
      expect(new Set(series.observations.map((point) => point.period)).size).toBe(
        series.observations.length,
      );
      expect(
        series.observations.every((point) => point.period <= series.fetchedAt.slice(0, 7)),
      ).toBe(true);
      if (["industrialProduction", "retailNominal"].includes(series.indicator)) {
        expect(series.observations.some((point) => /-0[12]$/u.test(point.period))).toBe(false);
      }
    }
  });
});
