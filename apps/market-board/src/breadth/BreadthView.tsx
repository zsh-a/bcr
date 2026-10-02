import { breadthGrid } from "@bcr/market-data/research/breadth-grid";
import { useEffect, useRef, useState } from "react";
import {
  Heatmap,
  Button,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  useNavigation,
  useRuntimeActivity,
} from "@bcr/react";
import { ArrowUpRight, Database, Settings2 } from "lucide-react";
import { calculateMarketBreadth, type BreadthDay } from "@bcr/market-data/research/breadth-browser";
import {
  listMarketSnapshots,
  pinMarketSnapshot,
  readMarketSnapshot,
  readMarketProfile,
  saveMarketProfile,
  snapshotId,
  unpinMarketSnapshot,
  readMarketLabels,
} from "@bcr/market-data/research/catalog";
import { inspectFromBrowser, loadFromBrowser } from "@bcr/market-data/research/clickhouse-browser";
import {
  DEFAULT_CONNECTION,
  type ClickHouseConnection,
  type ClickHouseRange,
} from "@bcr/market-data/research/clickhouse-http";
import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import { dateText, type ResearchDataset } from "@bcr/market-data/research/model";

export default function BreadthView({
  requestedSnapshot,
  requestedDate,
}: {
  requestedSnapshot: string | null;
  requestedDate: string | null;
}) {
  const navigation = useNavigation(),
    active = useRuntimeActivity();
  const [snapshots, setSnapshots] = useState<ResearchDataset[]>([]),
    [dataset, setDataset] = useState<ResearchDataset | null>(null);
  const [industryNames, setIndustryNames] = useState<Record<string, string>>({});
  const [days, setDays] = useState<BreadthDay[]>([]),
    [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{ industry: string; date: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const profile = useRef(readMarketProfile());
  const [connection, setConnection] = useState<ClickHouseConnection>(() => ({
    ...DEFAULT_CONNECTION,
    ...profile.current,
    password: "",
  }));
  const [range, setRange] = useState<ClickHouseRange>(() => ({
    start: profile.current?.start ?? "",
    end: profile.current?.end ?? "",
    strictPit: profile.current?.strictPit ?? false,
    refresh: false,
  }));
  const [tested, setTested] = useState(false),
    [pitReady, setPitReady] = useState(false);
  const operation = useRef<AbortController | null>(null),
    request = useRef(0);
  const begin = () => {
    operation.current?.abort();
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    setStatus("正在加载数据…");
    setError("");
    return abort;
  };
  const show = async (next: ResearchDataset, abort: AbortController) => {
    const id = await pinMarketSnapshot(next);
    abort.signal.throwIfAborted();
    setStatus("正在计算每日 MA20 行业宽度…");
    const calculated = await calculateMarketBreadth(next, abort.signal, (done) =>
      setStatus(`正在计算每日宽度 · ${Math.round(done * 100)}%`),
    );
    abort.signal.throwIfAborted();
    const labels = await readMarketLabels(next);
    abort.signal.throwIfAborted();
    setIndustryNames(labels.industries);
    setDataset(next);
    setDays(calculated);
    setSelection(null);
    const date =
      requestedDate && calculated.some((d) => d.date === requestedDate)
        ? requestedDate
        : calculated.at(-1)?.date;
    setPage(
      Math.max(
        0,
        Math.floor(
          Math.max(
            0,
            calculated.findIndex((d) => d.date === date),
          ) / 63,
        ),
      ),
    );
    setStatus(
      `冻结快照 · ${next.manifest.instruments.length.toLocaleString()} 只证券 · ${calculated.length} 个交易日`,
    );
    navigation.navigate(`/markets?view=breadth&snapshot=${id}${date ? `&date=${date}` : ""}`, true);
    const catalog = await listMarketSnapshots();
    abort.signal.throwIfAborted();
    setSnapshots(catalog);
  };
  const perform = async (work: (abort: AbortController) => Promise<void>) => {
    const abort = begin();
    try {
      await withResearchFiles("shared", () => work(abort));
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("");
      }
    } finally {
      if (operation.current === abort) {
        operation.current = null;
        setBusy(false);
        if (abort.signal.aborted) setStatus("已取消操作");
      }
    }
  };
  useEffect(() => {
    const current = ++request.current;
    void listMarketSnapshots()
      .then((found) => {
        if (request.current === current) setSnapshots(found);
      })
      .catch((e) => {
        if (request.current === current) setError(String(e));
      });
    return () => {
      request.current++;
      operation.current?.abort();
    };
  }, []);
  const loadedRequest = useRef<string | null>(null);
  useEffect(() => {
    if (
      !requestedSnapshot ||
      loadedRequest.current === requestedSnapshot ||
      (dataset && snapshotId(dataset) === requestedSnapshot)
    )
      return;
    loadedRequest.current = requestedSnapshot;
    void perform(async (abort) => {
      const next = await readMarketSnapshot(requestedSnapshot);
      abort.signal.throwIfAborted();
      await show(next, abort);
    });
  }, [requestedSnapshot]);
  useEffect(() => {
    if (!active) operation.current?.abort();
  }, [active]);
  const inspect = () =>
    perform(async (abort) => {
      setStatus("正在检查 ClickHouse 数据覆盖…");
      const info = await inspectFromBrowser(connection, abort.signal);
      abort.signal.throwIfAborted();
      setTested(true);
      setPitReady(info.strictPitReady);
      const yearStart = `${info.lastBacktestDate.slice(0, 4)}-01-01`;
      setRange((value) => ({
        ...value,
        start: value.start || (yearStart > info.firstDate ? yearStart : info.firstDate),
        end: value.end || info.lastBacktestDate,
        strictPit: info.strictPitReady && value.strictPit,
      }));
      setStatus(`ClickHouse ${info.version} · 数据截至 ${info.lastBacktestDate}`);
    });
  const load = () =>
    perform(async (abort) => {
      const loaded = await loadFromBrowser(connection, range, abort.signal, (p) =>
        setStatus(`${p.text} · ${p.total ? Math.round((p.completed / p.total) * 100) : 0}%`),
      );
      abort.signal.throwIfAborted();
      saveMarketProfile(connection, range);
      setSourceOpen(false);
      await show(loaded.dataset, abort);
    });
  const openQuant = async () => {
    if (!dataset || busy) return;
    try {
      const id = await pinMarketSnapshot(dataset);
      navigation.navigate(`/quant?snapshot=${id}${selection ? `&date=${selection.date}` : ""}`);
    } catch (e) {
      setError(String(e));
    }
  };
  const current = days.slice(page * 63, (page + 1) * 63),
    names = industryNames;
  const selectedBreadth = selection
    ? days
        .find((d) => d.date === selection.date)
        ?.breadth.find((b) => b.industry === selection.industry)
    : undefined;
  return (
    <section className="ma-breadth-view" aria-label="历史行业宽度" aria-busy={busy}>
      <div className="ma-view-heading">
        <div>
          <h1>历史行业宽度</h1>
          <p>
            复权收盘价高于 MA20 的成员占比 ·{" "}
            {dataset?.manifest.universeMode === "synthetic"
              ? "合成行业"
              : dataset?.manifest.industries.every(
                    (code) => code === "unknown" || /^801\d{3}$/u.test(code),
                  )
                ? "申万行业"
                : "数据集行业分类"}{" "}
            · 宽度证券池
          </p>
        </div>
        <Button onClick={() => setSourceOpen(true)}>
          <Database size={16} /> 数据源
        </Button>
      </div>
      <div className="ma-breadth-toolbar">
        <Select
          aria-label="选择冻结数据快照"
          value={dataset ? snapshotId(dataset) : ""}
          disabled={busy}
          onChange={(event) => {
            const next = snapshots.find((s) => snapshotId(s) === event.target.value);
            if (next) void perform((abort) => show(next, abort));
          }}
        >
          <option value="">选择已有快照</option>
          {snapshots.map((s) => (
            <option key={snapshotId(s)} value={snapshotId(s)}>
              {s.manifest.name.includes(dateText(s.manifest.startDate))
                ? s.manifest.name
                : `${s.manifest.name} · ${dateText(s.manifest.startDate)} — ${dateText(s.manifest.endDate)}`}
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => void openQuant()} disabled={!dataset || busy}>
          <ArrowUpRight size={16} /> 在 Quant 研究
        </Button>
      </div>
      {error && (
        <p className="ma-error" role="alert">
          {error}
        </p>
      )}
      {(busy || status) && (
        <div className="ma-operation" role="status">
          {busy && <Spinner size="sm" />}
          <span className="ma-operation-message">{status}</span>
          {busy && (
            <Button size="sm" onClick={() => operation.current?.abort()}>
              取消
            </Button>
          )}
        </div>
      )}
      {dataset && (
        <>
          <div className="ma-data-stamp">
            <span>来源：{dataset.manifest.source}</span>
            <span>
              快照：
              {dataset.snapshot?.createdAt
                ? new Date(dataset.snapshot.createdAt).toLocaleString()
                : "本地导入"}
            </span>
            <span>
              {dataset.manifest.universeMode === "historical"
                ? "历史成员"
                : dataset.manifest.universeMode === "synthetic"
                  ? "合成演示数据"
                  : "快照成员 · 存在幸存者偏差"}
            </span>
          </div>
          {dataset.manifest.warnings.length > 0 && (
            <details className="ma-data-notes">
              <summary>数据说明 · {dataset.manifest.warnings.length}</summary>
              {dataset.manifest.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          )}
          <div className="ma-section-heading">
            <b>
              {current[0]?.date} — {current.at(-1)?.date}
            </b>
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                更早
              </Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(days.length / 63))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={(page + 1) * 63 >= days.length || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                更晚
              </Button>
            </div>
          </div>
          <Heatmap
            {...breadthGrid(current, names)}
            selectedColumn={selection?.date ?? requestedDate ?? undefined}
            onSelect={(industry, date) => {
              setSelection({ industry, date });
              navigation.navigate(
                `/markets?view=breadth&snapshot=${snapshotId(dataset)}&date=${date}`,
                true,
              );
            }}
          />
          <p className="ma-caption">
            颜色越深，宽度越高。缺少 20 次行情观测的成员不计入；空白表示可计算成员不足。每页最多 63
            个交易日。
          </p>
          {selection && (
            <div className="ma-breadth-inspector">
              <div>
                <h2>{names[selection.industry] || selection.industry}</h2>
                <p>
                  {selection.industry} · {selection.date}
                </p>
              </div>
              <strong>{selectedBreadth?.ratio ?? "—"}%</strong>
              <span>
                {selectedBreadth?.above ?? 0} / {selectedBreadth?.total ?? 0} 只高于 MA20
              </span>
              <Button variant="ghost" onClick={() => void openQuant()}>
                用此快照研究 JSG <ArrowUpRight size={16} />
              </Button>
            </div>
          )}
        </>
      )}
      {!dataset && !busy && (
        <EmptyState
          title="尚未选择数据"
          description="选择已有快照，或连接 ClickHouse 获取数据。无需先运行回测。"
          action={
            <Button variant="primary" onClick={() => setSourceOpen(true)}>
              连接 ClickHouse
            </Button>
          }
        />
      )}
      <Dialog
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        title="宽度数据源"
        className="ma-source-dialog"
      >
        <p className="ma-caption">
          共享只读连接；密码仅在本次会话内使用。数据按 Arrow 分片保存为冻结快照。
        </p>
        {dataset && (
          <p className="ma-caption">
            当前共享快照已保留，Quant 清理会保护其数据。
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void withResearchFiles("exclusive", async () => {
                  await unpinMarketSnapshot(snapshotId(dataset));
                  setStatus("已解除共享保留；数据可在 Quant 存储设置中清理");
                  navigation.navigate("/markets?view=breadth", true);
                }).catch((e) => setError(String(e)))
              }
            >
              解除共享保留
            </Button>
          </p>
        )}
        <div className="ma-source-fields">
          {(
            [
              ["url", "HTTP 地址"],
              ["database", "数据库"],
              ["user", "用户"],
              ["password", "密码"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <Input
                aria-label={label}
                type={key === "password" ? "password" : "text"}
                autoComplete={key === "password" ? "new-password" : "off"}
                value={connection[key]}
                disabled={busy}
                onChange={(e) => {
                  setConnection((c) => ({ ...c, [key]: e.target.value }));
                  setTested(false);
                }}
              />
            </label>
          ))}
        </div>
        <div className="ma-source-dates">
          <label>
            开始日期
            <Input
              type="date"
              aria-label="开始日期"
              value={range.start}
              disabled={busy}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
            />
          </label>
          <label>
            结束日期
            <Input
              type="date"
              aria-label="结束日期"
              value={range.end}
              disabled={busy}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
            />
          </label>
        </div>
        <label className="ma-checkbox">
          <input
            type="checkbox"
            checked={range.strictPit}
            disabled={!pitReady || busy}
            onChange={(e) => setRange((r) => ({ ...r, strictPit: e.target.checked }))}
          />
          使用历史成员与披露时点
        </label>
        <label className="ma-checkbox">
          <input
            type="checkbox"
            checked={range.refresh}
            disabled={busy}
            onChange={(e) => setRange((r) => ({ ...r, refresh: e.target.checked }))}
          />
          获取新的源数据快照
        </label>
        {error && (
          <p className="ma-error" role="alert">
            {error}
          </p>
        )}
        <p className="ma-operation" role="status">
          {busy && <Spinner size="sm" />}
          <span className="ma-operation-message">{status}</span>
        </p>
        <div className="ma-dialog-actions">
          <Button onClick={() => void inspect()} disabled={busy}>
            <Settings2 size={16} />
            检查连接
          </Button>
          {busy ? (
            <Button onClick={() => operation.current?.abort()}>取消</Button>
          ) : (
            <Button
              variant="primary"
              disabled={!tested || !range.start || !range.end || range.start > range.end}
              onClick={() => void load()}
            >
              加载并分析
            </Button>
          )}
        </div>
      </Dialog>
    </section>
  );
}
