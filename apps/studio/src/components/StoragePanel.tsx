import { useArtifactUsage } from "@bcr/react";
import type { ArtifactInventoryEntry, CachePrunePlan, TaskJournalPrunePlan } from "@bcr/core";
import { Effect } from "effect";
import { Database, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services";
import { useStudio } from "../store";
import { CACHE_RETENTION, JOURNAL_RETENTION } from "../storage-policy";
import { Badge, formatBytes, PanelEmpty, ProgressBar, SectionLabel } from "./ui";

interface StorageSnapshot {
  readonly inventory: ReadonlyArray<ArtifactInventoryEntry>;
  readonly cache: CachePrunePlan;
  readonly journal: TaskJournalPrunePlan;
  readonly updatedAt: number;
}

/**
 * Storage Plane：把二进制容量、项目根文件与元数据保留状态集中呈现。
 * 面板只读；实际清理沿用 ⌘K 中的安全 dry-run/确认流程。
 */
export function StoragePanel() {
  const services = useServices();
  const usage = useArtifactUsage();
  const files = useStudio((state) => state.files);
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    usage.refresh();
    setRefreshToken((token) => token + 1);
  }, [usage.refresh]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      Effect.runPromise(services.artifacts.inventory()),
      Effect.runPromise(services.scheduler.planCachePrune(CACHE_RETENTION)),
      Effect.runPromise(services.scheduler.planJournalPrune(JOURNAL_RETENTION)),
    ]).then(
      ([inventory, cache, journal]) => {
        if (cancelled) return;
        setSnapshot({ inventory, cache, journal, updatedAt: Date.now() });
        setStatus("ready");
        setError(undefined);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    const unsubscribe = services.artifacts.subscribe(refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [refresh, refreshToken, services]);

  const fileBytes = files.reduce((total, file) => total + file.size, 0);
  const usageRows = useMemo(() => {
    const rows = usage.usage?.byStorage ?? [];
    const maxBytes = Math.max(1, usage.usage?.totalBytes ?? 0);
    return rows.map((row) => ({ ...row, ratio: row.bytes / maxBytes }));
  }, [usage.usage]);

  return (
    <div className="studio-storage-panel h-full overflow-auto pb-6">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-accent" />
          <span className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
            Storage Plane
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          title="刷新存储统计"
          aria-label="刷新存储统计"
          className="inline-flex size-8 items-center justify-center rounded-[var(--radius-xs)] text-faint transition-colors hover:bg-raised hover:text-text"
        >
          <RefreshCw className={`size-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
        </button>
      </div>

      <section className="border-b border-border px-3 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[27px] leading-none tracking-[-0.05em] text-text">
              {usage.status === "ready" && usage.usage !== undefined
                ? formatBytes(usage.usage.totalBytes)
                : "—"}
            </div>
            <div className="mt-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              materialized artifacts
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[16px] text-accent">
              {usage.status === "ready" && usage.usage !== undefined
                ? usage.usage.totalObjects
                : "—"}
            </div>
            <div className="mt-1 font-mono text-[10px] text-faint">objects</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
          <Database className="size-3.5 text-faint" />
          <span>{files.length} 个项目源文件</span>
          <span className="text-faint">·</span>
          <span>{formatBytes(fileBytes)}</span>
        </div>
      </section>

      <SectionLabel>Backends</SectionLabel>
      <section className="space-y-2 px-3">
        {usageRows.length === 0 && usage.status !== "error" && (
          <p className="text-[11px] text-faint">暂无存储后端数据</p>
        )}
        {usageRows.map((row) => (
          <div
            key={row.storage}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-text">{row.storage}</span>
              <span className="font-mono text-[10px] text-muted">
                {formatBytes(row.bytes)} · {row.objects}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar value={row.ratio} />
            </div>
          </div>
        ))}
        {usage.status === "error" && (
          <p className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-2.5 py-2 font-mono text-[10px] text-danger">
            {usage.error ?? "storage unavailable"}
          </p>
        )}
      </section>

      <SectionLabel>Retention</SectionLabel>
      <section className="space-y-2 px-3">
        {snapshot === null ? (
          <p className="text-[11px] text-faint">{status === "error" ? error : "正在读取元数据…"}</p>
        ) : (
          <>
            <RetentionRow
              label="Cache · 30d / 200"
              count={snapshot.cache.candidates.length}
              detail={`${snapshot.cache.scannedEntries} entries scanned`}
            />
            <RetentionRow
              label="Task history · 90d / 500"
              count={snapshot.journal.candidates.length}
              detail={`${snapshot.journal.scannedEntries} records · ${snapshot.journal.activeEntries} active protected`}
            />
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-accent/20 bg-accent-dim/25 px-2.5 py-2 font-mono text-[10px] text-accent">
              <ShieldCheck className="size-3.5" />
              <span>清理前会生成计划并二次校验</span>
            </div>
          </>
        )}
      </section>

      <SectionLabel>Recent artifacts</SectionLabel>
      <section className="px-3">
        {snapshot?.inventory.length === 0 ? (
          <PanelEmpty title="暂无 Artifact" hint="运行计算或导入文件后会出现在这里" />
        ) : (
          <div className="space-y-1.5">
            {snapshot?.inventory.slice(0, 12).map((entry) => (
              <div
                key={`${entry.storage}:${entry.path}`}
                className="flex items-center gap-2 rounded-[var(--radius-xs)] px-1 py-1"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-accent/70" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">
                  {entry.id}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {formatBytes(entry.size)}
                </span>
              </div>
            ))}
            {(snapshot?.inventory.length ?? 0) > 12 && (
              <p className="pt-1 font-mono text-[10px] text-faint">
                + {(snapshot?.inventory.length ?? 0) - 12} more · use ⌘K to manage
              </p>
            )}
          </div>
        )}
      </section>

      <div className="mt-5 px-3">
        <Badge tone="muted">
          {snapshot === null
            ? "syncing"
            : `updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`}
        </Badge>
      </div>
    </div>
  );
}

function RetentionRow(props: { label: string; count: number; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-2">
      <span className={`size-1.5 rounded-full ${props.count > 0 ? "bg-amber" : "bg-accent"}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-text">{props.label}</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{props.detail}</div>
      </div>
      <span className="font-mono text-[15px] text-accent">{props.count}</span>
    </div>
  );
}
