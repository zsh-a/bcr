import { init, use, type EChartsCoreOption } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, GraphicComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { formatDecimal, type ModelResult } from "@bcr/economics-core";
import { FONT_FAMILY, viewportFor, type VisualSpec } from "./model";
export { FONT_FAMILY, RENDERER_VERSION, viewportFor, type VisualSpec } from "./model";

use([BarChart, LineChart, GridComponent, MarkLineComponent, GraphicComponent, SVGRenderer]);

function wrap(text: string, columns: number, lines: number) {
  const chars = Array.from(text.replace(/\s+/gu, " "));
  const result: string[] = [];
  for (let i = 0; i < Math.min(chars.length, columns * lines); i += columns)
    result.push(chars.slice(i, i + columns).join(""));
  if (chars.length > columns * lines) result[lines - 1] = `${result[lines - 1]!.slice(0, -1)}…`;
  return result.join("\n");
}

/** Each frame depends only on its arguments. No browser clock, transitions, or DOM state. */
export function renderAt({
  spec,
  result,
  time = 1,
}: {
  spec: VisualSpec;
  result: ModelResult;
  time?: number;
}): string {
  if (spec.version !== 1 || !["comparison", "break-even"].includes(spec.template))
    throw new Error("不支持的图表版本");
  if (!Number.isFinite(time)) throw new Error("渲染时间无效");
  const progress = Math.min(1, Math.max(0, time));
  const { width, height } = viewportFor(spec.layout),
    portrait = spec.layout === "portrait";
  const dark = spec.theme === "night";
  const color = dark ? "#edf0ec" : "#202d2a",
    muted = dark ? "#b8c4be" : "#5f716b";
  const green = dark ? "#8bd5b8" : "#24775f",
    orange = dark ? "#edba7d" : "#b16f33";
  const chart = init(null, undefined, { renderer: "svg", ssr: true, width, height });
  const label = (x: number, y: number, text: string, size: number, fill = color, weight = 400) => ({
    type: "text",
    left: x,
    top: y,
    style: {
      text,
      fill,
      fontFamily: FONT_FAMILY,
      fontSize: size,
      fontWeight: weight,
      lineHeight: size * 1.45,
    },
  });
  const description =
    spec.template === "comparison"
      ? "年卡与次卡 · 同一周期内的现金支出（元）"
      : "使用次数变化时，两种方案的累计成本（元）";
  const conclusion = result.breakEven.firstCheaper
    ? `第 ${result.breakEven.firstCheaper} 次起，年卡严格更便宜`
    : (result.breakEven.reason ?? "没有可用的临界点");
  const options: EChartsCoreOption = {
    animation: false,
    backgroundColor: dark ? "#192824" : "#f8f5ed",
    textStyle: { fontFamily: FONT_FAMILY, color, fontSize: 22 },
    color: [green, orange],
    graphic: [
      label(64, 45, "BCR  /  生活经济学", 19, muted),
      label(64, 94, wrap(spec.title, portrait ? 20 : 30, 2), 42, color, 600),
      label(64, 232, description, 23, muted),
      {
        type: "rect",
        left: 64,
        top: 287,
        shape: { width: 26, height: 14, r: 3 },
        style: { fill: green },
      },
      label(102, 279, "年卡", 20),
      {
        type: "rect",
        left: 244,
        top: 287,
        shape: { width: 26, height: 14, r: 3 },
        style: { fill: orange },
      },
      label(282, 279, "次卡", 20),
      label(64, height - 215, wrap(conclusion, portrait ? 24 : 40, 2), 29, green, 500),
      label(
        64,
        height - 110,
        wrap(spec.source || "来源：自设示例参数，不代表真实报价", portrait ? 38 : 58, 2),
        17,
        muted,
      ),
    ],
    grid: { left: portrait ? 135 : 150, right: 76, top: 330, bottom: 300, containLabel: false },
    yAxis: {
      type: "value",
      axisLabel: { color: muted, fontSize: 19 },
      splitLine: { lineStyle: { color: dark ? "#34463f" : "#e2e2d6" } },
    },
  };
  if (spec.template === "comparison") {
    options.xAxis = {
      type: "category",
      data: result.scenarios.map((s) => wrap(s.label, 9, 2)),
      axisLabel: { color, fontSize: 20, interval: 0 },
      axisTick: { show: false },
    };
    options.series = [
      {
        name: "年卡",
        type: "bar",
        barMaxWidth: 68,
        data: result.scenarios.map((s) => Number(s.total) * progress),
        label: {
          show: progress === 1 && result.scenarios.length <= 4,
          position: "top",
          color,
          fontSize: 19,
          formatter: (p: { dataIndex: number }) =>
            formatDecimal(result.scenarios[p.dataIndex]!.total),
        },
      },
      {
        name: "次卡",
        type: "bar",
        barMaxWidth: 68,
        data: result.scenarios.map((s) => Number(s.alternative) * progress),
        label: {
          show: progress === 1 && result.scenarios.length <= 4,
          position: "top",
          color,
          fontSize: 19,
          formatter: (p: { dataIndex: number }) =>
            formatDecimal(result.scenarios[p.dataIndex]!.alternative),
        },
      },
    ];
  } else {
    options.xAxis = {
      type: "value",
      name: "次",
      min: 0,
      max: Number(result.curve.at(-1)?.visits ?? 100),
      axisLabel: { color: muted, fontSize: 19 },
      nameTextStyle: { color: muted, fontSize: 20 },
      splitLine: { show: false },
    };
    const data = result.curve.slice(0, Math.max(1, Math.ceil(result.curve.length * progress)));
    options.series = [
      {
        name: "年卡",
        type: "line",
        showSymbol: false,
        lineStyle: { width: 5 },
        data: data.map((p) => [Number(p.visits), Number(p.total)]),
        markLine:
          result.breakEven.equalAt &&
          Number(result.breakEven.equalAt) <= Number(result.curve.at(-1)?.visits)
            ? {
                symbol: "none",
                label: {
                  formatter: `持平 ${formatDecimal(result.breakEven.equalAt, 2)} 次`,
                  fontFamily: FONT_FAMILY,
                  color,
                  fontSize: 19,
                },
                data: [{ xAxis: Number(result.breakEven.equalAt) }],
              }
            : undefined,
      },
      {
        name: "次卡",
        type: "line",
        showSymbol: false,
        lineStyle: { width: 5 },
        data: data.map((p) => [Number(p.visits), Number(p.alternative)]),
      },
    ];
  }
  try {
    chart.setOption(options);
    // ECharts allocates process-global IDs, including CSS classes. Rename complete
    // identifiers in encounter order so references and definitions remain stable.
    const ids = new Map<string, string>();
    return chart.renderToSVGString().replace(/zr\d+-[\w-]+/gu, (id) => {
      if (!ids.has(id)) ids.set(id, `bcr-node-${ids.size}`);
      return ids.get(id)!;
    });
  } finally {
    chart.dispose();
  }
}
