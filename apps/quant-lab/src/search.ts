import type { SearchDocument } from "@bcr/core";
import { useRuntime } from "@bcr/react";
import { useEffect } from "react";
import { useQuantLab } from "./store";
const sourceFor = (value: string): string => encodeURIComponent(value).slice(0, 80);

function quantDocuments(
  dataset: {
    readonly name: string;
    readonly ref: { readonly id: string };
    readonly bars: ReadonlyArray<{ readonly date: string }>;
    readonly columnar: { readonly source: string; readonly rowCount: number };
  } | null,
  handoff: {
    readonly groupName: string;
    readonly series: ReadonlyArray<{ readonly name: string }>;
  } | null,
): ReadonlyArray<SearchDocument> {
  const documents: SearchDocument[] = [];
  if (dataset !== null) {
    const first = dataset.bars[0]?.date ?? "—";
    const last = dataset.bars.at(-1)?.date ?? "—";
    documents.push({
      id: `quant:dataset:${dataset.ref.id}`,
      source: "quant",
      kind: "dataset",
      title: dataset.name,
      subtitle: `${dataset.columnar.source} · ${dataset.columnar.rowCount.toLocaleString()} rows · ${first} — ${last}`,
      body: dataset.ref.id,
      tags: ["dataset", "quant", dataset.columnar.source],
      route: `/quant?dataset=${encodeURIComponent(dataset.name)}`,
      updatedAt: 0,
    });
  }
  if (handoff !== null) {
    documents.push({
      id: `quant:handoff:${sourceFor(handoff.groupName)}`,
      source: "quant",
      kind: "dataset",
      title: handoff.groupName,
      subtitle: `${handoff.series.length} instruments · Market Atlas handoff`,
      body: handoff.series.map((series) => series.name).join(" "),
      tags: ["market", "watchlist", "handoff"],
      route: "/quant",
      updatedAt: 0,
    });
  }
  return documents;
}

export function useQuantSearch(): void {
  const { search } = useRuntime();
  const dataset = useQuantLab((state) => state.dataset);
  const handoff = useQuantLab((state) => state.marketHandoff);
  useEffect(() => {
    search?.replaceSource("quant", quantDocuments(dataset, handoff));
  }, [search, dataset, handoff]);
}
