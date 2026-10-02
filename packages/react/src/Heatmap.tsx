import "./heatmap.css";

export interface HeatmapAxis {
  id: string;
  label: string;
  detail?: string;
}
export interface HeatmapCell {
  value: string;
  /** Normalized intensity in [0, 1]. */
  intensity: number;
  label: string;
  title?: string;
}
export interface HeatmapProps {
  rows: readonly HeatmapAxis[];
  columns: readonly HeatmapAxis[];
  cell: (row: string, column: string) => HeatmapCell | undefined;
  rowHeading: string;
  caption: string;
  ariaLabel: string;
  missingLabel?: string;
  selectedColumn?: string | undefined;
  onSelect?: (row: string, column: string) => void;
}

/** Generic matrix presentation; domain code owns values, labels and interpretation. */
export function Heatmap({
  rows,
  columns,
  cell,
  rowHeading,
  caption,
  ariaLabel,
  missingLabel = "无数据",
  selectedColumn,
  onSelect,
}: HeatmapProps) {
  return (
    <div className="ui-heatmap-scroll" tabIndex={0} aria-label={ariaLabel}>
      <table className="ui-heatmap-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{rowHeading}</th>
            {columns.map((column) => (
              <th
                scope="col"
                key={column.id}
                data-selected={column.id === selectedColumn || undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <b>{row.label}</b>
                {row.detail && <small>{row.detail}</small>}
              </th>
              {columns.map((column) => {
                const value = cell(row.id, column.id);
                return (
                  <td key={column.id} data-selected={column.id === selectedColumn || undefined}>
                    {value ? (
                      <button
                        type="button"
                        onClick={() => onSelect?.(row.id, column.id)}
                        style={{
                          background: `color-mix(in srgb, var(--color-accent) ${Math.max(0, Math.min(1, value.intensity)) * 55}%, var(--color-surface))`,
                        }}
                        aria-label={value.label}
                        title={value.title}
                      >
                        {value.value}
                      </button>
                    ) : (
                      <span aria-label={missingLabel}>—</span>
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
