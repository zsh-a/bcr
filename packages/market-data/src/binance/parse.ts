import { MINUTE, type FundingRate, type MinuteBar } from "./model";

/** Strict USD-M archives use milliseconds, unlike newer spot archives. */
export function parseMinuteCsv(csv: string): MinuteBar[] {
  return readMinuteCsv(csv, true).bars;
}

/** Inspect verified source rows before repairing calendar gaps. Invalid quotes,
 * duplicate timestamps and out-of-order rows always fail, even in a month file. */
export function inspectMinuteCsv(csv: string): { bars: MinuteBar[]; lines: string[] } {
  return readMinuteCsv(csv, false);
}

function readMinuteCsv(csv: string, contiguous: boolean) {
  const bars: MinuteBar[] = [];
  const lines: string[] = [];
  for (const [index, line] of csv.trim().split(/\r?\n/u).entries()) {
    const cells = line.split(",");
    if (index === 0 && cells[0] === "open_time") continue;
    const [time, open, high, low, close, volume] = cells.slice(0, 6).map(Number);
    if (
      cells.length < 7 ||
      cells.slice(0, 7).some((cell) => !cell.trim()) ||
      ![time, open, high, low, close, volume].every(
        (value) => value !== undefined && Number.isFinite(value),
      ) ||
      !Number.isSafeInteger(time) ||
      time! < 1e12 ||
      time! >= 1e14 ||
      time! % MINUTE !== 0 ||
      open! <= 0 ||
      low! <= 0 ||
      high! < Math.max(open!, close!) ||
      low! > Math.min(open!, close!) ||
      volume! < 0 ||
      Number(cells[6]) !== time! + MINUTE - 1 ||
      (bars.length > 0 && time! <= bars.at(-1)!.time)
    )
      throw new Error(`Binance K 线第 ${index + 1} 行无效或时间重复、乱序`);
    if (contiguous && bars.length > 0 && time! !== bars.at(-1)!.time + MINUTE)
      throw new Error(
        `Binance K 线第 ${index + 1} 行行情不连续：缺少 ${new Date(bars.at(-1)!.time + MINUTE).toISOString()} 起的分钟数据`,
      );
    bars.push({ time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! });
    lines.push(line);
  }
  if (!bars.length) throw new Error("Binance K 线档案为空");
  return { bars, lines };
}
export function parseFundingCsv(csv: string): FundingRate[] {
  const funding: FundingRate[] = [];
  for (const [index, line] of csv.trim().split(/\r?\n/u).entries()) {
    const cells = line.split(",");
    if (index === 0 && cells[0] === "calc_time") continue;
    const [time, intervalHours, rate] = cells.map(Number);
    if (
      cells.length !== 3 ||
      ![time, intervalHours, rate].every(
        (value) => value !== undefined && Number.isFinite(value),
      ) ||
      !Number.isSafeInteger(time) ||
      time! < 1e12 ||
      time! >= 1e14 ||
      intervalHours! <= 0 ||
      intervalHours! > 24 ||
      Math.abs(rate!) > 1 ||
      (funding.length > 0 && time! <= funding.at(-1)!.time)
    )
      throw new Error(`Binance 资金费率第 ${index + 1} 行无效`);
    funding.push({ time: time!, rate: rate!, intervalHours: intervalHours! });
  }
  if (!funding.length) throw new Error("Binance 资金费率档案为空");
  return funding;
}
