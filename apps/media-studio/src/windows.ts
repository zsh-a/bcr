/**
 * 分段 ASR 的窗口规划（纯函数，Node 可测）。
 *
 * 长音频按窗口切片推理：窗口 i 覆盖 [start, start+window+stride)，
 * 但只"拥有" [start, start+window) —— stride 区间的字幕由下一个窗口
 * 重新转写并归属，避免边界词被截断或重复。
 */

export interface SampleWindow {
  readonly start: number;
  readonly end: number;
  /** 本窗口独占区间（秒制规划时同样适用）。 */
  readonly ownEnd: number;
}

export function planSampleWindows(
  totalSamples: number,
  windowSamples: number,
  strideSamples: number,
): ReadonlyArray<SampleWindow> {
  const windows: SampleWindow[] = [];
  if (totalSamples <= 0 || windowSamples <= 0) return windows;
  for (let start = 0; start < totalSamples; start += windowSamples) {
    windows.push({
      start,
      end: Math.min(totalSamples, start + windowSamples + strideSamples),
      ownEnd: Math.min(totalSamples, start + windowSamples),
    });
  }
  return windows;
}

/** 只保留 start 落在本窗口独占区间 [ownStartS, ownEndS) 内的 chunk。 */
export function ownedChunks<T extends { readonly start: number }>(
  chunks: ReadonlyArray<T>,
  ownStartS: number,
  ownEndS: number,
): ReadonlyArray<T> {
  return chunks.filter((chunk) => chunk.start >= ownStartS && chunk.start < ownEndS);
}
