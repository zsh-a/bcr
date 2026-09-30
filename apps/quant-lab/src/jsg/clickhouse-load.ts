import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import initQuant, {
  ClickHouseNormalizer,
  clickhouse_sql,
  validate_research_manifest,
} from "../../../../crates/quant/pkg/bcr_quant.js";
import initKernels, { StreamingBlake3 } from "../../../../crates/kernels/pkg/bcr_kernels.js";
import {
  MAX_MANIFEST_BYTES,
  parseManifest,
  type ResearchDataset,
  type ResearchManifest,
} from "./model";
import {
  clickHouseClient,
  normalizeConnection,
  numericDate,
  prepareCalendar,
  publicProfile,
  ResponseTooLarge,
  type ClickHouseClient,
  type ClickHouseConnection,
  type ClickHouseInfo,
  type ClickHouseProgress,
  type ClickHouseRange,
  type MetadataRow,
} from "./clickhouse-http";

let ready: Promise<unknown> | undefined;
const encoder = new TextEncoder();
const string = (row: MetadataRow, key: string) => {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 2000)
    throw new Error(`ClickHouse 元数据字段无效：${key}`);
  return value;
};
const columnsSql =
  "SELECT table,name FROM system.columns WHERE database={db:String} AND table IN ('index_membership_history','financial_revisions','corporate_actions','stock_daily_execution','research_coverage') ORDER BY table,position";
function hasContracts(columns: MetadataRow[]) {
  const needs: Record<string, string[]> = {
    index_membership_history: [
      "index",
      "code",
      "effective_date",
      "publish_date",
      "is_member",
      "version",
    ],
    financial_revisions: [
      "code",
      "report_date",
      "publish_date",
      "adjusted_profit_diff",
      "circulating_a",
      "version",
    ],
    corporate_actions: [
      "code",
      "record_date",
      "ex_date",
      "pay_date",
      "share_available_date",
      "known_date",
      "cash_per_share",
      "withholding_per_share",
      "share_ratio",
      "fractional_cash_price",
    ],
    stock_daily_execution: ["code", "date", "limit_up", "limit_down"],
    research_coverage: ["dataset", "start_date", "end_date", "verified"],
  };
  return Object.entries(needs).every(([table, names]) =>
    names.every((name) => columns.some((c) => c["table"] === table && c["name"] === name)),
  );
}
export async function inspectClickHouse(
  client: ClickHouseClient,
  signal: AbortSignal,
): Promise<ClickHouseInfo> {
  const [version, range, columns, sessions] = await Promise.all([
    client.json("SELECT version() AS version", {}, signal),
    client.json(
      "SELECT toString(min(date)) AS firstDate,toString(max(date)) AS lastDate FROM stock_daily",
      {},
      signal,
    ),
    client.json(columnsSql, { db: client.connection.database }, signal),
    client.json(
      "SELECT calendar_date AS date FROM trade_dates FINAL WHERE is_trading_day=1 ORDER BY calendar_date DESC LIMIT 2",
      {},
      signal,
    ),
  ]);
  if (version[0] === undefined || range[0] === undefined)
    throw new Error("ClickHouse 未返回行情范围");
  const firstDate = string(range[0], "firstDate"),
    lastDate = string(range[0], "lastDate");
  numericDate(firstDate);
  numericDate(lastDate);
  const penultimate = sessions[1] === undefined ? firstDate : string(sessions[1], "date");
  numericDate(penultimate);
  return {
    version: string(version[0], "version"),
    firstDate,
    lastDate,
    lastBacktestDate: penultimate < lastDate ? penultimate : lastDate,
    strictPitReady: hasContracts(columns),
  };
}

