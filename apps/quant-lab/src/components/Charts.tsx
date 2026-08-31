import { useMemo, useState } from "react";
import type { BacktestResult, MarketBar, SignalPoint } from "../model";

const WIDTH = 1000;
const PRICE_HEIGHT = 410;
const PAD = { left: 14, right: 68, top: 24, bottom: 30 };

function linePath(
  values: ReadonlyArray<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    open = true;
  });
  return path;
}

function sampledIndices(length: number, limit = 900): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => Math.round(index * step));
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function MarketChart(props: {
  bars: ReadonlyArray<MarketBar>;
  signals: ReadonlyArray<SignalPoint>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const view = useMemo(() => {
    const indices = sampledIndices(props.bars.length);
    const bars = indices.flatMap((index) => {
      const bar = props.bars[index];
      return bar === undefined ? [] : [{ bar, index }];
    });
    const closes = bars.map(({ bar }) => bar.close);
    const averages = bars.flatMap(({ index }) => {
      const signal = props.signals[index];
      return signal === undefined
        ? []
        : [signal.fast, signal.slow].filter((value): value is number => value !== null);
    });
    const min = Math.min(...closes, ...averages);
    const max = Math.max(...closes, ...averages);
    const range = Math.max(1, max - min);
    return { indices, bars, min: min - range * 0.08, max: max + range * 0.08 };
  }, [props.bars, props.signals]);

  if (props.bars.length === 0) return <div className="ql-chart-empty">NO MARKET DATA</div>;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = PRICE_HEIGHT - PAD.top - PAD.bottom;
  const x = (sampleIndex: number): number =>
    PAD.left + (sampleIndex / Math.max(1, view.bars.length - 1)) * plotWidth;
  const y = (value: number): number =>
    PAD.top + ((view.max - value) / Math.max(0.0001, view.max - view.min)) * plotHeight;
  const closePath = linePath(
    view.bars.map(({ bar }) => bar.close),
    x,
    y,
  );
  const fastPath = linePath(
    view.bars.map(({ index }) => props.signals[index]?.fast ?? null),
    x,
    y,
  );
  const slowPath = linePath(
    view.bars.map(({ index }) => props.signals[index]?.slow ?? null),
    x,
    y,
  );
  const hoveredBar = hovered === null ? undefined : props.bars[hovered];
  const hoveredSignal = hovered === null ? undefined : props.signals[hovered];
  const hoverX =
    hovered === null ? 0 : PAD.left + (hovered / Math.max(1, props.bars.length - 1)) * plotWidth;

  return (
    <section className="ql-chart-panel">
      <div className="ql-panel-heading">
        <span>MARKET / ADJUSTED PRICE</span>
        <div className="ql-legend">
          <span className="close">CLOSE</span>
          <span className="fast">FAST SMA</span>
          <span className="slow">SLOW SMA</span>
        </div>
      </div>
      <div className="ql-chart-stage">
        <svg
          viewBox={`0 0 ${WIDTH} ${PRICE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="价格与均线信号图"
          onMouseLeave={() => setHovered(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            setHovered(Math.round(ratio * (props.bars.length - 1)));
          }}
        >
          <defs>
            <linearGradient id="ql-price-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ql-lime)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--ql-lime)" stopOpacity="0" />
            </linearGradient>
            <pattern id="ql-grid" width="50" height="44" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 44" fill="none" stroke="var(--ql-grid)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={WIDTH} height={PRICE_HEIGHT} fill="url(#ql-grid)" />
          <path
            d={`${closePath}L${x(view.bars.length - 1)},${PAD.top + plotHeight}L${PAD.left},${PAD.top + plotHeight}Z`}
            fill="url(#ql-price-fill)"
          />
          <path d={closePath} className="ql-line-close" />
          <path d={fastPath} className="ql-line-fast" />
          <path d={slowPath} className="ql-line-slow" />
          {view.bars.map(({ bar, index }, sampleIndex) => {
            const action = props.signals[index]?.action;
            if (action === null || action === undefined) return null;
            const px = x(sampleIndex);
            const py = y(bar.close);
            return action === "buy" ? (
              <path
                key={`buy-${bar.date}`}
                d={`M${px - 5},${py + 13}L${px + 5},${py + 13}L${px},${py + 4}Z`}
                className="ql-buy-marker"
              />
            ) : (
              <path
                key={`sell-${bar.date}`}
                d={`M${px - 5},${py - 13}L${px + 5},${py - 13}L${px},${py - 4}Z`}
                className="ql-sell-marker"
              />
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const value = view.max - ratio * (view.max - view.min);
            return (
              <text key={ratio} x={WIDTH - 60} y={PAD.top + ratio * plotHeight - 4}>
                {money(value)}
              </text>
            );
          })}
          {hovered !== null && (
            <>
              <line
                x1={hoverX}
                x2={hoverX}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                className="ql-crosshair"
              />
              {hoveredBar !== undefined && (
                <circle cx={hoverX} cy={y(hoveredBar.close)} r="4" className="ql-hover-point" />
              )}
            </>
          )}
        </svg>
        {hoveredBar !== undefined && (
          <div
            className="ql-chart-tooltip"
            style={{ left: `${Math.min(82, Math.max(8, (hoverX / WIDTH) * 100))}%` }}
          >
            <b>{hoveredBar.date}</b>
            <span>O {money(hoveredBar.open)}</span>
            <span>H {money(hoveredBar.high)}</span>
            <span>L {money(hoveredBar.low)}</span>
            <span>C {money(hoveredBar.close)}</span>
            {hoveredSignal?.action !== null && hoveredSignal?.action !== undefined && (
              <em>{hoveredSignal.action.toUpperCase()}</em>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function EquityChart({ result }: { result: BacktestResult | null }) {
  if (result === null || result.equity.length === 0) {
    return <div className="ql-equity-empty">RUN PIPELINE TO MATERIALIZE EQUITY CURVE</div>;
  }
  const width = 1000;
  const height = 150;
  const values = result.equity.map(({ equity }) => equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number): number => (index / Math.max(1, values.length - 1)) * width;
  const y = (value: number): number =>
    12 + ((max - value) / Math.max(1, max - min)) * (height - 28);
  const path = linePath(values, x, y);
  return (
    <section className="ql-equity-panel">
      <div className="ql-panel-heading">
        <span>PORTFOLIO / EQUITY CURVE</span>
        <strong>${money(result.metrics.finalEquity)}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="权益曲线">
        <path d={`${path}L${width},${height}L0,${height}Z`} className="ql-equity-area" />
        <path d={path} className="ql-equity-line" />
      </svg>
    </section>
  );
}
