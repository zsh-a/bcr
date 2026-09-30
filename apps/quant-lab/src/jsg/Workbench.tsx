import { type ArtifactRef, type TaskHandle } from "@bcr/core";
import { useRuntime } from "@bcr/react";
import { Effect } from "effect";
import { Download, Play, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  exportResearchResult,
  importResearch,
  readJson,
  restoreResearch,
  saveResearch,
} from "./data";
import { demoResearch } from "./demo";
import {
  DEFAULT_CONFIG,
  MODEL,
  dateText,
  validateConfig,
  type JsgConfig,
  type JsgResult,
  type ResearchDataset,
} from "./model";
import "./styles.css";

const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function EquityPlot({ result }: { result: JsgResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = result.equity;
  const values = points.map((p) => p.equity);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = Math.max(1, Math.ceil(points.length / 1000));
  const indices = points.map((_, i) => i).filter((i) => i % step === 0 || i === points.length - 1);
  const dates = points.map((p) => Date.parse(p.date));
  const beginning = dates[0] ?? 0;
  const span = Math.max(1, (dates.at(-1) ?? beginning) - beginning);
  const x = (i: number) => (((dates[i] ?? beginning) - beginning) / span) * 1000;
  const y = (v: number) => 20 + ((high - v) / Math.max(1, high - low)) * 260;
  const path = indices
    .map((i, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(values[i] ?? 0).toFixed(2)}`)
    .join("");
  const point = hover === null ? points.at(-1) : points[hover];
  return (
    <section className="jsg-equity">
      <div className="jsg-section-title">
        <span>组合净值</span>
        <span>
          {point?.date} · ¥{money(point?.equity ?? 0)} · 回撤 {percent(point?.drawdown ?? 0)}
        </span>
      </div>
      <svg
        viewBox="0 0 1000 310"
        role="img"
        aria-label="JSG 组合权益曲线"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const target = beginning + ((e.clientX - rect.left) / rect.width) * span;
          let left = 0,
            right = points.length - 1;
          while (left < right) {
            const middle = Math.floor((left + right) / 2);
            if ((dates[middle] ?? 0) < target) left = middle + 1;
            else right = middle;
          }
          setHover(
            left > 0 &&
              Math.abs((dates[left - 1] ?? 0) - target) < Math.abs((dates[left] ?? 0) - target)
              ? left - 1
              : left,
          );
        }}
      >
        {[20, 85, 150, 215, 280].map((line) => (
          <line key={line} x1="0" x2="1000" y1={line} y2={line} className="jsg-grid-line" />
        ))}
        <path d={`${path}L1000,300L0,300Z`} className="ql-equity-area" />
        <path d={path} className="ql-equity-line" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2="300" className="ql-crosshair" />
        )}
      </svg>
      <div className="jsg-axis">
        <span>{points[0]?.date}</span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </section>
  );
}

export function JsgWorkbench({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const services = useRuntime();
  const [dataset, setDataset] = useState<ResearchDataset | null>(null);
  const [config, setConfig] = useState<JsgConfig>({ ...DEFAULT_CONFIG });
  const [result, setResult] = useState<JsgResult | null>(null);
  const [orderChunk, setOrderChunk] = useState(-1);
  const [pageOrders, setPageOrders] = useState<JsgResult["orders"] | null>(null);
  const [orderOffset, setOrderOffset] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [exporting, setExporting] = useState(false);
  const orderRequest = useRef(0);
  const [resultRef, setResultRef] = useState<ArtifactRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("准备研究数据…");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<{ cancelled: boolean; handle: TaskHandle | null } | null>(null);

  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const restored = await restoreResearch(services);
        if (restored !== null) {
          const restoredResult =
            restored.resultRef === null
              ? null
              : await readJson<JsgResult>(services, restored.resultRef);
          if (!disposed) {
            setDataset(restored.dataset);
            setConfig(restored.config);
            setResult(restoredResult);
            setResultRef(restored.resultRef);
            setStatus("已恢复本地研究");
          }
        } else {
          const demo = demoResearch();
          const data = await importResearch(services, demo.files, (s) => {
            if (!disposed) setStatus(s);
          });
          if (!disposed) {
            setDataset(data);
            setStatus("演示数据就绪 · 64 股 / 156 个回测交易日");
          }
        }
      } catch (e) {
        if (!disposed) {
          setError(message(e));
          setStatus("请选择研究数据，或重新加载演示");
        }
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [services]);
  useEffect(() => {
    if (!ready || dataset === null || busy) return;
    try {
      validateConfig(config);
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      void saveResearch(services, dataset, config, resultRef).catch((e: unknown) =>
        setError(`保存研究失败：${message(e)}`),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [services, dataset, config, resultRef, busy, ready]);

  const change = (patch: Partial<JsgConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setResult(null);
    setResultRef(null);
    setError(null);
    setDuration(null);
    setCached(false);
  };
  const importFiles = async (files: readonly File[]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await importResearch(services, files, setStatus);
      await saveResearch(services, data, config, null);
      setDataset(data);
      setResult(null);
      setResultRef(null);
      setDuration(null);
      setCached(false);
      setStatus("研究数据就绪");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (dataset === null || busy || active.current !== null) return;
    try {
      validateConfig(config);
    } catch (e) {
      setError(message(e));
      return;
    }
    const token = { cancelled: false, handle: null as TaskHandle | null };
    active.current = token;
    const start = performance.now();
    let unsubscribe: (() => void) | undefined;
    setBusy(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setResultRef(null);
    setDuration(null);
    setCached(false);
    setStatus("排队等待回测…");
    try {
      const handle = await Effect.runPromise(
        services.scheduler.submit({
          id: `jsg-${crypto.randomUUID()}`,
          runtime: "wasm",
          operation: "quant.backtest.jsg",
          inputs: [
            { ...dataset.manifestRef, port: "manifest" },
            ...dataset.partitions.map((ref, i) => ({ ...ref, port: `partition-${i}` })),
          ],
          outputs: [{ name: "result", type: "quant/jsg-result", storage: "opfs", format: "json" }],
          resources: { memoryMB: 256, threads: 1 },
          cache: { enabled: true },
          config: { model: config.executionModel ?? MODEL, strategy: config },
        }),
      );
      token.handle = handle;
      if (token.cancelled) {
        await Effect.runPromise(handle.cancel);
        throw new Error("回测已取消");
      }
      const update = () => {
        const snapshot = handle.state.getSnapshot();
        setProgress(snapshot.progress);
      };
      unsubscribe = handle.state.subscribe(update);
      update();
      setStatus("正在逐日回放…");
      const outputs = await Effect.runPromise(handle.await);
      if (token.cancelled) throw new Error("回测已取消");
      const ref = outputs.find((output) => output.type === "quant/jsg-result");
      if (ref === undefined) throw new Error("回测没有产生结果");
      const output = await readJson<JsgResult>(services, ref);
      if (token.cancelled) throw new Error("回测已取消");
      await saveResearch(services, dataset, config, ref);
      if (token.cancelled) throw new Error("回测已取消");
      setResult(output);
      setResultRef(ref);
      setDuration(performance.now() - start);
      setCached(handle.cached);
      setProgress(1);
      setStatus(
        `回测完成 · ${output.metrics.days} 个交易日 · ${output.metrics.filledOrders} 笔成交${handle.cached ? " · 复用已有结果" : ""}`,
      );
    } catch (e) {
      if (token.cancelled) setStatus("回测已取消");
      else {
        setError(message(e));
        setStatus("回测失败");
      }
    } finally {
      unsubscribe?.();
      active.current = null;
      setBusy(false);
    }
  };
  useEffect(() => {
    orderRequest.current += 1;
    setOrderChunk(-1);
    setPageOrders(null);
    setOrderOffset(0);
  }, [result]);
  const loadOrders = async (index: number) => {
    if (result?.chunks?.[index] === undefined) {
      setOrderChunk(-1);
      setPageOrders(null);
      return;
    }
    setLoadingOrders(true);
    const request = ++orderRequest.current;
    try {
      const chunk = await readJson<{ orders: JsgResult["orders"] }>(
        services,
        result.chunks[index]!.ref,
      );
      if (request !== orderRequest.current) return;
      setOrderChunk(index);
      setPageOrders(chunk.orders);
      setOrderOffset(0);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoadingOrders(false);
    }
  };
  const cancel = () => {
    const token = active.current;
    if (token === null) return;
    token.cancelled = true;
    setStatus("正在取消…");
    if (token.handle !== null)
      void Effect.runPromise(token.handle.cancel).catch((e: unknown) => setError(message(e)));
  };
  const exportResult = async () => {
    if (result === null) return;
    setExporting(true);
    try {
      const { blob, cleanup } = await exportResearchResult(
        services,
        config,
        dataset?.manifest,
        result,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jsg-research.json";
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void cleanup().catch(() => undefined);
      }, 60000);
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  };
  const m = dataset?.manifest;
  const metrics = result?.metrics;
  const latestDecision = result?.decisions.at(-1);
  const mode =
    m?.universeMode === "synthetic"
      ? "合成演示"
      : m?.universeMode === "snapshot"
        ? "当前成分快照"
        : "历史成分";
  const fields: {
    key: keyof Pick<
      JsgConfig,
      | "initialCapital"
      | "poolSize"
      | "stockCount"
      | "commissionBps"
      | "slippageBps"
      | "stopLoss"
      | "trailingStop"
      | "maxDrawdown"
    >;
    label: string;
    scale?: number;
    step: number;
  }[] = [
    { key: "initialCapital", label: "初始本金", step: 10000 },
    { key: "poolSize", label: "候选池大小", step: 1 },
    { key: "stockCount", label: "目标股票数", step: 1 },
    { key: "commissionBps", label: "佣金 / bps", step: 1 },
    { key: "slippageBps", label: "滑点 / bps", step: 1 },
    { key: "stopLoss", label: "个股止损 / %", scale: 100, step: 1 },
    { key: "trailingStop", label: "移动止盈 / %", scale: 100, step: 1 },
    { key: "maxDrawdown", label: "组合回撤 / %", scale: 100, step: 1 },
  ];
  return (
    <div className="quant-lab jsg-lab" data-testid="jsg-workbench">
      <header className="ql-header">
        <div className="ql-brand">
          <span>JSG</span>
          <div>
            <b>多股票策略研究</b>
            <small>行业宽度 · 小市值 · 周频调仓</small>
          </div>
        </div>
        <div className="ql-market-status">
          <span>{m?.name ?? "等待数据"}</span>
          <span>{m === undefined ? "" : `${m.instruments.length} 只股票 · ${mode}`}</span>
        </div>
        <div className="ql-actions">
          <input
            ref={input}
            type="file"
            multiple
            accept=".json,.arrow"
            hidden
            aria-label="导入 JSG 研究数据"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = "";
              if (files.length > 0) void importFiles(files);
            }}
          />
          <button
            className="ui-btn ui-btn-ghost"
            disabled={!ready || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={14} />
            导入数据
          </button>
          <button
            className="ui-btn ui-btn-ghost"
            disabled={result === null || busy || exporting}
            onClick={() => void exportResult()}
          >
            <Download size={14} />
            导出结果
          </button>
          {active.current !== null ? (
            <button className="ui-btn" onClick={cancel}>
              <Square size={14} />
              取消回测
            </button>
          ) : (
            <button
              className="ui-btn ui-btn-primary"
              disabled={!ready || busy || dataset === null}
              onClick={() => void run()}
            >
              <Play size={14} />
              运行 JSG
            </button>
          )}
        </div>
      </header>
      <section className="ql-tape jsg-metrics" aria-label="JSG 回测指标">
        {[
          ["TOTAL RETURN", metrics ? percent(metrics.totalReturn) : "—"],
          ["MAX DRAWDOWN", metrics ? percent(metrics.maxDrawdown) : "—"],
          ["SHARPE", metrics?.sharpe.toFixed(2) ?? "—"],
          ["FINAL EQUITY", metrics ? `¥${money(metrics.finalEquity)}` : "—"],
          ["FILLED ORDERS", metrics?.filledOrders ?? "—"],
          [
            "EXECUTION",
            cached ? "CACHED" : duration === null ? "—" : `${(duration / 1000).toFixed(2)} s`,
          ],
        ].map(([label, value]) => (
          <div className="ql-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <main className="jsg-workbench">
        <aside className="jsg-controls">
          <div className="jsg-section-title">
            <b>策略参数</b>
            <span>JSG / 01</span>
          </div>
          <label>
            成交模型
            <select
              value={config.executionModel ?? MODEL}
              onChange={(e) =>
                change({
                  executionModel: e.currentTarget.value as "jsg-adjusted-v1" | "jsg-raw-v2",
                  fees: config.fees ?? [
                    {
                      from: m?.startDate ?? 20200101,
                      minimumCommission: 0,
                      transferBps: 0,
                      sellTaxBps: 0,
                    },
                  ],
                })
              }
            >
              <option value="jsg-adjusted-v1">复权研究 v1</option>
              <option value="jsg-raw-v2" disabled={m?.version !== 2}>
                原始价格 v2
              </option>
            </select>
          </label>
          {config.executionModel === "jsg-raw-v2" && (
            <div>
              <label>
                成交量参与率
                <input
                  type="number"
                  min="0.001"
                  max="1"
                  step="0.01"
                  value={config.participation ?? 0.1}
                  onChange={(e) => change({ participation: Number(e.currentTarget.value) })}
                />
              </label>
              {(config.fees ?? []).map((f, i) => (
                <div key={i}>
                  <label>
                    费用生效日
                    <input
                      type="number"
                      value={f.from}
                      onChange={(e) =>
                        change({
                          fees: config.fees!.map((old, j) =>
                            j === i ? { ...old, from: Number(e.currentTarget.value) } : old,
                          ),
                        })
                      }
                    />
                  </label>
                  {(
                    ["commissionBps", "minimumCommission", "transferBps", "sellTaxBps"] as const
                  ).map((key) => (
                    <label key={key}>
                      {key === "commissionBps"
                        ? "佣金 / bps"
                        : key === "minimumCommission"
                          ? "最低佣金 / 元"
                          : key === "transferBps"
                            ? "过户费用 / bps"
                            : "卖出税费 / bps"}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={f[key] ?? config.commissionBps}
                        onChange={(e) =>
                          change({
                            fees: config.fees!.map((old, j) =>
                              j === i ? { ...old, [key]: Number(e.currentTarget.value) } : old,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                className="ui-btn ui-btn-ghost"
                onClick={() =>
                  change({
                    fees: [
                      ...(config.fees ?? []),
                      {
                        from: Math.min(22001231, (config.fees?.at(-1)?.from ?? 20200101) + 10000),
                        minimumCommission: 0,
                        transferBps: 0,
                        sellTaxBps: 0,
                      },
                    ],
                  })
                }
              >
                添加费用生效区间
              </button>
            </div>
          )}
          <fieldset disabled={busy || !ready}>
            {fields.map(({ key, label, scale = 1, step }) => (
              <label className="jsg-field" key={key}>
                <span>{label}</span>
                <input
                  className="ui-input"
                  aria-label={label}
                  type="number"
                  min="0"
                  step={step}
                  value={
                    Number.isFinite(config[key]) ? Number((config[key] * scale).toFixed(8)) : ""
                  }
                  onChange={(e) => change({ [key]: e.currentTarget.valueAsNumber / scale })}
                />
              </label>
            ))}
            <label className="jsg-field">
              <span>行业黑名单</span>
              <input
                className="ui-input"
                aria-label="行业黑名单"
                value={config.industryBlacklist.join(",")}
                onChange={(e) =>
                  change({
                    industryBlacklist: e.currentTarget.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="jsg-toggle">
              <input
                type="checkbox"
                checked={config.tPlusOne}
                onChange={(e) => change({ tPlusOne: e.currentTarget.checked })}
              />
              启用 T+1 可卖数量约束
            </label>
          </fieldset>
          <p className="jsg-note">
            风控设为 0
            时关闭。周末收盘生成调仓指令，下一交易日开盘成交；风控与涨停打开按当日收盘撮合。
          </p>
          <button
            className="ui-btn ui-btn-ghost"
            disabled={!ready || busy}
            onClick={() => void importFiles(demoResearch().files)}
          >
            加载演示数据
          </button>
        </aside>
        <div className="jsg-results">
          {error !== null && (
            <div className="jsg-alert" role="alert">
              {error}
            </div>
          )}
          {m !== undefined && (
            <div className="jsg-dataset-summary">
              <b>{mode}</b>
              <span>
                {dateText(m.startDate)} — {dateText(m.endDate)}
              </span>
              <span>
                {m.partitions.length} 个分片 ·{" "}
                {m.partitions.reduce((s, p) => s + p.rows, 0).toLocaleString()} 行
              </span>
            </div>
          )}
          {result === null ? (
            <div className="jsg-empty">
              <span>JSG / RESEARCH</span>
              <h2>
                观察行业宽度
                <br />
                回放一整个股票池
              </h2>
              <p>选择参数，运行回测，查看组合净值与每一笔订单。</p>
            </div>
          ) : (
            <>
              <EquityPlot result={result} />
              <section className="jsg-order-section">
                <div className="jsg-section-title">
                  <b>订单记录</b>
                  <span>
                    显示 {Math.min(200, (pageOrders ?? result.orders).length)} /{" "}
                    {result.metrics.filledOrders + result.metrics.rejectedOrders} 笔 ·{" "}
                    {result.metrics.rejectedOrders} 笔拒单
                  </span>
                </div>
                {(result.chunks?.length ?? 0) > 0 && (
                  <div className="jsg-order-controls">
                    <select
                      aria-label="订单日期区间"
                      disabled={loadingOrders}
                      value={orderChunk}
                      onChange={(e) => void loadOrders(Number(e.currentTarget.value))}
                    >
                      <option value={-1}>最近订单</option>
                      {result.chunks!.map((c, i) => (
                        <option key={i} value={i}>
                          {c.start} — {c.end} · {c.orders} 笔
                        </option>
                      ))}
                    </select>
                    <button
                      className="ui-btn ui-btn-ghost"
                      disabled={orderOffset === 0 || loadingOrders}
                      onClick={() => setOrderOffset((v) => Math.max(0, v - 200))}
                    >
                      上一页
                    </button>
                    <button
                      className="ui-btn ui-btn-ghost"
                      disabled={
                        orderOffset + 200 >= (pageOrders ?? result.orders).length || loadingOrders
                      }
                      onClick={() => setOrderOffset((v) => v + 200)}
                    >
                      下一页
                    </button>
                  </div>
                )}
                <div className="jsg-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>成交日期</th>
                        <th>证券</th>
                        <th>方向</th>
                        <th>数量</th>
                        <th>价格</th>
                        <th>费用</th>
                        <th>时点 / 原因</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pageOrders ?? result.orders)
                        .slice()
                        .reverse()
                        .slice(orderOffset, orderOffset + 200)
                        .map((o, i) => (
                          <tr key={i}>
                            <td>{o.date}</td>
                            <td>{o.code}</td>
                            <td data-side={o.side}>{o.side === "buy" ? "买" : "卖"}</td>
                            <td>{o.quantity.toLocaleString()}</td>
                            <td>{money(o.price)}</td>
                            <td>{money(o.fee)}</td>
                            <td>
                              {o.timing} / {o.reason}
                            </td>
                            <td>{o.status}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
        <aside className="jsg-data-rail">
          <div className="jsg-section-title">
            <b>研究口径</b>
            <span>DAILY</span>
          </div>
          <p className="jsg-note">
            {config.executionModel === "jsg-raw-v2"
              ? "原始价格撮合，真实股数记账；复权价格只用于均线。分红送转、涨跌停和费用来自明确事件与日期规则；默认 T+1，并限制成交量参与率。"
              : "复权价格用于均线与研究成交；原始价格用于涨跌停及市值。持仓数量为研究单位。"}
          </p>
          {m?.universeMode === "snapshot" && (
            <p className="jsg-warning">当前成分快照不能还原历史股票池，结果可能存在幸存者偏差。</p>
          )}
          {(result?.warnings ?? m?.warnings ?? []).map((w, i) => (
            <p className="jsg-warning" key={i}>
              {w}
            </p>
          ))}
          <div className="jsg-section-title">
            <b>最近调仓</b>
          </div>
          <p className="jsg-note">
            {latestDecision === undefined
              ? "运行后显示行业宽度与候选股票。"
              : `${latestDecision.date} · ${latestDecision.topIndustry ?? "无有效行业"} · ${latestDecision.breadth}%`}
          </p>
          <div className="jsg-targets">
            {latestDecision?.targets.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <div className="jsg-section-title">
            <b>期末持仓</b>
            <span>{result?.holdings.length ?? 0}</span>
          </div>
          {result?.holdings.map((h) => (
            <div className="jsg-holding" key={h.code}>
              <span>
                {h.code}
                <small>{h.quantity.toLocaleString()} 单位</small>
              </span>
              <b>¥{money(h.value)}</b>
            </div>
          ))}
          {result !== null && (
            <p className="jsg-note">期末未成交调仓单 {result.pendingOrders} 笔，不作强制平仓。</p>
          )}
        </aside>
      </main>
      <footer className="jsg-footer" aria-live="polite">
        <span>{status}</span>
        <progress value={progress} max="1" aria-label="JSG 回测进度" />
        <span>{config.executionModel ?? MODEL}</span>
      </footer>
    </div>
  );
}
