import { dateText, type ResearchManifest } from "@bcr/market-data/research/model";
export function candleWindow(
  manifest: ResearchManifest,
  start: number,
  end: number,
  date: string,
  range: string,
) {
  const sessions = manifest.calendar.filter((d) => d.date >= start && d.date <= end);
  if (!sessions.length || range === "all") return { from: start, to: end };
  if (range === "year")
    return { from: sessions[Math.max(0, sessions.length - 252)]!.date, to: end };
  const found = sessions.findIndex((d) => dateText(d.date) >= date);
  const index = found < 0 ? sessions.length - 1 : found;
  return {
    from: sessions[Math.max(0, index - 35)]!.date,
    to: sessions[Math.min(sessions.length - 1, index + 20)]!.date,
  };
}
