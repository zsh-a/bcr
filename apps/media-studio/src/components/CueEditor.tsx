import { useState } from "react";
import { studio, useStudio } from "../store";
import type { SubtitleCue } from "../subtitles";

export function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** 字幕编辑器：时间轴 / 文本 / 译文行内编辑，删除与拆分。 */
export function CueEditor(props: { onSeek: (seconds: number) => void }) {
  const cues = useStudio((state) => state.cues);
  const dirty = useStudio((state) => state.dirty);
  const [selected, setSelected] = useState<number | null>(null);

  if (cues.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[var(--color-faint)]"
        data-testid="cue-empty"
      >
        提交流水线后字幕出现在这里
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cue-editor">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-faint)]">
        <span>{cues.length} 条</span>
        {dirty && <span className="text-[var(--color-amber)]">未保存的编辑（自动持久化）</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cues.map((cue, index) => (
          <CueRow
            key={`${index}-${cue.start}`}
            index={index}
            cue={cue}
            expanded={selected === index}
            onToggle={() => setSelected(selected === index ? null : index)}
            onSeek={props.onSeek}
          />
        ))}
      </div>
    </div>
  );
}

function CueRow(props: {
  index: number;
  cue: SubtitleCue;
  expanded: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
}) {
  const { index, cue } = props;
  return (
    <div className="border-b border-[var(--color-border)] px-2 py-1.5 hover:bg-[var(--color-surface)]">
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 w-10 shrink-0 text-left font-mono text-[10px] text-[var(--color-info)]"
          onClick={() => props.onSeek(cue.start)}
          title="定位播放"
        >
          {String(index + 1).padStart(3, "0")}
        </button>
        <button
          className="mt-0.5 shrink-0 font-mono text-[10px] text-[var(--color-faint)] tabular-nums"
          onClick={props.onToggle}
          title="展开时间轴编辑"
        >
          {formatClock(cue.start)} → {formatClock(cue.end)}
        </button>
        <div className="min-w-0 flex-1">
          <input
            className="w-full bg-transparent px-1 py-0.5"
            value={cue.text}
            onChange={(event) => studio.patchCue(index, { text: event.target.value })}
            onFocus={props.onToggle === undefined ? undefined : undefined}
          />
          {cue.translation !== undefined && (
            <input
              className="w-full bg-transparent px-1 py-0.5 text-[var(--color-muted)]"
              value={cue.translation}
              onChange={(event) => studio.patchCue(index, { translation: event.target.value })}
            />
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-info)]"
            title="拆分"
            onClick={() => studio.splitCue(index, 0.5)}
          >
            ⇄
          </button>
          <button
            className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
            title="删除"
            onClick={() => studio.deleteCue(index)}
          >
            ✕
          </button>
        </div>
      </div>
      {props.expanded && (
        <div className="mt-1 flex items-center gap-2 pl-12 font-mono text-[10px]">
          <label>
            start
            <input
              className="ml-1 w-16"
              type="number"
              step={0.1}
              value={cue.start}
              onChange={(event) => studio.patchCue(index, { start: Number(event.target.value) })}
            />
          </label>
          <label>
            end
            <input
              className="ml-1 w-16"
              type="number"
              step={0.1}
              value={cue.end}
              onChange={(event) => studio.patchCue(index, { end: Number(event.target.value) })}
            />
          </label>
          <button className="text-[var(--color-info)]" onClick={() => props.onSeek(cue.start)}>
            ▶ 从这里播放
          </button>
        </div>
      )}
    </div>
  );
}
