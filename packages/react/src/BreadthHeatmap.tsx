import "./breadth-heatmap.css";
export interface BreadthHeatmapDay {
  date: string;
  breadth: { industry: string; above: number; total: number; ratio: number }[];
}
export function BreadthHeatmap({
  days,
  labels = {},
  selectedDate,
  onSelect,
}: {
  days: BreadthHeatmapDay[];
  labels?: Record<string, string>;
  selectedDate?: string | undefined;
  onSelect?: (industry: string, date: string) => void;
}) {
  const industries = [...new Set(days.flatMap((day) => day.breadth.map((b) => b.industry)))].sort();
  const indexed = days.map((day) => new Map(day.breadth.map((b) => [b.industry, b])));
  return (
    <div className="ui-breadth-scroll" tabIndex={0} aria-label="可横向滚动的行业宽度热图">
      <table className="ui-breadth-table">
        <caption className="sr-only">
          复权收盘价高于 MA20 的行业成员占比，空白代表可计算成员不足
        </caption>
        <thead>
          <tr>
            <th scope="col">行业</th>
            {days.map((d) => (
              <th scope="col" key={d.date} data-selected={d.date === selectedDate || undefined}>
                {d.date.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {industries.map((industry) => (
            <tr key={industry}>
              <th scope="row">
                <b>{labels[industry] || industry}</b>
                {labels[industry] && <small>{industry}</small>}
              </th>
              {days.map((day, i) => {
                const b = indexed[i]!.get(industry);
                return (
                  <td key={day.date} data-selected={day.date === selectedDate || undefined}>
                    {b ? (
                      <button
                        type="button"
                        onClick={() => onSelect?.(industry, day.date)}
                        style={{
                          background: `color-mix(in srgb, var(--color-accent) ${Math.min(55, b.ratio * 0.55)}%, var(--color-surface))`,
                        }}
                        aria-label={`${labels[industry] || industry} ${day.date} 宽度 ${b.ratio}%，${b.above}/${b.total} 只`}
                        title={`${day.date} · ${b.above} / ${b.total} 只高于 MA20`}
                      >
                        {b.ratio.toFixed(0)}
                      </button>
                    ) : (
                      <span aria-label="可计算成员不足">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
