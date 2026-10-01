import { useEffect, useRef } from "react";
import { ColorType, LineSeries, createChart } from "lightweight-charts";
import type { Evaluation } from "./evaluation";
export default function EvaluationChart({ evaluation }: { evaluation: Evaluation }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = createChart(element.current, {
      autoSize: true,
      height: 240,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: { vertTouchDrag: false },
    });
    const strategy = chart.addSeries(LineSeries, {
      color: "#269b8a",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    strategy.setData(evaluation.curve.map((p) => ({ time: p.date, value: p.strategy })));
    if (evaluation.benchmark) {
      const base = chart.addSeries(LineSeries, {
        color: "#c28a43",
        lineWidth: 2,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      base.setData(evaluation.curve.map((p) => ({ time: p.date, value: p.benchmark! })));
    }
    const style = () => {
      const css = getComputedStyle(element.current!);
      chart.applyOptions({
        layout: { textColor: css.getPropertyValue("--color-text-secondary").trim() || "#888" },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: css.getPropertyValue("--color-border").trim() || "#444" },
        },
      });
    };
    style();
    const observer = new MutationObserver(style);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    chart.timeScale().fitContent();
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [evaluation]);
  return (
    <div
      ref={element}
      className="research-evaluation-chart"
      role="img"
      aria-label="策略与基准的归一化净值曲线"
    />
  );
}
