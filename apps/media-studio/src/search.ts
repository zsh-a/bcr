import type { SearchDocument } from "@bcr/core";
import { useRuntime } from "@bcr/react";
import { useEffect } from "react";
import { useStudio } from "./store";

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

export function useMediaSearch(): void {
  const { search } = useRuntime();
  const source = useStudio((state) => state.source);
  const cues = useStudio((state) => state.cues);
  useEffect(() => {
    search?.replaceSource("media", mediaDocuments(source, cues));
  }, [search, source, cues]);
}
