import { Expand, Pin, PinOff } from "lucide-react";
import { IconButton } from "@bcr/react";
import type { EconomicMetric, EconomicRepository, EconomicTrack } from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";
import { ResearchChart } from "./ResearchChart";
import { FREQUENCY_NAMES, pointLabel, trackReading } from "./presentation";

export function MetricPanel({
  repository,
  metric,
  tracks,
  focus,
  range,
  colors,
  cursor,
  onCursor,
  pinned,
  onPin,
  onInspect,
  event,
  events,
  totalCountries,
  lockedDate,
  onLock,
}: {
  repository: EconomicRepository;
  metric: EconomicMetric;
  tracks: EconomicTrack[];
  focus: string | null;
  range: [string, string];
  colors: Record<string, string>;
  cursor: string | null;
  onCursor: (date: string | null) => void;
  pinned: boolean;
  onPin: () => void;
  onInspect: () => void;
  event?: MacroEvent | undefined;
  events: MacroEvent[];
  totalCountries: number;
  lockedDate: string | null;
  onLock: (date: string | null) => void;
}) {
  const track = tracks.find((item) => item.series.country === focus) ?? tracks[0];
  const point = track ? trackReading(track, cursor) : null;
  const countries = tracks.filter((item) =>
    item.points.some((point) => point.value !== null),
  ).length;
  return (
    <article className="research-panel" data-metric={metric.id} aria-label={metric.name}>
      <header>
        <button type="button" className="research-metric-title" onClick={onInspect}>
          {metric.name}
        </button>
        <span className="research-panel-actions">
          <IconButton
            label={pinned ? `取消钉选 ${metric.name}` : `钉选 ${metric.name}`}
            onClick={onPin}
            aria-pressed={pinned}
          >
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </IconButton>
          <IconButton label={`展开 ${metric.name}`} onClick={onInspect}>
            <Expand size={13} />
          </IconButton>
        </span>
      </header>
      <div className="research-panel-reading">
        <strong style={{ color: track ? colors[track.series.country] : undefined }}>
          {track ? pointLabel(track, cursor) : "—"}
        </strong>
        <span>
          {repository.countries.find((item) => item.id === (track?.series.country ?? focus))?.name}
          <small>
            {point
              ? `${point.period} · ${FREQUENCY_NAMES[track!.series.frequency]}${!cursor && track!.reading && track!.reading.ageMonths > 2 ? ` · 距截止 ${track!.reading.ageMonths} 月` : ""}`
              : "所选范围暂无有效数据"}
          </small>
        </span>
      </div>
      <ResearchChart
        tracks={tracks}
        range={range}
        baseline={metric.baseline}
        cursorDate={cursor}
        onCursor={onCursor}
        lockedDate={lockedDate}
        onLock={onLock}
        colors={colors}
        event={event}
        events={events}
        height={138}
        label={`${metric.name}联动趋势`}
      />
      <footer>
        <span>
          {countries}/{totalCountries} 国有窗口数据{track?.series.computed ? " · 计算值" : ""}
        </span>
        <button type="button" onClick={onInspect}>
          数据与口径 ↗
        </button>
      </footer>
    </article>
  );
}
