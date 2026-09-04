import { type DataCell, type DataColumnType, type DataTablePackage } from "@bcr/data-core";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { useMemo } from "react";

function formatCell(value: DataCell): string {
  if (value === null) return "—";
  if (typeof value === "number") {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
  }
  return String(value);
}

export function dataColumnTypeLabel(type: DataColumnType): string {
  if (type === "number") return "NUMBER";
  if (type === "boolean") return "BOOL";
  if (type === "date") return "DATE";
  if (type === "null") return "EMPTY";
  return "TEXT";
}

export function DataTableView(props: {
  readonly table: DataTablePackage;
  readonly query: string;
  readonly sortColumn: number | null;
  readonly sortDirection: "asc" | "desc";
  readonly onSort: (column: number) => void;
}) {
  const filteredRows = useMemo(() => {
    const normalized = props.query.trim().toLocaleLowerCase();
    const rows = props.table.rows.filter((row) => {
      if (normalized.length === 0) return true;
      return row.some((value) => formatCell(value).toLocaleLowerCase().includes(normalized));
    });
    if (props.sortColumn === null) return rows;
    const column = props.sortColumn;
    return [...rows].sort((left, right) => {
      const a = left[column];
      const b = right[column];
      const av = a === null ? "" : a;
      const bv = b === null ? "" : b;
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "zh-CN", { numeric: true, sensitivity: "base" });
      return props.sortDirection === "asc" ? result : -result;
    });
  }, [props]);
  const visible = filteredRows.slice(0, 250);
  return (
    <div className="data-table-frame">
      <div className="data-table-scroll-hint" aria-hidden="true">
        左右滑动查看完整表格
      </div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-row-number">#</th>
              {props.table.columns.map((column, index) => {
                const active = props.sortColumn === index;
                return (
                  <th
                    key={column.id}
                    aria-sort={
                      active ? (props.sortDirection === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button
                      type="button"
                      className="data-column-button"
                      onClick={() => props.onSort(index)}
                    >
                      <span>
                        {column.name}
                        <small>{dataColumnTypeLabel(column.type)}</small>
                      </span>
                      {active ? (
                        props.sortDirection === "asc" ? (
                          <ArrowDownAZ className="data-icon" />
                        ) : (
                          <ArrowUpAZ className="data-icon" />
                        )
                      ) : (
                        <span className="data-sort-placeholder">↕</span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.map((value) => String(value)).join("|")}`}>
                <td className="data-row-number">{rowIndex + 1}</td>
                {props.table.columns.map((column, columnIndex) => (
                  <td key={column.id} className={column.type === "number" ? "is-number" : ""}>
                    {formatCell(row[columnIndex] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-table-footer">
        <span>
          {filteredRows.length.toLocaleString("zh-CN")} matching rows · showing {visible.length}
        </span>
        {filteredRows.length > visible.length && <span>Preview capped at 250 rows</span>}
      </div>
    </div>
  );
}
