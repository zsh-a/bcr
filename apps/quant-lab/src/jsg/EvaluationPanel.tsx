import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import { Button, Dialog, Input, Select, Spinner } from "@bcr/react";
import { Download, Settings2, X } from "lucide-react";
import type { SelectedRun } from "./session";
import type { ClickHouseConnection } from "./clickhouse-http";
import {
  benchmarkBaseline,
  parseBenchmarkCsv,
  readBenchmark,
  saveBenchmark,
  validateBenchmarkCoverage,
  type BenchmarkBinding,
  type BenchmarkKind,
  type BenchmarkSnapshot,
} from "./benchmark";
import { benchmarkFromBrowser } from "./clickhouse-browser";
import { queryEvaluation } from "./result-reader";
import { dateText } from "./model";
import { money, percent } from "./Orders";
import type { Evaluation, PeriodReturn } from "./evaluation";
import { withResearchFiles } from "./file-lease";
const EvaluationChart = lazy(() => import("./EvaluationChart"));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function EvaluationPanel({
  services,
  selected,
  connection,
  busy,
  onBenchmark,
  onWorking,
}: {
  services: RuntimeServices;
  selected: SelectedRun;
  connection: ClickHouseConnection;
  busy: boolean;
  onBenchmark: (runId: string, b?: BenchmarkBinding) => void;
  onWorking: (value: boolean) => void;
}) {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState("clickhouse"),
    [code, setCode] = useState("sh.000300"),
    [name, setName] = useState("自定义基准"),
    [kind, setKind] = useState<BenchmarkKind>("price"),
    [working, setWorking] = useState(false),
    [period, setPeriod] = useState("months"),
    [page, setPage] = useState(0);
  const active = useRef<AbortController | null>(null),
    latest = useRef({ onWorking, onBenchmark });
  latest.current = { onWorking, onBenchmark };
  const manifest = useMemo(
    () => ({
      ...selected.dataset.manifest,
      startDate: selected.run.startDate,
      endDate: selected.run.endDate,
    }),
    [selected.dataset.manifest, selected.run.startDate, selected.run.endDate],
  );
  useEffect(
    () => () => {
      active.current?.abort();
      latest.current.onWorking(false);
    },
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setEvaluation(null);
    setError(null);
    void withResearchFiles("shared", () =>
      queryEvaluation(
        selected.result,
        selected.run.config.initialCapital,
        manifest.calendar
          .filter((s) => s.date >= manifest.startDate && s.date <= manifest.endDate)
          .map((s) => dateText(s.date)),
        benchmarkBaseline(manifest),
        selected.run.benchmark,
        abort.signal,
      ),
    )
      .then((value) => {
        if (!abort.signal.aborted) {
          setEvaluation(value);
          setPage(0);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (!abort.signal.aborted) {
          setError(message(caught));
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [selected.result, selected.run.config.initialCapital, selected.run.benchmark, manifest]);
  const attach = async (load: (signal: AbortSignal) => Promise<BenchmarkSnapshot>) => {
    if (active.current || busy) return;
    const abort = new AbortController();
    active.current = abort;
    setWorking(true);
    latest.current.onWorking(true);
    setError(null);
    try {
      await withResearchFiles("shared", async () => {
        const snapshot = await load(abort.signal);
        abort.signal.throwIfAborted();
        validateBenchmarkCoverage(snapshot, manifest);
        const binding = await saveBenchmark(services, snapshot);
        abort.signal.throwIfAborted();
        latest.current.onBenchmark(selected.run.id, binding);
      });
      setOpen(false);
    } catch (caught) {
      if (!abort.signal.aborted) setError(message(caught));
    } finally {
      if (active.current === abort) {
        active.current = null;
        setWorking(false);
        latest.current.onWorking(false);
      }
    }
  };
  const download = async () => {
    if (!evaluation || loading) return;
    try {
      const snapshot = selected.run.benchmark
        ? await withResearchFiles("shared", () => readBenchmark(services, selected.run.benchmark!))
        : undefined;
      const blob = new Blob(
        [
          JSON.stringify({
            run: selected.run,
            manifest: selected.dataset.manifest,
            evaluation,
            benchmark: snapshot,
          }),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "jsg-evaluation.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const rows = evaluation?.[period === "months" ? "months" : "years"] ?? [];
  const annual = evaluation?.strategy;
  return (
    <section className="research-evaluation" aria-label="研究评估" aria-busy={loading || working}>
      <div className="research-evaluation-head">
        <div>
          <span className="research-eyebrow">所选运行 · 完整交易日</span>
          <h3>收益与基准</h3>
        </div>
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            <Settings2 size={14} />
            设置基准
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="导出研究评估"
            disabled={!evaluation || loading}
            onClick={() => void download()}
          >
            <Download size={15} />
          </Button>
        </div>
      </div>
      <p className="research-evaluation-source">
        {selected.run.benchmark
          ? `${selected.run.benchmark.name} · ${selected.run.benchmark.kind === "price" ? "价格收益 · 不含分红" : "全收益 · 按导入数据"} · 获取于 ${new Date(selected.run.benchmark.acquiredAt).toLocaleString("zh-CN")}`
          : "尚未设置基准，可从 ClickHouse 获取指数或导入 CSV。"}
        {selected.run.benchmark && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="移除所选运行基准"
            disabled={busy}
            onClick={() => onBenchmark(selected.run.id)}
          >
            <X size={13} />
          </Button>
        )}
      </p>
      {error && (
        <p className="research-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="research-evaluation-loading" role="status">
          <Spinner size="sm" />
          正在读取完整结果分片…
        </p>
      )}
      {annual && evaluation && (
        <>
          <dl className="research-evaluation-metrics">
            {[
              ["策略年化", percent(annual.annualizedReturn)],
              ["年化波动", percent(annual.volatility)],
              [
                "基准收益",
                evaluation.benchmark ? percent(evaluation.benchmark.stats.totalReturn) : "—",
              ],
              [
                "超额收益",
                evaluation.benchmark
                  ? `${(evaluation.benchmark.excessReturn * 100).toFixed(2)} pp`
                  : "—",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <details className="research-evaluation-details">
            <summary>风险与收益质量</summary>
            <dl className="research-evaluation-metrics">
              {[
                ["Sortino", annual.sortino === null ? "—" : annual.sortino.toFixed(2)],
                ["Calmar", annual.calmar === null ? "—" : annual.calmar.toFixed(2)],
                ["年化下行波动", percent(annual.downsideDeviation)],
                ["盈利日比例", percent(annual.winRate)],
                ["日盈亏比", annual.profitFactor === null ? "—" : annual.profitFactor.toFixed(2)],
                ["盈利 / 亏损日", `${annual.winningDays} / ${annual.losingDays}`],
                ["平均盈利日", money(annual.avgWin)],
                ["平均亏损日", money(annual.avgLoss)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="research-help">
              按完整日收盘权益计算，包含首日与交易费用。盈利日比例包含平盘日；日盈亏比与平均盈亏按日统计，金额单位为元。Sortino
              使用零目标收益、全部交易日下行均方根；Calmar
              使用年化收益除以最大回撤绝对值。分母为零的比率显示「—」，导出为 null。
            </p>
          </details>
          {evaluation.benchmark && (
            <>
              <div className="research-evaluation-legend">
                <span>策略净值</span>
                <span>基准净值 · {evaluation.benchmark.name}</span>
                <small>区间前一交易日 = 1 · {evaluation.strategy.days} 个交易日</small>
              </div>
              <Suspense fallback={<Spinner size="sm" />}>
                <EvaluationChart evaluation={evaluation} />
              </Suspense>
            </>
          )}
          <div className="research-period-heading">
            <h4>分期收益</h4>
            <Select
              aria-label="分期收益频率"
              value={period}
              onChange={(e) => {
                setPeriod(e.currentTarget.value);
                setPage(0);
              }}
            >
              <option value="months">按月</option>
              <option value="years">按年</option>
            </Select>
          </div>
          <div className="research-table-wrap">
            <table className="research-table research-period-table">
              <thead>
                <tr>
                  <th>期间</th>
                  <th>交易日</th>
                  <th className="numeric">策略收益</th>
                  {evaluation.benchmark && (
                    <>
                      <th className="numeric">基准收益</th>
                      <th className="numeric">超额 / pp</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 24, page * 24 + 24).map((row: PeriodReturn) => (
                  <tr key={row.period}>
                    <td>
                      {row.period}
                      <small>
                        {row.first} — {row.last}
                      </small>
                    </td>
                    <td>{row.days}</td>
                    <td className="numeric" data-tone={row.strategy >= 0 ? "positive" : "negative"}>
                      {percent(row.strategy)}
                    </td>
                    {evaluation.benchmark && (
                      <>
                        <td className="numeric">{percent(row.benchmark!)}</td>
                        <td className="numeric">{(row.excess! * 100).toFixed(2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="research-pagination">
            <span>
              共 {rows.length} 期 · {page * 24 + 1}–{Math.min(rows.length, (page + 1) * 24)}
            </span>
            <div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="上一页分期收益"
                disabled={page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="下一页分期收益"
                disabled={(page + 1) * 24 >= rows.length}
                onClick={() => setPage((v) => v + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
          <details className="research-evaluation-conventions">
            <summary>指标口径与版本</summary>
            <p>
              收益按日收盘权益计算，包含首日相对初始本金的收益及实际费用。每年 252
              个交易日，无风险收益率为 0；波动率和 Sharpe
              使用日收益样本方差。月度/年度按上一交易日权益复利计算，区间首尾可能是不完整月份或年份。
            </p>
            <p>
              基准需包含区间前一交易日及所有回测交易日；缺失时拒绝比较。超额收益为策略收益减基准收益，单位为百分点；它与相对净值收益不同。
            </p>
            <dl>
              <div>
                <dt>回测引擎</dt>
                <dd>{selected.run.versions?.engine ?? "历史运行 · 未记录"}</dd>
              </div>
              <div>
                <dt>指标版本</dt>
                <dd>{selected.run.versions?.metrics ?? "历史运行 · 未记录"}</dd>
              </div>
              <div>
                <dt>评估版本</dt>
                <dd>{evaluation.version}</dd>
              </div>
            </dl>
          </details>
        </>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closable={!working}
        title="设置研究基准"
        className="research-benchmark-dialog"
      >
        <p className="research-dialog-lead">
          绑定所选运行的 {dateText(selected.run.startDate)} — {dateText(selected.run.endDate)}{" "}
          区间。后续修改数据连接或草稿不会改变已保存基准。
        </p>
        <Select
          aria-label="基准数据来源"
          value={mode}
          disabled={working}
          onChange={(e) => setMode(e.currentTarget.value)}
        >
          <option value="clickhouse">ClickHouse 指数</option>
          <option value="csv">导入 CSV</option>
        </Select>
        {mode === "clickhouse" ? (
          <>
            <label>
              指数代码
              <Input
                aria-label="基准指数代码"
                value={code}
                disabled={working}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
            </label>
            <p className="research-dialog-lead">
              使用当前连接 {connection.database} 的 stock_daily 收盘价，按价格收益比较，不含分红。
            </p>
            <Button
              variant="primary"
              disabled={working || busy}
              onClick={() =>
                void attach((signal) => benchmarkFromBrowser(connection, code, manifest, signal))
              }
            >
              获取并绑定基准
            </Button>
          </>
        ) : (
          <>
            <label>
              基准名称
              <Input
                aria-label="基准名称"
                value={name}
                disabled={working}
                maxLength={120}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </label>
            <label>
              收益类型
              <Select
                aria-label="基准收益类型"
                value={kind}
                disabled={working}
                onChange={(e) => setKind(e.currentTarget.value as BenchmarkKind)}
              >
                <option value="price">价格收益 · 不含分红</option>
                <option value="total-return">全收益 · 数据已含分红</option>
              </Select>
            </label>
            <p className="research-dialog-lead">
              表头 date,close；每行 YYYY-MM-DD,收盘值。包含 {benchmarkBaseline(manifest)}{" "}
              及所有回测交易日，最多 20,000 行 / 2 MiB。
            </p>
            <input
              type="file"
              aria-label="导入基准 CSV"
              accept=".csv,text/csv"
              disabled={working || busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file)
                  void attach(async () => {
                    if (file.size > 2 * 1024 * 1024) throw new Error("基准 CSV 超过 2 MiB");
                    return parseBenchmarkCsv(await file.text(), name, kind);
                  });
              }}
            />
          </>
        )}
        {error && (
          <p className="research-error" role="alert">
            {error}
          </p>
        )}
        {working && (
          <div className="research-benchmark-progress" role="status">
            <Spinner size="sm" />
            正在获取基准…
            <Button variant="ghost" size="sm" onClick={() => active.current?.abort()}>
              取消基准获取
            </Button>
          </div>
        )}
      </Dialog>
    </section>
  );
}
