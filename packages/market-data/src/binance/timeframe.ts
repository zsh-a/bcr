import { MINUTE, type MinuteBar } from "./model";

/** Complete UTC candles only; never expose a partial candle as a closed signal. */
export function aggregateMinuteBars(bars: readonly MinuteBar[], minutes: number): MinuteBar[] {
  if (!Number.isInteger(minutes) || minutes < 1 || 1440 % minutes !== 0)
    throw new Error("K 线周期必须整除一个 UTC 日");
  const interval = minutes * MINUTE;
  const result: MinuteBar[] = [];
  let bucket: MinuteBar | undefined;
  let rows = 0;
  let previous: number | undefined;
  for (const bar of bars) {
    if (previous !== undefined && bar.time !== previous + MINUTE)
      throw new Error("聚合行情必须连续且按分钟排序");
    previous = bar.time;
    const start = Math.floor(bar.time / interval) * interval;
    if (bucket?.time !== start) {
      bucket = { ...bar, time: start };
      rows = 1;
    } else {
      bucket.high = Math.max(bucket.high, bar.high);
      bucket.low = Math.min(bucket.low, bar.low);
      bucket.close = bar.close;
      bucket.volume += bar.volume;
      rows++;
    }
    if (bar.time + MINUTE === start + interval && rows === minutes) result.push(bucket);
  }
  return result;
}
