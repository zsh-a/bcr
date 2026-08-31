import type { MarketHistoryBar } from "@bcr/market-data";
import { useMemo, useState, type PointerEvent } from "react";

const WIDTH = 920;
const HEIGHT = 260;
const PRICE_TOP = 14;
const PRICE_BOTTOM = 196;
const VOLUME_TOP = 216;
const VOLUME_BOTTOM = 252;
const MAX_CANDLES = 112;

interface DisplayBar extends MarketHistoryBar {
  readonly firstDate: string;
}

function displayBars(input: ReadonlyArray<MarketHistoryBar>): ReadonlyArray<DisplayBar> {
  if (input.length <= MAX_CANDLES) return input.map((bar) => ({ ...bar, firstDate: bar.date }));
  const size = Math.ceil(input.length / MAX_CANDLES);
  const result: DisplayBar[] = [];
  for (let index = 0; index < input.length; index += size) {
    const group = input.slice(index, index + size);
    const first = group[0];
    const last = group.at(-1);
    if (first === undefined || last === undefined) continue;
    result.push({
      firstDate: first.date,
      date: last.date,
      timestamp: last.timestamp,
      open: first.open,
      close: last.close,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
      amount: null,
    });
  }
  return result;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function value(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1_000 ? 1 : value >= 100 ? 2 : 3,
  }).format(value);
}

export function CandlestickChart(props: {
  bars: ReadonlyArray<MarketHistoryBar>;
  loading: boolean;
}) {
  const bars = useMemo(() => displayBars(props.bars), [props.bars]);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = bars[hovered ?? bars.length - 1];
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const padding = Math.max((high - low) * 0.06, high * 0.002);
  const minimum = low - padding;
  const maximum = high + padding;
  const maxVolume = Math.max(...bars.map((bar) => bar.volume), 1);
  const step = WIDTH / Math.max(bars.length, 1);
  const candleWidth = Math.max(1.4, Math.min(6.5, step * 0.64));
  const y = (price: number) =>
    PRICE_TOP +
    ((maximum - price) / Math.max(maximum - minimum, 0.001)) * (PRICE_BOTTOM - PRICE_TOP);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (bars.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relative = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    setHovered(Math.max(0, Math.min(bars.length - 1, Math.floor(relative / step))));
  };

  if (props.loading && bars.length === 0) {
    return (
      <div className="ma-candle-loading" aria-label="Loading historical prices">
        <i />
        <span>ASSEMBLING DAILY BARS</span>
      </div>
    );
  }

  if (bars.length === 0 || active === undefined) {
    return <div className="ma-candle-empty">HISTORY UNAVAILABLE</div>;
  }

  return (
    <div className="ma-candle-wrap">
      <div className="ma-candle-readout">
        <b>
          {active.firstDate === active.date ? active.date : `${active.firstDate} → ${active.date}`}
        </b>
        <span>O {value(active.open)}</span>
        <span>H {value(active.high)}</span>
        <span>L {value(active.low)}</span>
        <span>C {value(active.close)}</span>
        <span>VOL {compact(active.volume)}</span>
      </div>
      <svg
        className="ma-candle-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${bars.length} historical candlesticks`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = PRICE_TOP + ratio * (PRICE_BOTTOM - PRICE_TOP);
          return <line key={ratio} x1="0" x2={WIDTH} y1={lineY} y2={lineY} className="grid" />;
        })}
        {bars.map((bar, index) => {
          const center = index * step + step / 2;
          const open = y(bar.open);
          const close = y(bar.close);
          const positive = bar.close >= bar.open;
          const volumeHeight = (bar.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
          return (
            <g key={`${bar.date}:${index}`} className={positive ? "up" : "down"}>
              <line x1={center} x2={center} y1={y(bar.high)} y2={y(bar.low)} className="wick" />
              <rect
                x={center - candleWidth / 2}
                y={Math.min(open, close)}
                width={candleWidth}
                height={Math.max(1.25, Math.abs(close - open))}
                className="body"
              />
              <rect
                x={center - candleWidth / 2}
                y={VOLUME_BOTTOM - volumeHeight}
                width={candleWidth}
                height={Math.max(0.75, volumeHeight)}
                className="volume"
              />
            </g>
          );
        })}
        {hovered !== null && (
          <line
            x1={hovered * step + step / 2}
            x2={hovered * step + step / 2}
            y1="0"
            y2={HEIGHT}
            className="crosshair"
          />
        )}
      </svg>
    </div>
  );
}
