import type { EChartsOption } from "echarts";

export interface ChartPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  colors: string[];
}
export interface ChartPresentation {
  compact: boolean;
  focusedCountry: string | null;
}
export const CHART_MONO = '"IBM Plex Mono", monospace';
export function transparent(color: string, opacity: number) {
  const hex = /^#([\da-f]{6})$/iu.exec(color)?.[1];
  return hex
    ? `rgba(${Number.parseInt(hex.slice(0, 2), 16)},${Number.parseInt(hex.slice(2, 4), 16)},${Number.parseInt(hex.slice(4, 6), 16)},${opacity})`
    : color;
}
export function baseChartOption(palette: ChartPalette, reducedMotion: boolean): EChartsOption {
  return {
    animation: !reducedMotion,
    animationDuration: 320,
    animationDurationUpdate: 240,
    animationEasingUpdate: "cubicOut",
    textStyle: { fontFamily: '"IBM Plex Sans", sans-serif', color: palette.text },
    color: palette.colors,
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: "axis",
      renderMode: "html",
      className: "macro-native-tooltip",
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 0,
      transitionDuration: reducedMotion ? 0 : 0.12,
      textStyle: {
        color: palette.text,
        fontSize: 12,
        lineHeight: 24,
      },
    },
  };
}

/** DOM text nodes keep source labels out of HTML parsing. */
export function createChartTooltip({
  title,
  subtitle = "",
  rows = [],
  footer = "",
}: {
  title: string;
  subtitle?: string;
  rows?: { label: string; value: string; color?: string }[];
  footer?: string;
}): HTMLElement {
  const root = document.createElement("div");
  root.className = "macro-chart-tooltip";
  const heading = document.createElement("header"),
    strong = document.createElement("strong"),
    caption = document.createElement("span");
  strong.textContent = title;
  caption.textContent = subtitle;
  heading.append(strong, caption);
  root.append(heading);
  for (const row of rows) {
    const line = document.createElement("div"),
      label = document.createElement("span"),
      value = document.createElement("b");
    line.className = "macro-tooltip-row";
    if (row.color) {
      const dot = document.createElement("i");
      dot.style.background = row.color;
      label.append(dot);
    }
    label.append(document.createTextNode(row.label));
    value.textContent = row.value;
    line.append(label, value);
    root.append(line);
  }
  if (footer) {
    const note = document.createElement("footer");
    note.textContent = footer;
    root.append(note);
  }
  return root;
}
