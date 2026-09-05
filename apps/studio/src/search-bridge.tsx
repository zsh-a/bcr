import type { SearchDocument } from "@bcr/core";
import { listKnownInstruments } from "@bcr/market-data";
import type { RuntimeServices } from "@bcr/react";
import { useEffect } from "react";
import { APPS } from "./shell/apps";
import { useStudio, type FileRecord, type TaskRecord } from "./store";

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

  useEffect(() => {
    const search = props.services.search;
    if (search === undefined) return;
    search.replaceSource("workspace", appDocuments());
    search.replaceSource("studio", studioDocuments(files, tasks));
    search.replaceSource("market", marketDocuments());
  }, [props.services.search, files, tasks]);

  return null;
}
