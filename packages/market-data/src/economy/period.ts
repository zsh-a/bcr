import type { EconomicFrequency } from "./model";

export function isEconomicDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function monthEnd(year: number, month: number): string {
  const date = new Date("2000-01-01T00:00:00Z");
  date.setUTCFullYear(year, month, 0);
  return date.toISOString().slice(0, 10);
}
/** Native reference-period end, never a publication or availability date. W/D use their actual date. */
export function economicPeriodEnd(period: string, frequency: EconomicFrequency): string {
  let date: string;
  if (frequency === "A" && /^\d{4}$/u.test(period)) date = `${period}-12-31`;
  else if (frequency === "Q" && /^\d{4}-Q[1-4]$/u.test(period))
    date = monthEnd(Number(period.slice(0, 4)), Number(period.at(-1)) * 3);
  else if (frequency === "M" && /^\d{4}-(0[1-9]|1[0-2])$/u.test(period))
    date = monthEnd(Number(period.slice(0, 4)), Number(period.slice(5, 7)));
  else if ((frequency === "W" || frequency === "D") && isEconomicDate(period)) date = period;
  else throw new Error(`经济数据期次与频率不匹配：${period} / ${frequency}`);
  if (!isEconomicDate(date)) throw new Error(`经济数据期次无效：${period}`);
  return date;
}
export function economicMonthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}
export function economicMonthPeriod(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function shiftEconomicPeriod(
  period: string,
  frequency: EconomicFrequency,
  amount: number,
): string {
  if (frequency === "A") return String(Number(period) + amount).padStart(4, "0");
  if (frequency === "Q") {
    const index = Number(period.slice(0, 4)) * 4 + Number(period.at(-1)) - 1 + amount;
    return `${String(Math.floor(index / 4)).padStart(4, "0")}-Q${(index % 4) + 1}`;
  }
  if (frequency === "M") return economicMonthPeriod(economicMonthIndex(period) + amount);
  const date = new Date(`${period}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount * (frequency === "W" ? 7 : 1));
  return date.toISOString().slice(0, 10);
}
/** All expected A/Q/M ends within the inclusive date range; W/D calendars remain unknown. */
export function economicCalendarPeriods(
  start: string,
  end: string,
  frequency: EconomicFrequency,
): string[] | null {
  if (frequency === "W" || frequency === "D") return null;
  if (end < start) return [];
  const firstMonth = economicMonthIndex(start),
    lastMonth = economicMonthIndex(end);
  const result: string[] = [];
  for (let index = firstMonth; index <= lastMonth; index++) {
    const month = (index % 12) + 1;
    if (frequency === "Q" && month % 3 !== 0) continue;
    if (frequency === "A" && month !== 12) continue;
    const period =
      frequency === "M"
        ? economicMonthPeriod(index)
        : frequency === "A"
          ? String(Math.floor(index / 12)).padStart(4, "0")
          : `${String(Math.floor(index / 12)).padStart(4, "0")}-Q${month / 3}`;
    const date = economicPeriodEnd(period, frequency);
    if (date >= start && date <= end) result.push(period);
  }
  return result;
}
