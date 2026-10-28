import { useId } from "react";
import type { ResearchChartProps } from "./chart-types";
import { countryColor } from "./chart-options";
import { eventPeriod, formatResearchValue, FREQUENCY_LABELS, nativePoint } from "./interaction";
import { useResearchChart } from "./useResearchChart";
import { useResearchPalette } from "./useResearchPalette";
import "./chart.css";

export function ResearchChart(props: ResearchChartProps) {
  const palette = useResearchPalette(),
    chart = useResearchChart(props, palette),
    helpId = useId(),
    height = props.height ?? 150,
    mixedUnits = new Set(props.tracks.map((track) => track.series.unit)).size > 1,
    empty = !props.tracks.some((track) =>
      track.points.some((point) => point.value !== null && Number.isFinite(point.value)),
    );
  return (
    <figure className="research-chart-figure" data-large={height >= 260}>
      <div className="research-chart-stage" style={{ height }}>
        <div
          ref={chart.host}
          className="research-chart-canvas"
          role="application"
          tabIndex={0}
          aria-label={`${props.label}，按左右键选择原始期次，Home 和 End 跳至首末期次，Escape 取消固定。`}
          aria-describedby={helpId}
          onKeyDown={chart.onKeyDown}
          data-ready={chart.ready}
          data-cursor-date={props.cursorDate ?? ""}
        />
        <div ref={chart.cursorLine} className="research-chart-cursor" aria-hidden="true" hidden />
        <div ref={chart.tooltip} className="research-native-tooltip" aria-hidden="true" hidden />
        {(empty || mixedUnits) && (
          <p className="research-chart-empty" role="status">
            {mixedUnits ? "序列单位不同，请分别查看。" : "此范围暂无可用观测。"}
          </p>
        )}
      </div>
      <figcaption className="research-chart-caption">
        <div
          className="research-chart-readings"
          aria-label={props.cursorDate ? `${props.cursorDate} 参考读数` : "最近有效观测"}
        >
          {props.tracks.map((track) => {
            const point = props.cursorDate
              ? nativePoint(track.points, props.cursorDate)
              : track.reading;
            return (
              <span
                className="research-chart-reading"
                key={track.series.id}
                title={`${track.series.country} · 原始${FREQUENCY_LABELS[track.series.frequency]} · ${point?.period ?? "暂无观测"}`}
              >
                <i
                  style={{
                    backgroundColor: countryColor(track.series.country, chart.colors, palette),
                  }}
                  aria-hidden="true"
                />
                <span>{track.series.country}</span>
                <b>{formatResearchValue(point?.value, track.series.unit, track.series.currency)}</b>
                <small>{point?.period ?? "—"}</small>
              </span>
            );
          })}
        </div>
        <div className="research-chart-controls">
          <span id={helpId} className="research-chart-help">
            原始期次 · 缺失断线
          </span>
          <button
            type="button"
            aria-pressed={chart.pinned}
            onClick={chart.togglePin}
            title="固定参考日；也可在图表按左右键选择原始期次"
          >
            {chart.pinned ? "已固定参考日" : "固定参考日"}
          </button>
        </div>
        {props.event && (
          <p className="research-chart-event-note">
            {eventPeriod(props.event)} · {props.event.title}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
export default ResearchChart;
