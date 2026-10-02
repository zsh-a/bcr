import { readFileSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { artifactPath, type ArtifactRef } from "@bcr/core";
import initQuant from "../../../crates/quant/pkg/bcr_quant.js";
import { readSnapshotBars } from "@bcr/market-data/research/snapshot-reader";
import type { ResearchDataset, SnapshotPartitionRange } from "@bcr/market-data/research/model";
import { demoResearch } from "../src/jsg/demo";
import { candleWindow } from "../src/jsg/chart-window";

beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
const ref = (id: string): ArtifactRef => ({
  id,
  type: "quant/jsg-daily",
  storage: "opfs",
  hash: id,
});
it("uses the replay's bound input index to read only intersecting Arrow partitions", async () => {
  const fixture = demoResearch(),
    store = new MemoryStore();
  const dataset: ResearchDataset = {
    manifest: fixture.manifest,
    manifestRef: ref("manifest"),
    partitions: fixture.manifest.partitions.map((_, i) => ref(`partition-${i}`)),
  };
  const ranges: SnapshotPartitionRange[] = [];
  for (const [i, file] of fixture.files.slice(1).entries()) {
    const artifact = dataset.partitions[i]!;
    await store.put(artifactPath(artifact), new Uint8Array(await file.arrayBuffer()));
    ranges.push({
      ref: artifact,
      from: fixture.manifest.calendar[i * 20]!.date,
      to: fixture.manifest.calendar[Math.min(fixture.manifest.calendar.length - 1, i * 20 + 19)]!
        .date,
    });
  }
  const get = vi.spyOn(store, "get");
  const from = fixture.manifest.calendar[45]!.date,
    to = fixture.manifest.calendar[48]!.date;
  const code = fixture.manifest.instruments[0]!.code;
  const bars = await readSnapshotBars(
    store,
    dataset,
    code,
    from,
    to,
    new AbortController().signal,
    ranges,
  );
  expect(bars).toHaveLength(4);
  expect(get.mock.calls.map(([path]) => path)).toEqual([artifactPath(dataset.partitions[2]!)]);
  // A foreign range index cannot suppress this snapshot's actual data.
  get.mockClear();
  const foreign = ranges.map((range) => ({
    ...range,
    ref: { ...range.ref, hash: "different" },
    from: 20200101,
    to: 20200102,
  }));
  const fallback = await readSnapshotBars(
    store,
    dataset,
    code,
    from,
    to,
    new AbortController().signal,
    foreign,
  );
  expect(fallback).toEqual(bars);
  expect(get.mock.calls).toHaveLength(dataset.partitions.length);
  const abort = new AbortController();
  abort.abort();
  await expect(
    readSnapshotBars(store, dataset, code, from, to, abort.signal, ranges),
  ).rejects.toThrow();
});
it("defaults to a bounded trading-session window and expands only for explicit year/all views", () => {
  const manifest = demoResearch().manifest;
  const date = manifest.calendar[90]!.date;
  const text = `${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}`;
  const window = candleWindow(manifest, manifest.startDate, manifest.endDate, text, "focus");
  expect(
    manifest.calendar.filter((d) => d.date >= window.from && d.date <= window.to),
  ).toHaveLength(56);
  expect(candleWindow(manifest, manifest.startDate, manifest.endDate, text, "all")).toEqual({
    from: manifest.startDate,
    to: manifest.endDate,
  });
});
