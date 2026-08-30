/**
 * 字幕领域模型（Subtitle Studio v1）。
 *
 * Cue 是整条链路的通用货币：ASR chunks → segment 规范化 → translate 双语 →
 * 编辑 → 导出。时间单位一律秒（f64），导出时才格式化。
 */

export interface SubtitleCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** 译文（Whisper translate 或人工）；空串表示无。 */
  readonly translation?: string | undefined;
}

export interface MediaInfo {
  readonly durationS: number;
  readonly sampleRate: number;
  readonly samples: number;
}

export interface SegmentOptions {
  /** 单条最大时长（秒）。 */
  readonly maxDurationS: number;
  /** 单条最大字符数（CJK 计 1，Latin 词计 1）。 */
  readonly maxChars: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  maxDurationS: 5,
  maxChars: 30,
};

/** 显示用长度：CJK 字符计 1，连续拉丁词计 1。 */
export function cueLength(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
  const other = text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "").length;
  return cjk + latinWords + Math.ceil(other / 4);
}

/**
 * ASR chunks → 规范化 Cue：过长按时长/字符上限拆分（按字符比例切时间），
 * 相邻过短且同段合并。纯函数，subtitle.segment operation 的实现核心。
 */
export function normalizeCues(
  chunks: ReadonlyArray<{ readonly start: number; readonly end: number; readonly text: string }>,
  options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): SubtitleCue[] {
  const cleaned = chunks
    .map((chunk) => ({ ...chunk, text: chunk.text.trim() }))
    .filter((chunk) => chunk.text.length > 0 && chunk.end > chunk.start);

  const split: SubtitleCue[] = [];
  for (const chunk of cleaned) {
    const duration = chunk.end - chunk.start;
    const units = Math.max(1, cueLength(chunk.text));
    const byDuration = Math.ceil(duration / options.maxDurationS);
    const byChars = Math.ceil(units / options.maxChars);
    // 时长或显示长度任一超限即拆，取两者中更激进者
    const parts = Math.max(1, Math.max(byDuration, byChars));
    if (parts === 1) {
      split.push({ start: chunk.start, end: chunk.end, text: chunk.text });
      continue;
    }
    // 按显示长度比例切时间轴；文本尽量在空格/标点处断开
    const boundaries = textBoundaries(chunk.text, parts);
    let cursor = chunk.start;
    for (let i = 0; i < parts; i += 1) {
      const fraction = (i + 1) / parts;
      const end = i === parts - 1 ? chunk.end : chunk.start + duration * fraction;
      split.push({ start: cursor, end, text: boundaries[i] ?? chunk.text });
      cursor = end;
    }
  }

  // 合并过短碎片（< 0.8s 且合并后不超限）
  const merged: SubtitleCue[] = [];
  for (const cue of split) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      cue.end - cue.start < 0.8 &&
      prev.end - prev.start + (cue.end - cue.start) <= options.maxDurationS &&
      cueLength(prev.text) + cueLength(cue.text) <= options.maxChars
    ) {
      merged[merged.length - 1] = {
        start: prev.start,
        end: cue.end,
        text: joinText(prev.text, cue.text),
      };
    } else {
      merged.push(cue);
    }
  }
  return merged;
}

function joinText(a: string, b: string): string {
  const needsSpace = /[A-Za-z0-9'’-]$/.test(a) && /^[A-Za-z0-9'’-]/.test(b);
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

/** 把文本切成 parts 段：优先空格/标点，CJK 无空格时按长度均分。 */
function textBoundaries(text: string, parts: number): string[] {
  if (parts <= 1) return [text];
  const target = text.length / parts;
  const cuts: number[] = [];
  let from = 0;
  for (let i = 1; i < parts; i += 1) {
    const ideal = Math.round(target * i);
    // 在 ideal 附近找一个软边界（空格/标点）
    let cut = ideal;
    for (let probe = 0; probe < Math.ceil(target / 2); probe += 1) {
      if (ideal + probe < text.length && /[\s，。！？,.!?;；:：]/.test(text[ideal + probe] ?? "")) {
        cut = ideal + probe + 1;
        break;
      }
      if (ideal - probe > from && /[\s，。！？,.!?;；:：]/.test(text[ideal - probe] ?? "")) {
        cut = ideal - probe + 1;
        break;
      }
    }
    cuts.push(Math.min(text.length, Math.max(from + 1, cut)));
    from = cuts[cuts.length - 1] ?? text.length;
  }
  const segments: string[] = [];
  let prev = 0;
  for (const cut of [...cuts, text.length]) {
    segments.push(text.slice(prev, cut).trim());
    prev = cut;
  }
  return segments.filter((segment) => segment.length > 0);
}