async function cachedDataset(
  store: BinaryStore,
  key: string,
): Promise<ResearchDataset | undefined> {
  try {
    const size = await store.size(key);
    if (size === undefined || size > MAX_MANIFEST_BYTES) return undefined;
    const bytes = await store.get(key);
    if (bytes === undefined) return undefined;
    const record = JSON.parse(new TextDecoder().decode(bytes)) as {
      version: number;
      dataset: ResearchDataset;
    };
    if (record.version !== 1) return undefined;
    const dataset = record.dataset;
    dataset.manifest = parseManifest(dataset.manifest);
    if (
      dataset.partitions.length !== dataset.manifest.partitions.length ||
      !(await store.has(artifactPath(dataset.manifestRef)))
    )
      return undefined;
    for (const [i, ref] of dataset.partitions.entries()) {
      if (
        ref.type !== "quant/jsg-daily" ||
        (await store.size(artifactPath(ref))) !== dataset.manifest.partitions[i]!.bytes
      )
        return undefined;
    }
    return dataset;
  } catch {
    return undefined;
  }
}

/** A complete immutable snapshot is published after every requested trading day validates. */
export async function loadClickHouse(
  connection: ClickHouseConnection,
  range: ClickHouseRange,
  store: BinaryStore,
  signal: AbortSignal,
  progress: (value: ClickHouseProgress) => void,
  fetcher: typeof fetch = fetch,
  beforeNetwork?: () => Promise<void>,
): Promise<{ dataset: ResearchDataset; cached: boolean }> {
  const c = normalizeConnection(connection);
  numericDate(range.start);
  numericDate(range.end);
  if (range.start > range.end) throw new Error("开始日期应早于结束日期");
  signal.throwIfAborted();
  ready ??= Promise.all([initQuant(), initKernels()]);
  await ready;
  const sql = clickhouse_sql(range.strictPit);
  const cacheKey = `cache/jsg-clickhouse/${contentHash(encoder.encode(JSON.stringify({ version: 1, ...publicProfile(c, range), sql })))}`;
  if (!range.refresh) {
    const existing = await cachedDataset(store, cacheKey);
    signal.throwIfAborted();
    if (existing !== undefined) return { dataset: existing, cached: true };
  }
  await beforeNetwork?.();
  signal.throwIfAborted();
  const client = clickHouseClient(c, fetcher);
  let total = 0,
    completed = 0,
    rows = 0,
    bytes = 0;
  const report = (text: string) => {
    signal.throwIfAborted();
    progress({ text, total, completed, rows, bytes });
  };
  report("读取交易日历与数据范围…");
  const info = await inspectClickHouse(client, signal);
  if (range.end > info.lastDate) throw new Error(`行情仅覆盖至 ${info.lastDate}，请调整结束日期`);
  if (range.strictPit && !info.strictPitReady)
    throw new Error("源库缺少历史成分、财报修订、公司行动、每日涨跌停或覆盖记录");
  const params = { breadth: "000985", selection: "399101" };
  const [calendarRows, codeRows, sectorRows] = await Promise.all([
    client.json(
      "SELECT calendar_date AS date FROM trade_dates FINAL WHERE is_trading_day=1 ORDER BY date",
      {},
      signal,
    ),
    client.json(
      range.strictPit
        ? "SELECT DISTINCT code FROM index_membership_history FINAL WHERE index IN ({breadth:String},{selection:String}) ORDER BY code"
        : "SELECT DISTINCT code FROM index_stocks FINAL WHERE index IN ({breadth:String},{selection:String}) ORDER BY code",
      params,
      signal,
    ),
    client.json(
      "SELECT DISTINCT industry_code FROM industry_info FINAL WHERE industry_code!='' ORDER BY industry_code",
      {},
      signal,
    ),
  ]);
  const calendar = prepareCalendar(
    calendarRows.map((r) => string(r, "date")),
    range.start,
    range.end,
  );
  total = calendar.dates.length;
  const codes = codeRows.map((r) => string(r, "code"));
  const industries = [
    ...new Set([...sectorRows.map((r) => string(r, "industry_code")), "unknown"]),
  ].sort();
  if (codes.length === 0 || codes.length > 20_000 || new Set(codes).size !== codes.length)
    throw new Error("成分股数据为空或证券数量无效");
  const fullParams = { ...params, start: calendar.dates[0]!, end: calendar.last };
  const corporateActions: NonNullable<ResearchManifest["corporateActions"]> = [];
  if (range.strictPit) {
    report("校验历史数据覆盖…");
    const coverage = await client.json(
      "SELECT dataset FROM research_coverage WHERE verified=1 AND start_date<={start:Date} AND end_date>={end:Date} GROUP BY dataset",
      fullParams,
      signal,
    );
    for (const required of ["membership", "financials", "corporateActions", "priceLimits"])
      if (!coverage.some((r) => r["dataset"] === required))
        throw new Error(`缺少已审核的历史数据覆盖：${required}`);
    const invalid = await client.json(
      "SELECT count() AS n FROM index_membership_history FINAL WHERE is_member NOT IN (0,1)",
      {},
      signal,
    );
    if (String(invalid[0]?.["n"]) !== "0") throw new Error("历史成分事件无效");
    const missing = await client.json(
      "SELECT count() AS n FROM (SELECT * FROM stock_daily FINAL) p LEFT ANTI JOIN (SELECT * FROM stock_daily_execution FINAL) e ON p.code=e.code AND p.date=e.date WHERE p.date BETWEEN {start:Date} AND {end:Date} AND p.open>0 AND p.close>0 AND p.code IN (SELECT code FROM index_membership_history FINAL WHERE index IN ({breadth:String},{selection:String}))",
      fullParams,
      signal,
    );
    if (String(missing[0]?.["n"]) !== "0") throw new Error("部分交易日缺少实际涨跌停价");
    const actions = await client.json(
      "SELECT code,toUInt32(formatDateTime(record_date,'%Y%m%d')) AS recordDate,toUInt32(formatDateTime(ex_date,'%Y%m%d')) AS exDate,toUInt32(formatDateTime(pay_date,'%Y%m%d')) AS payDate,toUInt32(formatDateTime(share_available_date,'%Y%m%d')) AS shareAvailableDate,toUInt32(formatDateTime(known_date,'%Y%m%d')) AS knownDate,cash_per_share AS cashPerShare,withholding_per_share AS withholdingPerShare,share_ratio AS shareRatio,fractional_cash_price AS fractionalCashPrice FROM corporate_actions FINAL WHERE record_date BETWEEN {start:Date} AND {end:Date} ORDER BY ex_date,code",
      fullParams,
      signal,
    );
    const ids = new Map(codes.map((code, id) => [code, id]));
    for (const row of actions) {
      const id = ids.get(string(row, "code"));
      if (id === undefined) continue;
      const { code: _code, ...event } = row;
      corporateActions.push({ ...event, id } as unknown as NonNullable<
        ResearchManifest["corporateActions"]
      >[number]);
    }
  }
  const normalizer = new ClickHouseNormalizer(JSON.stringify(codes), JSON.stringify(industries));
  const namespace = `jsg/ch-${crypto.randomUUID()}`;
  const temporary = `temp/${namespace}/response.arrow`;
  const owned: ArtifactRef[] = [];
  const partitions: ResearchDataset["partitions"] = [];
  const descriptors: ResearchManifest["partitions"] = [];
  let published = false;
  try {
    let batchDays = 20;
    while (completed < total) {
      const dates = calendar.dates.slice(completed, completed + batchDays);
      report(`加载 ${dates[0]} — ${dates.at(-1)} · ${completed}/${total} 个交易日`);
      try {
        const stream = await client.arrow(
          sql,
          { ...params, start: dates[0]!, end: dates.at(-1)! },
          signal,
          (count) => {
            bytes += count;
            report(`加载 ${dates[0]} — ${dates.at(-1)} · ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
          },
        );
        await store.putStream(temporary, stream);
        signal.throwIfAborted();
        const raw = await store.get(temporary);
        if (raw === undefined) throw new Error("本地 Arrow 临时数据缺失");
        const normalized = normalizer.normalize(raw, JSON.stringify(dates.map(numericDate)));
        const hasher = new StreamingBlake3();
        let hash: string;
        try {
          for (let offset = 0; offset < normalized.byteLength; offset += 1024 * 1024) {
            signal.throwIfAborted();
            hasher.update(normalized.subarray(offset, offset + 1024 * 1024));
          }
          hash = hasher.finalize_hex();
        } finally {
          hasher.free();
        }
        const ref: ArtifactRef = {
          id: `${namespace}/part-${partitions.length}/${hash}`,
          hash,
          type: "quant/jsg-daily",
          format: "arrow-ipc",
          storage: "opfs",
        };
        owned.push(ref);
        await store.putStream(
          artifactPath(ref),
          new Blob([normalized.buffer as ArrayBuffer]).stream(),
        );
        descriptors.push({
          file: `part-${String(partitions.length).padStart(4, "0")}.arrow`,
          bytes: normalized.byteLength,
          rows: normalizer.rows(),
        });
        partitions.push(ref);
        rows += normalizer.rows();
        completed += dates.length;
      } catch (error) {
        const tooLarge =
          error instanceof ResponseTooLarge ||
          (typeof error === "string" && error.includes("partition exceeds 32 MiB"));
        if (tooLarge && dates.length > 1) {
          batchDays = Math.max(1, Math.floor(dates.length / 2));
          continue;
        }
        throw error;
      } finally {
        await store.delete(temporary);
      }
      report(`已加载 ${completed}/${total} 个交易日 · ${rows.toLocaleString()} 行`);
    }
    const manifest = parseManifest({
      version: range.strictPit ? 2 : 1,
      schema: range.strictPit ? "jsg-daily-v2" : "jsg-daily-v1",
      name: `JSG ${calendar.first} to ${calendar.last}`,
      source: `Browser / ClickHouse ${c.url} / ${c.database}`,
      universeMode: range.strictPit ? "historical" : "snapshot",
      warnings: range.strictPit
        ? ["公告仅有日期时，按下一交易日可用；行业沿用旧库生效日期，尚无独立公告时间。"]
        : [
            "当前成分快照缺少退出历史，存在幸存者偏差。",
            "旧财报表覆盖历史修订版本，无法恢复已丢失的历史信息。",
            "股本按公布日与变更日均严格早于交易日取值。",
            "v1 使用固定涨跌停比例与复权研究单位；raw-v2 需要明确公司行为和每日涨跌停价。",
          ],
      startDate: numericDate(calendar.first),
      endDate: numericDate(calendar.last),
      instruments: codes.map((code) => ({
        code,
        limitRatio: code.startsWith("sz.30") || code.startsWith("sh.68") ? 0.2 : 0.1,
      })),
      industries,
      calendar: calendar.sessions,
      partitions: descriptors,
      ...(range.strictPit
        ? {
            corporateActions,
            dataQuality: {
              membership: "historical",
              financials: "revisions",
              corporateActions: "complete",
              priceLimits: "daily",
            },
          }
        : {}),
    });
    const manifestJson = JSON.stringify(manifest);
    const manifestBytes = encoder.encode(manifestJson);
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("研究清单超过 4 MiB");
    validate_research_manifest(manifestJson);
    const hash = contentHash(manifestBytes);
    const manifestRef: ArtifactRef = {
      id: `${namespace}/manifest/${hash}`,
      hash,
      type: "quant/jsg-manifest",
      format: "json",
      storage: "opfs",
    };
    owned.push(manifestRef);
    await store.put(artifactPath(manifestRef), manifestBytes);
    const dataset = { manifest, manifestRef, partitions };
    signal.throwIfAborted();
    const record = encoder.encode(JSON.stringify({ version: 1, dataset }));
    if (record.byteLength > MAX_MANIFEST_BYTES) throw new Error("快照索引超过 4 MiB");
    await store.put(cacheKey, record);
    published = true;
    return { dataset, cached: false };
  } finally {
    normalizer.free();
    await store.delete(temporary).catch(() => undefined);
    if (!published) await Promise.allSettled(owned.map((ref) => store.delete(artifactPath(ref))));
  }
}
