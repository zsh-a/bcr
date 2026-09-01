import { useEffect, useRef, useState } from "react";
import { studio, useStudio } from "../store";
import { cueCps, CPS_LIMIT, type SubtitleCue } from "../subtitles";

export function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** 撤销/重做按钮组（快捷键 Ctrl/Cmd+Z、Shift+Z / Ctrl+Y 在 App 全局注册）。 */
export function UndoRedo() {
  const canUndo = useStudio((state) => state.canUndo);
  const canRedo = useStudio((state) => state.canRedo);
  return (
    <span className="flex items-center gap-1" data-testid="undo-redo">
      <button
        aria-label="撤销"
        className="w-9 text-[12px] text-[var(--color-faint)] hover:text-[var(--color-text)] disabled:opacity-30"
        data-testid="undo"
        disabled={!canUndo}
        title="撤销 (Ctrl+Z)"
        onClick={() => studio.undo()}
      >
        ↺
      </button>
      <button
        aria-label="重做"
        className="w-9 text-[12px] text-[var(--color-faint)] hover:text-[var(--color-text)] disabled:opacity-30"
        data-testid="redo"
        disabled={!canRedo}
        title="重做 (Ctrl+Shift+Z)"
        onClick={() => studio.redo()}
      >
        ↻
      </button>
    </span>
  );
}

/** 当前播放时刻所在的 cue（最后一个 start ≤ t 的条目；间隙中保持上一条）。 */
function activeCueIndex(cues: ReadonlyArray<SubtitleCue>, time: number): number | null {
  let active: number | null = null;
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (cue !== undefined && cue.start <= time) active = i;
    else break;
  }
  return active;
}

/** 字幕编辑器：时间轴 / 文本 / 译文行内编辑，删除与拆分，跟随播放高亮，CPS 超速告警。 */
export function CueEditor(props: { onSeek: (seconds: number) => void; getTime: () => number }) {
  const cues = useStudio((state) => state.cues);
  const dirty = useStudio((state) => state.dirty);
  const [selected, setSelected] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // 跟随播放：rAF 读取播放头（低频 setState——仅 active 变化时触发渲染）
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const index = activeCueIndex(cues, props.getTime());
      setActive((prev) => (prev === index ? prev : index));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues, props.getTime]);

  // 播放中的当前条目滚入视野
  useEffect(() => {
    if (active === null) return;
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

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
        <span className="ml-auto">CPS 上限 {CPS_LIMIT}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" ref={listRef}>
        {cues.map((cue, index) => (
          <CueRow
            key={`${index}-${cue.start}`}
            ref={index === active ? activeRowRef : undefined}
            index={index}
            cue={cue}
            expanded={selected === index}
            active={index === active}
            overspeed={cueCps(cue) > CPS_LIMIT}
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
  active: boolean;
  overspeed: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  ref?: React.Ref<HTMLDivElement> | undefined;
}) {
  const { index, cue } = props;
  return (
    <div
      ref={props.ref}
      data-active={props.active || undefined}
      className={`border-b border-[var(--color-border)] px-2 py-1.5 hover:bg-[var(--color-surface)] ${
        props.active
          ? "border-l-2 border-l-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
          : ""
      }`}
    >
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
        {props.overspeed && (
          <span
            className="mt-0.5 shrink-0 rounded bg-[color-mix(in_srgb,var(--color-amber)_18%,transparent)] px-1 font-mono text-[10px] text-[var(--color-amber)]"
            title={`显示速度超过 ${CPS_LIMIT} 单位/秒，观众可能读不完`}
          >
            CPS!
          </span>
        )}
        <div className="min-w-0 flex-1">
          <input
            className="w-full bg-transparent px-1 py-0.5"
            value={cue.text}
            onChange={(event) => studio.patchCue(index, { text: event.target.value })}
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
