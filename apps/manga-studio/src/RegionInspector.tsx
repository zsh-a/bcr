import { X } from "lucide-react";
import { findGlossaryMatches } from "./glossary";
import type { MangaGlossaryEntry, TextRegion } from "./model";
import { manga } from "./store";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function RegionInspector({
  region,
  glossary,
}: {
  region: TextRegion;
  glossary: ReadonlyArray<MangaGlossaryEntry>;
}) {
  const matches = findGlossaryMatches(region.sourceText, glossary);
  return (
    <div className="manga-inspector-fields">
      <div className="manga-inspector-title-row">
        <span className="manga-inspector-id">{region.label}</span>
        <span
          className={
            region.confidence < 0.7
              ? "manga-review-badge manga-review-badge-warn"
              : "manga-review-badge"
          }
        >
          {region.confidence < 0.7 ? "REVIEW" : "CONFIDENT"}
        </span>
      </div>
      <label>
        <span>原文 / OCR 输出</span>
        <textarea
          aria-label="原文 OCR 输出"
          value={region.sourceText}
          onChange={(event) => manga.patchRegion(region.id, { sourceText: event.target.value })}
          rows={2}
        />
      </label>
      <label>
        <span>译文 / 可直接编辑</span>
        <textarea
          aria-label="译文"
          value={region.translatedText}
          onChange={(event) => manga.patchRegion(region.id, { translatedText: event.target.value })}
          rows={2}
        />
      </label>
      <div className="manga-inspector-grid">
        <label>
          <span>阅读方向</span>
          <select
            aria-label="阅读方向"
            value={region.writingMode}
            onChange={(event) =>
              manga.patchRegion(region.id, {
                writingMode: event.target.value as TextRegion["writingMode"],
              })
            }
          >
            <option value="horizontal-tb">横排</option>
            <option value="vertical-rl">竖排</option>
          </select>
        </label>
        <label>
          <span>置信度</span>
          <input value={percent(region.confidence)} readOnly aria-label="OCR 置信度" />
        </label>
      </div>
      <div
        className={`manga-glossary-hit ${matches.length > 0 ? "manga-glossary-hit-active" : ""}`}
      >
        <span className="manga-glossary-dot" />
        <span>
          {matches.length > 0
            ? `Glossary 命中 · ${matches.map((entry) => `${entry.source} → ${entry.target}`).join(" · ")}`
            : "Glossary 未命中 · 可在上方加入术语"}
        </span>
      </div>
      <button
        type="button"
        className="manga-remove-region"
        onClick={() => manga.removeRegion(region.id)}
      >
        <X className="size-3.5" /> 删除此区域
      </button>
    </div>
  );
}
