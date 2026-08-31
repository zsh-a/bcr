import type { Trade } from "../model";

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function TradeBlotter({ trades }: { trades: ReadonlyArray<Trade> }) {
  return (
    <aside className="ql-blotter">
      <div className="ql-panel-heading">
        <span>TRADE BLOTTER</span>
        <strong>{String(trades.length).padStart(2, "0")}</strong>
      </div>
      <div className="ql-blotter-head">
        <span>ENTRY / EXIT</span>
        <span>RETURN</span>
      </div>
      <div className="ql-trade-list">
        {trades.length === 0 && (
          <div className="ql-empty-copy">
            <span>NO FILLS</span>
            <small>等待策略产生交叉信号</small>
          </div>
        )}
        {[...trades].reverse().map((trade, index) => (
          <div className="ql-trade" key={`${trade.entryDate}-${trade.exitDate}-${index}`}>
            <div>
              <b>{trade.entryDate}</b>
              <span>{trade.exitDate ?? "OPEN"}</span>
              <small>
                {trade.entryPrice.toFixed(2)} → {trade.exitPrice?.toFixed(2) ?? "—"}
              </small>
            </div>
            <strong className={trade.returnPct >= 0 ? "positive" : "negative"}>
              {pct(trade.returnPct)}
              <small>
                {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(0)}
              </small>
            </strong>
          </div>
        ))}
      </div>
    </aside>
  );
}
