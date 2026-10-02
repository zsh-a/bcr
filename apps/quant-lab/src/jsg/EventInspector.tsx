import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Dialog, Input, Select, Spinner } from "@bcr/react";
import type { IdentifiedOrder } from "@bcr/quant-core";
import type { SelectedRun } from "./session";
import { dateText } from "./model";
import { queryChartOrders } from "./result-reader";
import { useInspection } from "./ResearchInspection";
import { Identity } from "./ResearchNames";
import { money, orderReason, orderStatus, orderTiming } from "./Orders";

const TradeChart = lazy(() => import("./TradeChart"));
export function EventInspector({
  selected,
  onNavigate,
}: {
  selected: SelectedRun;
  onNavigate: (tab: "orders" | "holdings" | "decisions") => void;
}) {
  const { focus, open, close, events, inspect, selectDate } = useInspection();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: IdentifiedOrder[]; count: number }>();
  const [error, setError] = useState("");
  useEffect(() => {
    setPage(0);
  }, [focus.date, focus.code]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setData(undefined);
    setError("");
    void queryChartOrders(
      selected.result,
      focus.date,
      focus.date,
      focus.code ?? "",
      page * 50,
      abort.signal,
    )
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, open, focus.date, focus.code, page]);
  const event = events.find((e) => e.date === focus.date);
  const order = focus.order;
  const navigate = (tab: "orders" | "holdings" | "decisions") => {
    if (tab === "decisions" && order) selectDate(order.signalDate);
    close();
    onNavigate(tab);
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={focus.code ? "成交与行情" : "组合事件"}
      placement="drawer"
      className="research-event-dialog"
    >
      {open && (
        <>
          <div className="research-event-tools">
            <Input
              type="date"
              aria-label="事件日期"
              value={focus.date}
              min={dateText(selected.run.startDate)}
              max={dateText(selected.run.endDate)}
              onChange={(e) => selectDate(e.target.value)}
            />
            <Select
              aria-label="跳转事件日"
              value={focus.date}
              onChange={(e) => selectDate(e.target.value)}
            >
              {!event && <option value={focus.date}>{focus.date}</option>}
              {events.map((e) => (
                <option key={e.date} value={e.date}>
                  {e.date}
                  {e.blocked ? " · 风控阻止调仓" : ""}
                </option>
              ))}
            </Select>
          </div>
          {focus.code && (
            <div className="research-event-identity">
              <h3>
                <Identity code={focus.code} />
              </h3>
              <Button variant="ghost" size="sm" onClick={() => inspect({ date: focus.date })}>
                当日全部证券
              </Button>
            </div>
          )}
          {event && (
            <dl className="research-event-stats">
              <div>
                <dt>买入 / 卖出</dt>
                <dd>
                  {event.buys} / {event.sells}
                </dd>
              </div>
              <div>
                <dt>成交金额</dt>
                <dd>¥{money(event.amount)}</dd>
              </div>
              <div>
                <dt>成交费用</dt>
                <dd>¥{money(event.fees)}</dd>
              </div>
              <div>
                <dt>收盘净值</dt>
                <dd>
                  {event.equity === undefined
                    ? "—"
                    : (event.equity / selected.run.config.initialCapital).toFixed(3)}
                </dd>
              </div>
            </dl>
          )}
          {event?.blocked && <p className="research-event-note">当日调仓被组合风控阻止。</p>}
          {event?.signal && (
            <p className="research-help">
              收盘生成 {event.targets} 只目标证券；成交记录按实际执行日期展示。
            </p>
          )}
          {focus.code && (
            <Suspense
              fallback={
                <p className="research-small-empty">
                  <Spinner size="sm" />
                  载入 K 线…
                </p>
              }
            >
              <TradeChart key={focus.code} selected={selected} code={focus.code} />
            </Suspense>
          )}
          {order && (
            <section className="research-order-inspection" aria-label="选中订单详情">
              <h3>
                <span className="research-side" data-side={order.side}>
                  {order.side === "buy" ? "买入" : "卖出"}
                </span>
                <span>{orderStatus(order.status)}</span>
              </h3>
              <dl className="research-facts">
                {[
                  ["成交日期", order.date],
                  ["信号日期", order.signalDate],
                  ["撮合时点", orderTiming(order.timing)],
                  [
                    "请求 / 成交",
                    `${order.requested.toLocaleString()} / ${order.quantity.toLocaleString()}`,
                  ],
                  ["成交价格", order.quantity > 0 ? `¥${money(order.price)}` : "未成交"],
                  ["费用", `¥${money(order.fee)}`],
                  ["触发原因", orderReason(order.reason)],
                  ...(order.riskReason ? [["仓位限制", orderReason(order.riskReason)]] : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="research-help">
                详情价格使用回测成交口径；K 线切换复权时，标记位置同步转换。
              </p>
            </section>
          )}
          <section className="research-event-orders" aria-label="当日订单">
            <div className="research-event-section-title">
              <h3>当日订单</h3>
              <span>{data?.count ?? "—"} 笔</span>
            </div>
            {error ? (
              <p role="alert" className="research-error">
                {error}
              </p>
            ) : !data ? (
              <p className="research-small-empty">
                <Spinner size="sm" />
                读取订单…
              </p>
            ) : !data.count ? (
              <p className="research-small-empty">该日没有订单记录。</p>
            ) : (
              <>
                <div className="research-event-order-list">
                  {data.rows.map((row) => (
                    <button
                      key={row.id}
                      className="research-event-order"
                      data-selected={
                        order === row ||
                        (order?.date === row.date &&
                          order.code === row.code &&
                          order.side === row.side &&
                          order.price === row.price)
                      }
                      onClick={() => inspect({ date: row.date, code: row.code, order: row })}
                    >
                      <Identity code={row.code} />
                      <span className="research-side" data-side={row.side}>
                        {row.side === "buy" ? "买入" : "卖出"}
                      </span>
                      <span>{row.quantity.toLocaleString()} 股</span>
                      <span>
                        {orderStatus(row.status)} · {orderReason(row.reason)}
                      </span>
                    </button>
                  ))}
                </div>
                {data.count > 50 && (
                  <div className="research-pagination">
                    <span>第 {page + 1} 页</span>
                    <Button size="sm" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      disabled={(page + 1) * 50 >= data.count}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
          <div className="research-event-actions">
            <Button size="sm" variant="ghost" onClick={() => navigate("orders")}>
              成交表
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate("holdings")}>
              当日账本
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate("decisions")}>
              选股解释
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
