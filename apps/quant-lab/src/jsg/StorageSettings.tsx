import { useEffect, useState } from "react";
import { Button, Dialog, Spinner, formatBytes } from "@bcr/react";
import { Database, HardDrive, Trash2, RefreshCw } from "lucide-react";
import type { RuntimeServices } from "@bcr/core";
import type { ResearchDataset } from "./model";
import { clearResultCache } from "./result-reader";
import { dateText } from "./model";
import {
  planResearchCleanup,
  reclaimResearch,
  researchUsage,
  type ResearchCleanupPlan,
  type ResearchUsage,
} from "./storage";
import type { useResearch } from "./useResearch";

export function StorageSettings({
  services,
  research,
  open,
  busy,
  onClose,
  onWorking,
  onUse,
}: {
  services: RuntimeServices;
  research: ReturnType<typeof useResearch>;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onWorking: (value: boolean) => void;
  onUse: (dataset: ResearchDataset) => Promise<void>;
}) {
  const [usage, setUsage] = useState<ResearchUsage | null>(null);
  const [quota, setQuota] = useState<StorageEstimate | null>(null);
  const [plan, setPlan] = useState<ResearchCleanupPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    setUsage(await researchUsage(services, research.getSession()));
    setQuota(await navigator.storage.estimate());
  };
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setError(null);
    setPlan(null);
    setMessage("");
    setUsage(null);
    void Promise.all([researchUsage(services, research.getSession()), navigator.storage.estimate()])
      .then(([next, estimate]) => {
        if (!disposed) {
          setUsage(next);
          setQuota(estimate);
        }
      })
      .catch((caught: unknown) => {
        if (!disposed) setError(String(caught));
      });
    return () => {
      disposed = true;
    };
  }, [open, services]);
  const act = async (work: () => Promise<void>) => {
    setWorking(true);
    onWorking(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
      onWorking(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      closable={!working}
      title="数据与存储"
      className="research-storage-dialog"
    >
      <p className="research-dialog-lead">
        查看本地快照，释放不再使用的数据。运行历史引用的文件会保留。
      </p>
      <div className="research-storage-summary">
        <div>
          <HardDrive size={17} />
          <span>
            研究数据<b>{usage ? formatBytes(usage.bytes) : "—"}</b>
            <small>{usage?.objects ?? 0} 个文件</small>
          </span>
        </div>
        <div>
          <Database size={17} />
          <span>
            站点可用空间
            <b>
              {quota?.quota !== undefined
                ? formatBytes(Math.max(0, quota.quota - (quota.usage ?? 0)))
                : "—"}
            </b>
            <small>浏览器估算，包含本站其他应用</small>
          </span>
        </div>
      </div>
      <div className="research-storage-heading">
        <h3>本地快照</h3>
        <Button
          variant="ghost"
          size="sm"
          aria-label="刷新存储用量"
          disabled={working}
          onClick={() => void act(refresh)}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {!usage && !error && <Spinner size="sm" />}
      <div className="research-snapshot-list">
        {usage?.snapshots.map(({ path, record, bytes, used }) => (
          <div key={path}>
            <span>
              <b>{record.dataset.manifest.name}</b>
              <small>
                {dateText(record.dataset.manifest.startDate)} —{" "}
                {dateText(record.dataset.manifest.endDate)} · {formatBytes(bytes)}
              </small>
              <small>
                {record.createdAt
                  ? `获取于 ${new Date(record.createdAt).toLocaleString("zh-CN")}`
                  : "早期快照，获取时间未记录"}
                {used ? " · 当前或历史正在使用" : ""}
              </small>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || working}
              onClick={() => void act(() => onUse(record.dataset))}
            >
              使用快照
            </Button>
          </div>
        ))}
        {usage?.snapshots.length === 0 && (
          <p className="research-dialog-lead">尚无可复用的本地快照。</p>
        )}
      </div>
      {error && (
        <p className="research-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="research-dialog-lead">
          {message}
        </p>
      )}
      <div className="research-storage-cleanup">
        {plan ? (
          <>
            <p>
              可释放 {formatBytes(plan.bytes)}，涉及 {plan.candidates.length}{" "}
              个数据文件。当前快照和保留的运行不受影响。
            </p>
            <div>
              <Button variant="ghost" disabled={working} onClick={() => setPlan(null)}>
                返回
              </Button>
              <Button
                disabled={working || busy}
                onClick={() =>
                  void act(async () => {
                    await research.flush();
                    const result = await reclaimResearch(services, plan, research.getSession);
                    clearResultCache();
                    setMessage(
                      `已释放 ${formatBytes(result.reclaimedBytes)} · ${result.deleted.length} 个文件`,
                    );
                    setPlan(null);
                    await refresh();
                  })
                }
              >
                {working ? <Spinner size="sm" /> : <Trash2 size={14} />}确认清理
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>清理未被当前快照、运行历史和其他任务引用的数据。移除历史后可再次清理。</p>
            <Button
              variant="ghost"
              disabled={busy || working || !usage}
              onClick={() =>
                void act(async () => {
                  await research.flush();
                  setPlan(await planResearchCleanup(services, research.getSession()));
                })
              }
            >
              {working ? <Spinner size="sm" /> : <Trash2 size={14} />}清理未使用数据
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
