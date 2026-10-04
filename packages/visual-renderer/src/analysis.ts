import { init, use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { AnalysisResult } from "@bcr/economics-core/analysis";
import { FONT_FAMILY } from "./model";
use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer]);

export function renderAnalysisChart(
  result: AnalysisResult,
  outputs: readonly string[],
  kind: "bar" | "line",
  width = 900,
  height = 420,
  dark = false,
): string {
  const columns = outputs.map((id) => {
    const c = result.columns.find((c) => c.id === id);
    if (!c) throw new Error("图表输出缺失");
    return c;
  });
  if (!columns.length || new Set(columns.map((c) => c.unit)).size !== 1)
    throw new Error("图表需要相同单位的输出");
  const rows = kind === "line" ? result.sweep : result.rows;
  const chart = init(null, undefined, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption({
      animation: false,
      color: ["#2f826b", "#b77537", "#6b82a1", "#a85e68", "#7b8644", "#9d75a9"],
      textStyle: { fontFamily: FONT_FAMILY, fontSize: 14, color: dark ? "#e4ece7" : "#243e34" },
      legend: { top: 8, textStyle: { color: dark ? "#e4ece7" : "#243e34", fontSize: 14 } },
      grid: { left: 24, right: 24, top: 75, bottom: 28, containLabel: true },
      xAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { hideOverlap: true } },
      yAxis: {
        type: "value",
        name: columns[0]!.unit,
        splitLine: { lineStyle: { color: dark ? "#344b42" : "#dce3dc" } },
      },
      series: columns.map((c) => ({
        name: c.label,
        type: kind,
        showSymbol: false,
        barMaxWidth: 52,
        data: rows.map((r) => Number(r.values[c.id])),
      })),
    });
    const ids = new Map<string, string>();
    let hash = 2166136261;
    for (const char of JSON.stringify([outputs, kind, dark]))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return chart.renderToSVGString().replace(/zr\d+-[\w-]+/gu, (id) => {
      if (!ids.has(id)) ids.set(id, `bcr-chart-${hash >>> 0}-${ids.size}`);
      return ids.get(id)!;
    });
  } finally {
    chart.dispose();
  }
}
