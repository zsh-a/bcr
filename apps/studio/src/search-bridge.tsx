import type { SearchDocument } from "@bcr/core";
import { listKnownInstruments } from "@bcr/market-data";
import { useStudio as useMediaStudio } from "@bcr/media-studio/store";
import { useQuantLab } from "@bcr/quant-lab/store";
import { useEffect } from "react";
import type { RuntimeServices } from "@bcr/react";
import { APPS } from "./shell/apps";
import { useStudio, type FileRecord, type TaskRecord } from "./store";

const sourceFor = (value: string): string => encodeURIComponent(value).slice(0, 80);

function appDocuments(): ReadonlyArray<SearchDocument> {
  return APPS.map((app) => ({
    id: `app:${app.id}`,
    source: "workspace",
    kind: "app",
    title: app.title,
    subtitle: app.description,
    body: `${app.title} ${app.description}`,
    tags: [app.id, "workspace"],
    route: app.path,
    updatedAt: 0,
  }));
}

function studioDocuments(
  files: ReadonlyArray<FileRecord>,
  tasks: ReadonlyArray<TaskRecord>,
): ReadonlyArray<SearchDocument> {
  return [
    ...files.map((file) => ({
      id: `studio:file:${file.ref.id}`,
      source: "studio",
      kind: "file" as const,
      title: file.name,
      subtitle: `${file.ref.format ?? file.ref.type} · ${file.ref.id}`,
      body: file.ref.id,
      tags: ["file", file.ref.type, file.ref.format ?? ""].filter(Boolean),
      route: `/studio?file=${encodeURIComponent(file.ref.id)}`,
      updatedAt: file.addedAt,
    })),
    ...tasks.map((task) => ({
      id: `studio:task:${task.id}`,
      source: "studio",
      kind: "task" as const,
      title: task.operation,
      subtitle: `${task.status} · ${task.runtime} · ${task.id}`,
      body: [task.inputId, ...(task.outputs ?? []).map((output) => output.id)].join(" "),
      tags: ["task", task.status, task.runtime],
      route: `/studio?task=${encodeURIComponent(task.id)}`,
      updatedAt: task.startedAt,
    })),
  ];
}

function mediaDocuments(
  source: {
    readonly ref: { readonly id: string };
    readonly name: string;
    readonly size: number;
  } | null,
  cues: ReadonlyArray<{ readonly text: string; readonly translation?: string | undefined }>,
): ReadonlyArray<SearchDocument> {
  if (source === null) return [];
  const body = cues
    .flatMap((cue) => [cue.text, cue.translation ?? ""])
    .filter(Boolean)
    .join(" ")
    .slice(0, 24_000);
  return [
    {
      id: `media:source:${source.ref.id}`,
      source: "media",
      kind: "media",
      title: source.name,
      subtitle: `${cues.length} cues · ${source.ref.id}`,
      ...(body.length === 0 ? {} : { body }),
      tags: ["media", "subtitle"],
      route: "/media",
      updatedAt: 0,
    },
  ];
}

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

function marketDocuments(): ReadonlyArray<SearchDocument> {
  return listKnownInstruments().map(({ instrument, aliases, providerType }) => ({
    id: `market:${instrument.id}`,
    source: "market",
    kind: "market-instrument",
    title: instrument.name,
    subtitle: `${instrument.symbol} · ${instrument.market} · ${instrument.venue}`,
    body: `${instrument.shortName} ${instrument.sourceSymbol} ${instrument.assetClass} ${providerType} ${aliases ?? ""}`,
    tags: ["market", instrument.market, instrument.assetClass, providerType],
    route: `/markets?instrument=${encodeURIComponent(instrument.id)}`,
    updatedAt: 0,
  }));
}

/**
 * Projects each mounted domain store into the host's shared search index.
 * Lazy apps can still contribute later; persisted documents remain available
 * until that app publishes its first hydrated snapshot.
 */
export function SearchBridge(props: { readonly services: RuntimeServices }) {
  const files = useStudio((state) => state.files);
  const tasks = useStudio((state) => state.tasks);
  const mediaSource = useMediaStudio((state) => state.source);
  const mediaCues = useMediaStudio((state) => state.cues);
  const dataset = useQuantLab((state) => state.dataset);
  const marketHandoff = useQuantLab((state) => state.marketHandoff);

  useEffect(() => {
    const search = props.services.search;
    if (search === undefined) return;
    search.replaceSource("workspace", appDocuments());
    search.replaceSource("studio", studioDocuments(files, tasks));
    search.replaceSource("media", mediaDocuments(mediaSource, mediaCues));
    search.replaceSource("quant", quantDocuments(dataset, marketHandoff));
    search.replaceSource("market", marketDocuments());
  }, [props.services.search, files, tasks, mediaSource, mediaCues, dataset, marketHandoff]);

  return null;
}
