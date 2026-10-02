export interface BreadthDay {
  date: string;
  breadth: { industry: string; above: number; total: number; ratio: number }[];
}

/** Market interpretation of a breadth matrix, independent of its rendering library. */
export function breadthGrid(days: readonly BreadthDay[], names: Record<string, string> = {}) {
  const industries = [
    ...new Set(days.flatMap((day) => day.breadth.map((value) => value.industry))),
  ].sort();
  const indexed = new Map(
    days.map((day) => [day.date, new Map(day.breadth.map((value) => [value.industry, value]))]),
  );
  return {
    rows: industries.map((id) => ({
      id,
      label: names[id] || id,
      ...(names[id] ? { detail: id } : {}),
    })),
    columns: days.map((day) => ({ id: day.date, label: day.date.slice(5) })),
    rowHeading: "行业",
    caption: "复权收盘价高于 MA20 的行业成员占比，空白代表可计算成员不足",
    ariaLabel: "可横向滚动的行业宽度热图",
    missingLabel: "可计算成员不足",
    cell: (industry: string, date: string) => {
      const value = indexed.get(date)?.get(industry);
      return value
        ? {
            value: value.ratio.toFixed(0),
            intensity: value.ratio / 100,
            label: `${names[industry] || industry} ${date} 宽度 ${value.ratio}%，${value.above}/${value.total} 只`,
            title: `${date} · ${value.above} / ${value.total} 只高于 MA20`,
          }
        : undefined;
    },
  };
}
