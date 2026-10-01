import { artifactPath, contentHash } from "@bcr/core";
import { marketResearchStore, snapshotId } from "../research/catalog";
import { parseManifest, MAX_PARTITION_BYTES, type ResearchDataset } from "../research/model";
import type { BreadthDay } from "../research/breadth-browser";
import init, { MarketBreadth } from "../../../../crates/quant/pkg/bcr_quant.js";
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ResearchDataset>) => void) | null;
  postMessage(value: unknown): void;
};
scope.onmessage = (event) => {
  void (async () => {
    let engine: MarketBreadth | undefined;
    try {
      const dataset = event.data,
        store = marketResearchStore(),
        manifest = parseManifest(dataset.manifest);
      const identity = snapshotId(dataset),
        cache = `cache/market-breadth/v1-${identity}`;
      const frozen = await store.get(artifactPath(dataset.manifestRef));
      if (!frozen || contentHash(frozen) !== dataset.manifestRef.hash)
        throw new Error("快照清单校验失败");
      const storedManifest = parseManifest(JSON.parse(new TextDecoder().decode(frozen)));
      if (JSON.stringify(storedManifest) !== JSON.stringify(manifest))
        throw new Error("快照清单与引用不一致");
      const cachedSize = await store.size(cache);
      if (cachedSize && cachedSize <= 16 * 1024 * 1024) {
        try {
          const bytes = await store.get(cache);
          if (bytes) {
            const record = JSON.parse(new TextDecoder().decode(bytes)) as {
              version: number;
              hash: string;
              days: BreadthDay[];
            };
            const encoded = new TextEncoder().encode(JSON.stringify(record.days));
            if (
              record.version === 1 &&
              Array.isArray(record.days) &&
              contentHash(encoded) === record.hash
            ) {
              scope.postMessage({ type: "result", days: record.days });
              return;
            }
          }
        } catch {
          /* Recompute a damaged derived cache from immutable input. */
        }
      }
      await init();
      engine = new MarketBreadth(JSON.stringify(manifest));
      const days: BreadthDay[] = [];
      let cells = 0;
      for (let i = 0; i < dataset.partitions.length; i++) {
        const ref = dataset.partitions[i]!,
          path = artifactPath(ref);
        const size = await store.size(path);
        if (!size || size > MAX_PARTITION_BYTES || size !== manifest.partitions[i]?.bytes)
          throw new Error("宽度数据分片缺失或过大");
        const bytes = await store.get(path);
        if (!bytes || contentHash(bytes) !== ref.hash) throw new Error("宽度数据分片校验失败");
        engine.load_partition(bytes);
        for (;;) {
          const value = engine.advance();
          if (!value) break;
          const day = JSON.parse(value) as BreadthDay;
          if (day.date) {
            cells += day.breadth.length;
            if (cells > 150_000) throw new Error("宽度结果过大，请缩小分析日期区间");
            days.push(day);
          }
        }
        scope.postMessage({ type: "progress", done: (i + 1) / dataset.partitions.length });
      }
      engine.finish();
      const output = new TextEncoder().encode(JSON.stringify(days));
      if (output.byteLength > 16 * 1024 * 1024)
        throw new Error("宽度结果超过 16 MiB，请缩小分析日期区间");
      await store.put(
        cache,
        new TextEncoder().encode(JSON.stringify({ version: 1, hash: contentHash(output), days })),
      );
      scope.postMessage({ type: "result", days });
    } catch (e) {
      scope.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      engine?.free();
    }
  })();
};
