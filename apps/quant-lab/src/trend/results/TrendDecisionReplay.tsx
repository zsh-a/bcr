import {
  TREND_REASONS,
  trendTradeReplay,
  type TrendResult,
  type TrendTrade,
} from "@bcr/quant-core/trend";
import { Button, Spinner, useRuntime } from "@bcr/react";
import { useEffect, useMemo, useState } from "react";
import type { TrendEvent } from "@bcr/quant-core/trend";
import { readTradeEvents } from "./read";
import { number, timestamp } from "./evaluation";
import { priceDigits } from "./format";

const labels: Record<string, string> = {
  "signal-confirmed": "收盘信号确认",
  "entry-filled": "入场成交",
};

export function TrendDecisionReplay({
  result,
  trade,
  tickSize,
  onLocate,
}: {
  result: TrendResult;
  trade: TrendTrade;
  tickSize: number;
  onLocate: (time: number) => void;
}) {
  const services = useRuntime();
  const [events, setEvents] = useState<TrendEvent[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setEvents(null);
    setError("");
    setCursor(0);
    void readTradeEvents(services, result, trade, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setEvents(value);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason));
      });
    return () => abort.abort();
  }, [services, result, trade, attempt]);
  const steps = useMemo(() => trendTradeReplay(trade, events ?? []), [trade, events]);
  const current = steps[Math.min(cursor, steps.length - 1)]!;
  const move = (index: number) => {
    setCursor(index);
    onLocate(steps[index]!.time);
  };
  return (
    <section className="trend-replay" aria-label={`交易 ${trade.id} 决策复盘`}>
      <div className="trend-entry-detail-heading">
        <strong>决策复盘</strong>
        <span className="trend-help">账户账本 · 交易 {trade.id}</span>
      </div>
      {error ? (
        <div role="alert" className="trend-error">
          {error}
          <Button size="sm" onClick={() => setAttempt(attempt + 1)}>
            重试复盘
          </Button>
        </div>
      ) : events === null ? (
        <p role="status">
          <Spinner size="sm" /> 正在读取完整交易事件…
        </p>
      ) : (
        <>
          <div className="trend-replay-controls">
            <Button size="sm" disabled={cursor === 0} onClick={() => move(cursor - 1)}>
              上一步
            </Button>
            <input
              aria-label="决策复盘进度"
              type="range"
              min={0}
              max={steps.length - 1}
              value={cursor}
              onChange={(event) => move(Number(event.target.value))}
            />
            <span>
              {cursor + 1} / {steps.length}
            </span>
            <Button
              size="sm"
              disabled={cursor === steps.length - 1}
              onClick={() => move(cursor + 1)}
            >
              下一步
            </Button>
          </div>
          <div className="trend-replay-event" aria-live="polite">
            <time>{timestamp(current.time)} UTC</time>
            <strong>
              {labels[current.reason] ?? TREND_REASONS[current.reason] ?? current.reason}
            </strong>
            <span>
              {number(current.price, priceDigits(tickSize))}
              {current.kind === "stage" && current.value !== null
                ? ` · ${number(current.value)} R`
                : ""}
            </span>
          </div>
          <dl>
            <div>
              <dt>事件后的持仓</dt>
              <dd>
                {current.phase === "confirmed"
                  ? "等待成交"
                  : current.phase === "open"
                    ? trade.side === "long"
                      ? "多头"
                      : "空头"
                    : "已平仓"}
              </dd>
            </div>
            <div>
              <dt>已记录保护价</dt>
              <dd>{current.stop === null ? "—" : number(current.stop, priceDigits(tickSize))}</dd>
            </div>
            <div>
              <dt>分档启动记录</dt>
              <dd>
                {[current.breakEvenArmed && "保本", current.trailingArmed && "跟踪"]
                  .filter(Boolean)
                  .join(" · ") || "尚无"}
              </dd>
            </div>
            {current.phase === "closed" && (
              <div>
                <dt>最终净盈亏 · USDT</dt>
                <dd>{number(trade.netPnl)}</dd>
              </div>
            )}
          </dl>
          <p className="trend-help">
            {current.source === "signal-snapshot"
              ? "入场信号冻结快照"
              : current.source === "event"
                ? "原始事件记录"
                : "交易账本端点（原事件未记录）"}
            。同一时刻按账本顺序推进；图表定位仅作行情参考，可能合并 K 线。
          </p>
        </>
      )}
      <p className="trend-help">
        本视图只关联本笔交易编号；独立机会观察和未成交信号不合并为本笔决策。未记录的门槛或分档状态不作推断。
      </p>
    </section>
  );
}
