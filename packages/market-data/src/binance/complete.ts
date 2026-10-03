import type { VerifiedArchive } from "./archive";
import { DAY, MINUTE, utcDate } from "./model";
import { inspectMinuteCsv } from "./parse";
import type { ArchiveWindow } from "./plan";

/** Replace only incomplete UTC days using verified official daily archives.
 * Preserve the original rows (including fields unused by the backtest) and
 * receipts; never interpolate a missing quote or accept an incomplete day. */
export async function completeMinuteArchive<T extends VerifiedArchive>(
  source: T,
  window: ArchiveWindow,
  daily: (window: ArchiveWindow) => Promise<T>,
): Promise<{ csv: string; replacements: { date: string; archive: T }[] }> {
  try {
    const { bars, lines } = inspectMinuteCsv(source.csv);
    if (bars[0]!.time < window.from || bars.at(-1)!.time >= window.to)
      throw new Error("行情包含档案日期之外的分钟");
    const missing = new Set<number>();
    let expected = window.from;
    const gap = (to: number) => {
      for (let day = Math.floor(expected / DAY) * DAY; day < to; day += DAY) missing.add(day);
    };
    for (const bar of bars) {
      if (bar.time > expected) gap(bar.time);
      expected = bar.time + MINUTE;
    }
    if (expected < window.to) gap(window.to);
    if (!missing.size) return { csv: source.csv, replacements: [] };
    if (window.period !== "monthly")
      throw new Error(`官方日档案仍缺少分钟（${utcDate(missing.values().next().value!)} UTC）`);

    const rows = new Map(bars.map((bar, i) => [bar.time, lines[i]!]));
    const replacements: { date: string; archive: T }[] = [];
    for (const from of missing) {
      const date = utcDate(from);
      const archive = await daily({ from, to: from + DAY, date, period: "daily" });
      const complete = await completeMinuteArchive(
        archive,
        { from, to: from + DAY, date, period: "daily" },
        daily,
      );
      const replacement = inspectMinuteCsv(complete.csv);
      for (const [i, bar] of replacement.bars.entries()) rows.set(bar.time, replacement.lines[i]!);
      replacements.push({ date, archive });
    }
    const csv = Array.from({ length: (window.to - window.from) / MINUTE }, (_, i) =>
      rows.get(window.from + i * MINUTE)!,
    ).join("\n");
    // Re-validate the entire calendar before exposing a derived partition.
    const complete = inspectMinuteCsv(csv).bars;
    if (
      complete.length !== (window.to - window.from) / MINUTE ||
      complete.some((bar, i) => bar.time !== window.from + i * MINUTE)
    )
      throw new Error("官方日档案未能恢复完整分钟行情");
    return { csv, replacements };
  } catch (error) {
    throw new Error(
      `${source.url.split("/").at(-1)}：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
