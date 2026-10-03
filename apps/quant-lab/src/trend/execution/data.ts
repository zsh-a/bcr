import { artifactPath, contentHash, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { downloadArchive, type VerifiedArchive } from "@bcr/market-data/binance/archive";
import { completeMinuteArchive } from "@bcr/market-data/binance/complete";
import {
  MINUTE,
  validateBinanceRequest,
  validateBinanceManifest,
  type BinanceManifest,
  type BinanceRequest,
  type BinanceRepair,
  type FundingRate,
} from "@bcr/market-data/binance/model";
import { inspectMinuteCsv, parseFundingCsv, parseMinuteCsv } from "@bcr/market-data/binance/parse";
import { aggregateMinuteBars } from "@bcr/market-data/binance/timeframe";
import {
  candleArchive,
  candleWindows,
  fundingArchive,
  fundingMonths,
  type ArchiveWindow,
} from "@bcr/market-data/binance/plan";
import { MAX_TREND_CHART_BARS } from "@bcr/quant-core/trend";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";

type CachedArchive = Omit<VerifiedArchive, "csv"> & { ref: ArtifactRef };
type Downloader = typeof downloadArchive;

export function binanceHistoryHandler(io: ArtifactIO, download: Downloader = downloadArchive) {
  return async (task: ComputeTask, ctx: WorkerContext): Promise<readonly ArtifactRef[]> => {
    const request = task.config?.["request"] as BinanceRequest;
    const { start, end, warmup } = validateBinanceRequest(request);
    const refresh = task.config?.["refresh"] === true;
    const outputs: ArtifactRef[] = [];
    const namespace = `binance/import-${crypto.randomUUID()}`;
    const encoder = new TextEncoder();
    async function archive(
      url: string,
      funding = false,
      window?: ArchiveWindow,
    ): Promise<VerifiedArchive & { ref: ArtifactRef }> {
      const cachePath = `cache/binance/archives/${contentHash(encoder.encode(url))}.json`;
      const validate = (csv: string) => {
        if (funding) {
          parseFundingCsv(csv);
          return;
        }
        const bars = inspectMinuteCsv(csv).bars;
        if (window) {
          if (bars[0]!.time < window.from || bars.at(-1)!.time >= window.to)
            throw new Error("行情包含档案日期之外的分钟");
          if (
            window.period === "daily" &&
            (bars.length !== (window.to - window.from) / MINUTE ||
              bars[0]!.time !== window.from ||
              bars.at(-1)!.time + MINUTE !== window.to)
          )
            throw new Error(`官方日档案仍缺少分钟（${window.date} UTC）`);
        }
      };
      if (!refresh) {
        const raw = await io.store.get(cachePath);
        if (raw) {
          let cached: CachedArchive | undefined;
          try {
            cached = JSON.parse(new TextDecoder().decode(raw)) as CachedArchive;
          } catch {
            /* Re-fetch a damaged cache descriptor. */
          }
          if (
            cached?.url === url &&
            cached.ref?.id === `binance/archive/${cached.checksum}` &&
            /^[a-f0-9]{64}$/u.test(cached.checksum) &&
            (await io.store.has(artifactPath(cached.ref)))
          ) {
            const csv = await (await io.getBlob(cached.ref)).text();
            throwIfAborted(ctx);
            if (contentHash(encoder.encode(csv)) === cached.ref.hash) {
              try {
                validate(csv);
                return { ...cached, csv };
              } catch {
                /* Do not let an old incomplete daily archive poison retries. */
              }
            }
          }
        }
      }
      const fetched = await download(url, ctx.signal);
      try {
        validate(fetched.csv);
      } catch (error) {
        throw new Error(
          `${url.split("/").at(-1)}：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      throwIfAborted(ctx);
      const bytes = encoder.encode(fetched.csv);
      const ref: ArtifactRef = {
        id: `binance/archive/${fetched.checksum}`,
        hash: contentHash(bytes),
        type: "market/binance-csv",
        format: "csv",
        storage: "opfs",
      };
      if (!(await io.store.has(artifactPath(ref)))) await io.store.put(artifactPath(ref), bytes);
      const cached: CachedArchive = { url, checksum: fetched.checksum, ref };
      await io.store.put(cachePath, encoder.encode(JSON.stringify(cached)));
      return { ...fetched, ref };
    }
    async function candles(window: ArchiveWindow, marks = false) {
      const original = await archive(candleArchive(request.symbol, window, marks), false, window);
      const complete = await completeMinuteArchive(original, window, async (day) => {
        throwIfAborted(ctx);
        return archive(candleArchive(request.symbol, day, marks), false, day);
      });
      throwIfAborted(ctx);
      outputs.push(original.ref);
      if (!complete.replacements.length) return { ...original, repair: undefined };
      const bytes = encoder.encode(complete.csv);
      const hash = contentHash(bytes);
      const ref: ArtifactRef = {
        id: `binance/complete/${hash}`,
        hash,
        type: "market/binance-csv",
        format: "csv",
        storage: "opfs",
      };
      if (!(await io.store.has(artifactPath(ref)))) await io.store.put(artifactPath(ref), bytes);
      const repair: BinanceRepair = {
        kind: marks ? "marks" : "candles",
        original: original.ref,
        days: complete.replacements.map(({ date, archive: daily }) => {
          outputs.push(daily.ref);
          return { date, url: daily.url, checksum: daily.checksum, ref: daily.ref };
        }),
      };
      return { ...original, csv: complete.csv, ref, repair };
    }
    const windows = candleWindows(request),
      months = fundingMonths(request);
    const total = windows.length + months.length;
    let completed = 0;
    const partitions: BinanceManifest["partitions"] = [];
    for (const window of windows) {
      throwIfAborted(ctx);
      const prices = await candles(window);
      const marks = await candles(window, true);
      const bars = parseMinuteCsv(prices.csv),
        markBars = parseMinuteCsv(marks.csv);
      const count = (window.to - window.from) / MINUTE;
      if (
        bars.length !== count ||
        bars[0]!.time !== window.from ||
        bars.at(-1)!.time + MINUTE !== window.to ||
        markBars.length !== count ||
        markBars.some((bar, i) => bar.time !== bars[i]!.time)
      )
        throw new Error(`Binance ${window.date} 的行情与标记价格必须完整覆盖相同分钟`);
      partitions.push({
        from: window.from,
        to: window.to,
        rows: count,
        candles: prices.ref,
        marks: marks.ref,
        source: prices.url,
        checksum: prices.checksum,
        markSource: marks.url,
        markChecksum: marks.checksum,
        ...([prices.repair, marks.repair].some(Boolean)
          ? {
              repairs: [prices.repair, marks.repair].filter((r): r is BinanceRepair => !!r),
            }
          : {}),
      });
      outputs.push(prices.ref, marks.ref);
      ctx.progress(++completed / total);
    }
    const funding: FundingRate[] = [],
      fundingSources: BinanceManifest["fundingSources"] = [];
    for (const month of months) {
      throwIfAborted(ctx);
      const source = await archive(fundingArchive(request.symbol, month), true);
      funding.push(...parseFundingCsv(source.csv).filter((f) => f.time >= start && f.time < end));
      fundingSources.push({ url: source.url, checksum: source.checksum });
      outputs.push(source.ref);
      ctx.progress(++completed / total);
    }
    if (
      !funding.length ||
      funding[0]!.time - start > funding[0]!.intervalHours * 60 * MINUTE + MINUTE ||
      end - funding.at(-1)!.time > funding.at(-1)!.intervalHours * 60 * MINUTE + MINUTE ||
      funding.some(
        (f, i) =>
          i > 0 &&
          (f.time <= funding[i - 1]!.time ||
            f.time - funding[i - 1]!.time >
              Math.max(f.intervalHours, funding[i - 1]!.intervalHours) * 60 * MINUTE + MINUTE),
      )
    )
      throw new Error("资金费率记录缺失或不连续，未按零费用回测");
    throwIfAborted(ctx);
    const fundingRef = await io.writeTypedJsonArtifact(
      namespace,
      "funding",
      "market/binance-funding",
      funding,
    );
    try {
      throwIfAborted(ctx);
      const manifest: BinanceManifest = {
        version: 1,
        provider: "binance-public-data",
        market: "usdt-perpetual",
        interval: "1m",
        symbol: request.symbol,
        startTime: start,
        endTime: end,
        warmupStart: warmup,
        rows: (end - warmup) / MINUTE,
        funding: fundingRef,
        fundingSources,
        fundingPrice: "minute-mark-open",
        partitions,
        createdAt: new Date().toISOString(),
      };
      validateBinanceManifest(manifest);
      const manifestRef = await io.writeTypedJsonArtifact(
        namespace,
        "manifest",
        "market/binance-manifest",
        manifest,
      );
      if (ctx.signal.aborted) {
        await io.store.delete(artifactPath(manifestRef));
        throwIfAborted(ctx);
      }
      // Raw verified archives are reusable after cancellation; an incomplete
      // dataset is never published. Register all inputs as produced artifacts.
      return [
        ...new Map([...outputs, fundingRef, manifestRef].map((ref) => [ref.id, ref])).values(),
      ];
    } catch (error) {
      await io.store.delete(artifactPath(fundingRef));
      throw error;
    }
  };
}

/** Raw minute CSV stays in the worker. Chart windows may cross UTC midnight. */
export async function readBinanceChartBars(io: ArtifactIO, task: ComputeTask, ctx: WorkerContext) {
  const ref = task.inputs.find((r) => r.port === "manifest");
  if (!ref) throw new Error("缺少 Binance 行情清单");
  const manifest = await io.readJsonArtifact<BinanceManifest>(ref, ctx);
  validateBinanceManifest(manifest);
  const from = Number(task.config?.["from"]),
    to = Number(task.config?.["to"]),
    minutes = Number(task.config?.["minutes"] ?? 1);
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    to <= from ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    1440 % minutes !== 0 ||
    from % (minutes * MINUTE) ||
    to % (minutes * MINUTE) ||
    (to - from) / (minutes * MINUTE) > MAX_TREND_CHART_BARS ||
    from < manifest.startTime ||
    to > manifest.endTime
  )
    throw new Error(`图表区间需对齐显示周期，最多 ${MAX_TREND_CHART_BARS} 根 K 线`);
  const bars = [];
  for (const p of manifest.partitions.filter((p) => p.from < to && p.to > from)) {
    if (!task.inputs.some((input) => input.id === p.candles.id))
      throw new Error("行情分片与输入不一致");
    throwIfAborted(ctx);
    bars.push(
      ...aggregateMinuteBars(
        parseMinuteCsv(await (await io.getBlob(p.candles)).text()).filter(
          (b) => b.time >= from && b.time < to,
        ),
        minutes,
      ),
    );
  }
  throwIfAborted(ctx);
  if (bars.length !== (to - from) / (minutes * MINUTE))
    throw new Error("图表行情未完整覆盖所选周期");
  return { bars, manifest, from, to, minutes };
}
