import { useEffect, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import { Button, Dialog, Input, Select, Spinner } from "@bcr/react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import type { JsgResult } from "./model";
import { queryOrders } from "./result-reader";
import { EMPTY_ORDER_FILTER, ORDER_PAGE_SIZE, type OrderFilter } from "./result-data";

export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
export const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const reasons: Record<string, string> = {
  rebalance: "周调仓",
  "stop-loss": "个股止损",
  "trailing-stop": "移动止盈",
  "max-drawdown": "组合回撤",
  "limit-open": "涨停打开",
  "limit-up-open": "涨停打开",
  "limit-up-opened": "涨停打开",
};
export const orderReason = (value: string) => reasons[value] ?? value;
const statuses: Record<string, string> = {
  filled: "已成交",
  partial: "部分成交",
  rejected: "已拒单",
  "missing-bar": "缺少行情",
  suspended: "停牌",
  "limit-up": "涨停限制",
  "limit-down": "跌停限制",
  "not-sellable": "数量不可卖",
  "volume-limit": "成交量限制",
  "insufficient-cash": "现金不足",
  "no-cash": "现金不足",
};
export const orderStatus = (value: string) => statuses[value] ?? value;
export const orderTiming = (value: string) =>
  value === "next-open" ? "次日开盘" : value === "close" ? "当日收盘" : value;
export function Orders({ services, result }: { services: RuntimeServices; result: JsgResult }) {
  const [filter, setFilter] = useState<OrderFilter>({ ...EMPTY_ORDER_FILTER });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: JsgResult["orders"]; count: number }>({
    rows: [],
    count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<JsgResult["orders"][number] | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void queryOrders(services, result, filter, offset, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) {
            setData(value);
            setLoading(false);
          }
        })
        .catch((caught: unknown) => {
          if (!abort.signal.aborted) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [services, result, filter, offset]);
  const update = (patch: Partial<OrderFilter>) => {
    setFilter((value) => ({ ...value, ...patch }));
    setOffset(0);
  };
  return (
    <div className="research-orders">
      <div className="research-order-filters">
        <label className="research-search">
          <Search size={14} />
          <Input
            type="search"
            aria-label="筛选证券"
            placeholder="搜索证券代码"
            value={filter.code}
            onChange={(event) => update({ code: event.currentTarget.value })}
          />
        </label>
        <Input
          type="date"
          aria-label="成交开始日期"
          value={filter.from}
          onChange={(event) => update({ from: event.currentTarget.value })}
        />
        <Input
          type="date"
          aria-label="成交结束日期"
          value={filter.to}
          onChange={(event) => update({ to: event.currentTarget.value })}
        />
        <Select
          aria-label="成交方向"
          value={filter.side}
          onChange={(event) => update({ side: event.currentTarget.value })}
        >
          <option value="">全部方向</option>
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </Select>
        <Select
          aria-label="成交状态"
          value={filter.status}
          onChange={(event) => update({ status: event.currentTarget.value })}
        >
          <option value="">全部状态</option>
          <option value="filled">已成交</option>
          <option value="partial">部分成交</option>
          <option value="rejected">已拒单</option>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFilter({ ...EMPTY_ORDER_FILTER });
            setOffset(0);
          }}
        >
          清除筛选
        </Button>
      </div>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      <div className="research-table-wrap" aria-busy={loading}>
        <table className="research-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>证券</th>
              <th>方向</th>
              <th className="numeric">数量</th>
              <th className="numeric">成交价</th>
              <th className="numeric">费用</th>
              <th>原因</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((order, index) => (
              <tr key={`${order.date}-${order.code}-${index}`}>
                <td>{order.date}</td>
                <td>
                  <button
                    className="research-table-link"
                    onClick={() => setDetail(order)}
                    aria-label={`查看订单 ${order.code} ${order.date} ${index + 1}`}
                  >
                    {order.code}
                  </button>
                </td>
                <td>
                  <span className="research-side" data-side={order.side}>
                    {order.side === "buy" ? "买入" : "卖出"}
                  </span>
                </td>
                <td className="numeric">{order.quantity.toLocaleString()}</td>
                <td className="numeric">{money(order.price)}</td>
                <td className="numeric">{money(order.fee)}</td>
                <td>{orderReason(order.reason)}</td>
                <td>
                  <span
                    className="research-order-status"
                    data-status={order.quantity === 0 ? "rejected" : order.status}
                  >
                    {orderStatus(order.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data.count === 0 && (
          <div className="research-small-empty">此条件下没有订单记录。</div>
        )}
      </div>
      <div className="research-pagination">
        <span role="status">
          {loading ? (
            <>
              <Spinner size="sm" />
              读取成交记录…
            </>
          ) : (
            `共 ${data.count.toLocaleString()} 笔 · ${data.count ? offset + 1 : 0}–${Math.min(offset + ORDER_PAGE_SIZE, data.count)}`
          )}
        </span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="上一页订单"
            disabled={loading || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - ORDER_PAGE_SIZE))}
          >
            <ArrowLeft size={14} />
            上一页
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="下一页订单"
            disabled={loading || offset + ORDER_PAGE_SIZE >= data.count}
            onClick={() => setOffset((value) => value + ORDER_PAGE_SIZE)}
          >
            下一页
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="订单详情"
        placement="sheet"
        className="research-detail-dialog"
      >
        {detail && (
          <>
            <div className="research-detail-title">
              <b>{detail.code}</b>
              <span className="research-side" data-side={detail.side}>
                {detail.side === "buy" ? "买入" : "卖出"}
              </span>
            </div>
            <dl className="research-facts">
              {[
                ["成交日期", detail.date],
                ["信号日期", detail.signalDate],
                ["撮合时点", orderTiming(detail.timing)],
                ["触发原因", orderReason(detail.reason)],
                ["请求数量", detail.requested.toLocaleString()],
                ["成交数量", detail.quantity.toLocaleString()],
                ["成交价格", `¥${money(detail.price)}`],
                ["成交费用", `¥${money(detail.fee)}`],
                ["状态", orderStatus(detail.status)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Dialog>
    </div>
  );
}
