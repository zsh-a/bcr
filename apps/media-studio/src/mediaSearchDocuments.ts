import {
  textVersion,
  citationFromParams,
  resolveTextCitation,
  type CitationSource,
  type SearchDocument,
} from "@bcr/core";
import type { SubtitleCue } from "./subtitles";

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
export function mediaCitationSources(
  sourceId: string,
  cues: ReadonlyArray<SubtitleCue>,
): CitationSource[] {
  const scope = JSON.stringify(["media", sourceId]);
  const version = textVersion(
    JSON.stringify(cues.map((cue) => [cue.start, cue.end, cue.text, cue.translation ?? ""])),
  );
  return cues.map((_, index) => ({ scope, version, unit: String(index), offset: 0 }));
}
export function mediaDocuments(
  source: { readonly ref: { readonly id: string }; readonly name: string } | null,
  cues: ReadonlyArray<SubtitleCue>,
  engine?: string | null,
): ReadonlyArray<SearchDocument> {
  if (!source) return [];
  const route = `/media?source=${encodeURIComponent(source.ref.id)}`;
  const sources = mediaCitationSources(source.ref.id, cues);
  return [
    {
      id: `media:source:${source.ref.id}`,
      source: "media",
      kind: "media",
      title: source.name,
      subtitle: `${cues.length} cues · ${source.ref.id}`,
      tags: ["media"],
      route,
      updatedAt: 0,
    },
    ...cues.flatMap((cue, index): SearchDocument[] => {
      if (
        !Number.isFinite(cue.start) ||
        !Number.isFinite(cue.end) ||
        cue.start < 0 ||
        cue.end < cue.start
      )
        return [];
      return [
        {
          id: `media:cue:${source.ref.id}:${index}`,
          source: "media",
          kind: "media",
          title: `${source.name} · ${clock(cue.start)}–${clock(cue.end)}`,
          subtitle: `${engine === "demo" ? "演示字幕" : "字幕"} ${index + 1} · ${cue.translation ? "原文 / 译文" : "原文"}`,
          body: [cue.text, cue.translation].filter(Boolean).join("\n"),
          tags: ["media", "subtitle"],
          route: `${route}&time=${cue.start}`,
          updatedAt: 0,
          citation: sources[index],
        },
      ];
    }),
  ];
}

export function mediaCitationTarget(
  search: string,
  sourceId: string | undefined,
  cues: ReadonlyArray<SubtitleCue> = [],
): {
  readonly time?: number;
  readonly error?: string;
  readonly cueIndex?: number;
  readonly quote?: string;
  readonly relocated?: boolean;
} {
  const params = new URLSearchParams(search);
  const requested = params.get("source");
  if (!requested) return {};
  if (requested !== sourceId)
    return { error: "这条引用的源媒体当前未载入，请重新导入原文件后打开引用。" };
  if (params.has("cite")) {
    const citation = citationFromParams(params);
    if (!citation) return { error: "引用格式无效" };
    const sources = mediaCitationSources(sourceId!, cues);
    const resolved = resolveTextCitation(
      citation,
      cues.map((cue, index) => ({
        text: [cue.text, cue.translation].filter(Boolean).join("\n"),
        source: sources[index]!,
      })),
    );
    if (resolved.status === "exact" || resolved.status === "relocated") {
      const cue = cues[resolved.candidate]!;
      return {
        time: cue.start,
        cueIndex: resolved.candidate,
        quote: citation.exact.slice(citation.hit.start, citation.hit.end),
        relocated: resolved.status === "relocated",
      };
    }
    return {
      error:
        resolved.status === "ambiguous"
          ? "字幕存在多个匹配位置，无法唯一定位，请核对原文。"
          : "引用字幕已修改或删除，无法定位；请对照保存的摘录。",
    };
  }
  const raw = params.get("time");
  if (raw === null) return {};
  const time = Number(raw);
  return raw.trim() && Number.isFinite(time) && time >= 0
    ? { time }
    : { error: "媒体引用时间无效" };
}
