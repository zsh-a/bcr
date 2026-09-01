import type { PortfolioAnalysis } from "../model";

const CURVE_WIDTH = 720;
const CURVE_HEIGHT = 180;

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

function linePath(values: ReadonlyArray<number>): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * CURVE_WIDTH;
      const y = 16 + ((max - value) / range) * (CURVE_HEIGHT - 40);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join("");
}

function sampled(values: ReadonlyArray<number>, limit = 280): number[] {
  if (values.length <= limit) return [...values];
  const step = (values.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => values[Math.round(index * step)] ?? 0);
}

function correlationBackground(value: number): string {
  const intensity = 18 + Math.round(Math.abs(value) * 58);
  const color = value >= 0 ? "var(--ql-cyan)" : "var(--ql-red)";
  return `color-mix(in srgb, ${color} ${intensity}%, var(--ql-panel-2))`;
}

function PortfolioCurve({ analysis }: { analysis: PortfolioAnalysis }) {
  const points = sampled(analysis.backtest.equity.map((point) => point.equity));
  if (points.length === 0) return null;
  const path = linePath(points);
  return (
    <div className="ql-portfolio-curve">
      <div className="ql-portfolio-subheading">
        <span>EQUAL-WEIGHT EQUITY</span>
        <b>{money(analysis.backtest.metrics.finalEquity)}</b>
      </div>
      <svg
        viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="等权组合权益曲线"
      >
        <defs>
          <linearGradient id="ql-portfolio-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ql-cyan)" stopOpacity="0.23" />
            <stop offset="100%" stopColor="var(--ql-cyan)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${path}L${CURVE_WIDTH},${CURVE_HEIGHT}L0,${CURVE_HEIGHT}Z`}
          className="ql-portfolio-area"
        />
        <path d={path} className="ql-portfolio-line" />
      </svg>
    </div>
  );
}

function CorrelationMatrix({ analysis }: { analysis: PortfolioAnalysis }) {
  const { correlation } = analysis;
  return (
    <section className="ql-portfolio-card ql-correlation-card" data-correlation-matrix>
      <div className="ql-portfolio-card-heading">
        <div>
          <span>PORTFOLIO / CORRELATION MATRIX</span>
          <small>PEARSON · {correlation.observations} COMMON RETURNS</small>
        </div>
        <div className="ql-correlation-legend" aria-label="相关性颜色图例">
          <span className="negative">−1</span>
          <i />
          <span>0</span>
          <i className="positive" />
          <span className="positive">+1</span>
        </div>
      </div>
      <div className="ql-correlation-scroll">
        <table className="ql-correlation-table">
          <caption className="ql-sr-only">组合标的收益相关性矩阵</caption>
          <thead>
            <tr>
              <th scope="col">ASSET</th>
              {correlation.symbols.map((symbol) => (
                <th key={symbol} scope="col">
                  {symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correlation.symbols.map((rowSymbol, rowIndex) => (
              <tr key={rowSymbol}>
                <th scope="row">{rowSymbol}</th>
                {correlation.symbols.map((columnSymbol, columnIndex) => {
                  const value = correlation.values[rowIndex]?.[columnIndex] ?? 0;
                  return (
                    <td
                      key={`${rowSymbol}-${columnSymbol}`}
                      style={{ background: correlationBackground(value) }}
                      aria-label={`${rowSymbol} 与 ${columnSymbol} 相关性 ${value.toFixed(2)}`}
                      title={`${rowSymbol} / ${columnSymbol}: ${value.toFixed(2)}`}
                    >
                      {value.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ql-portfolio-card-foot">
        <span>
          {correlation.startDate} — {correlation.endDate}
        </span>
        <span>LOWER CORRELATION · BETTER DIVERSIFICATION SIGNAL</span>
      </div>
    </section>
  );
}

function PortfolioSummary({ analysis }: { analysis: PortfolioAnalysis }) {
  const { metrics, weights } = analysis.backtest;
  return (
    <section className="ql-portfolio-card ql-portfolio-summary" data-portfolio-metrics>
      <div className="ql-portfolio-card-heading">
        <div>
          <span>EQUAL-WEIGHT BENCHMARK</span>
          <small>{metrics.seriesCount} SERIES · DAILY REBALANCE MARK</small>
        </div>
        <strong>{metrics.observations}D</strong>
      </div>
      <div className="ql-portfolio-kpis">
        <div className={metrics.totalReturn >= 0 ? "positive" : "negative"}>
          <span>TOTAL RETURN</span>
          <b>{percent(metrics.totalReturn)}</b>
        </div>
        <div className={metrics.annualizedReturn >= 0 ? "positive" : "negative"}>
          <span>CAGR</span>
          <b>{percent(metrics.annualizedReturn)}</b>
        </div>
        <div className="neutral">
          <span>VOLATILITY</span>
          <b>{percent(metrics.volatility)}</b>
        </div>
        <div className={metrics.maxDrawdown >= 0 ? "positive" : "negative"}>
          <span>MAX DRAWDOWN</span>
          <b>{percent(metrics.maxDrawdown)}</b>
        </div>
        <div className={metrics.buyHoldReturn >= 0 ? "positive" : "negative"}>
          <span>BUY &amp; HOLD</span>
          <b>{percent(metrics.buyHoldReturn)}</b>
        </div>
        <div className={metrics.sharpe >= 0 ? "neutral" : "negative"}>
          <span>SHARPE</span>
          <b>{metrics.sharpe.toFixed(2)}</b>
        </div>
      </div>
      <PortfolioCurve analysis={analysis} />
      <div className="ql-portfolio-allocations">
        <div className="ql-portfolio-subheading">
          <span>ALLOCATION / EQUAL WEIGHT</span>
          <b>{money(metrics.finalEquity)}</b>
        </div>
        {weights.map((item) => (
          <div className="ql-allocation" key={item.instrumentId}>
            <span>{item.symbol}</span>
            <div className="ql-allocation-track" aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, item.weight * 100))}%` }} />
            </div>
            <b>{(item.weight * 100).toFixed(2)}%</b>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PortfolioAnalysisView({ analysis }: { analysis: PortfolioAnalysis }) {
  return (
    <section className="ql-portfolio-analysis" data-portfolio-analysis>
      <CorrelationMatrix analysis={analysis} />
      <PortfolioSummary analysis={analysis} />
    </section>
  );
}
