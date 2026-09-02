import { Dialog } from "@base-ui/react/dialog";
import type {
  ArtifactCleanupPlan,
  ArtifactCleanupResult,
  CachePrunePlan,
  CachePruneResult,
  TaskJournalPrunePlan,
  TaskJournalPruneResult,
} from "@bcr/core";
import { Effect } from "effect";
import { useNavigate } from "@tanstack/react-router";
import {
  AudioWaveform,
  BookOpenText,
  ChartCandlestick,
  Eraser,
  FilePlus2,
  FileStack,
  Globe2,
  Hash,
  House,
  LayoutGrid,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { resetLayout } from "./Dock";
import { importFile, runTask } from "../runtime";
import { useSelection } from "../router";
import { useServices } from "../services";
import { studio, useStudio } from "../store";
import { CACHE_RETENTION, JOURNAL_RETENTION } from "../storage-policy";
import { formatBytes } from "./ui";

interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly icon: React.ReactNode;
  readonly run: () => void;
}

type CleanupState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly plan: ArtifactCleanupPlan }
  | { readonly status: "running"; readonly plan: ArtifactCleanupPlan }
  | { readonly status: "done"; readonly result: ArtifactCleanupResult }
  | { readonly status: "error"; readonly message: string };

interface MaintenancePlan {
  readonly cache: CachePrunePlan;
  readonly journal: TaskJournalPrunePlan;
}

interface MaintenanceResult {
  readonly cache: CachePruneResult;
  readonly journal: TaskJournalPruneResult;
}

type MaintenanceState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly plan: MaintenancePlan }
  | { readonly status: "running"; readonly plan: MaintenancePlan }
  | { readonly status: "done"; readonly result: MaintenanceResult }
  | { readonly status: "error"; readonly message: string };

/** 命令面板（Base UI Dialog + ⌘K）。 */
export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const services = useServices();
  const selection = useSelection();
  const navigate = useNavigate();
  const currentFile = useStudio((s) => s.files.find((f) => f.ref.id === selection.file));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [cleanup, setCleanup] = useState<CleanupState>({ status: "idle" });
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ status: "idle" });

  const startCleanup = useCallback(() => {
    setCleanup({ status: "loading" });
    const protectedIds = studio.getSnapshot().files.map(({ ref }) => ref.id);
    void Effect.runPromise(services.artifacts.planCleanup({ protectedIds })).then(
      (plan) => {
        studio.log(
          "info",
          `cleanup · scanned ${plan.scannedObjects} artifact(s) · ${plan.candidates.length} candidate(s)`,
        );
        setCleanup({ status: "ready", plan });
      },
      (reason: unknown) =>
        setCleanup({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        }),
    );
  }, [services]);

  const confirmCleanup = useCallback(() => {
    if (cleanup.status !== "ready") return;
    const plan = cleanup.plan;
    setCleanup({ status: "running", plan });
    const protectedIds = studio.getSnapshot().files.map(({ ref }) => ref.id);
    void Effect.runPromise(services.artifacts.reclaim(plan, { protectedIds })).then(
      (result) => {
        studio.log(
          "ok",
          `cleanup · reclaimed ${formatBytes(result.reclaimedBytes)} · ${result.deleted.length} artifact(s)`,
        );
        if (result.skipped.length > 0) {
          studio.log(
            "warn",
            `cleanup · skipped ${result.skipped.length} stale or protected item(s)`,
          );
        }
        setCleanup({ status: "done", result });
      },
      (reason: unknown) =>
        setCleanup({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        }),
    );
  }, [cleanup, services]);

  const startMaintenance = useCallback(() => {
    setMaintenance({ status: "loading" });
    void Promise.all([
      Effect.runPromise(services.scheduler.planCachePrune(CACHE_RETENTION)),
      Effect.runPromise(services.scheduler.planJournalPrune(JOURNAL_RETENTION)),
    ]).then(
      ([cache, journal]) => {
        studio.log(
          "info",
          `maintenance · scanned ${cache.scannedEntries} cache + ${journal.scannedEntries} history · ${cache.candidates.length + journal.candidates.length} candidate(s)`,
        );
        setMaintenance({ status: "ready", plan: { cache, journal } });
      },
      (reason: unknown) =>
        setMaintenance({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        }),
    );
  }, [services]);

  const confirmMaintenance = useCallback(() => {
    if (maintenance.status !== "ready") return;
    const plan = maintenance.plan;
    setMaintenance({ status: "running", plan });
    void Promise.all([
      Effect.runPromise(services.scheduler.reclaimCache(plan.cache)),
      Effect.runPromise(services.scheduler.reclaimJournal(plan.journal)),
    ]).then(
      ([cache, journal]) => {
        studio.log(
          "ok",
          `maintenance · removed ${cache.removed.length} cache + ${journal.removed.length} history item(s)`,
        );
        if (cache.skipped.length + journal.skipped.length > 0) {
          studio.log(
            "warn",
            `maintenance · skipped ${cache.skipped.length + journal.skipped.length} changed or protected item(s)`,
          );
        }
        setMaintenance({ status: "done", result: { cache, journal } });
      },
      (reason: unknown) =>
        setMaintenance({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        }),
    );
  }, [maintenance, services]);

  const commands = useMemo<ReadonlyArray<Command>>(
    () => [
      {
        id: "go-home",
        title: "返回主页",
        hint: "Alt+0",
        icon: <House className="size-3.5" />,
        run: () => void navigate({ to: "/" }),
      },
      {
        id: "go-studio",
        title: "打开 Studio 工作台",
        hint: "Alt+1",
        icon: <LayoutGrid className="size-3.5" />,
        run: () => void navigate({ to: "/studio" }),
      },
      {
        id: "go-media",
        title: "打开 Media Studio",
        hint: "Alt+2",
        icon: <AudioWaveform className="size-3.5" />,
        run: () => void navigate({ to: "/media" }),
      },
      {
        id: "go-quant",
        title: "打开 Quant Lab",
        hint: "Alt+3",
        icon: <ChartCandlestick className="size-3.5" />,
        run: () => void navigate({ to: "/quant" }),
      },
      {
        id: "go-markets",
        title: "打开 Market Atlas",
        hint: "Alt+4",
        icon: <Globe2 className="size-3.5" />,
        run: () => void navigate({ to: "/markets" }),
      },
      {
        id: "go-manga",
        title: "打开 Manga Studio",
        hint: "Alt+5",
        icon: <BookOpenText className="size-3.5" />,
        run: () => void navigate({ to: "/manga" }),
      },
      {
        id: "go-documents",
        title: "打开 Document Studio",
        hint: "Alt+6",
        icon: <FileStack className="size-3.5" />,
        run: () => void navigate({ to: "/documents" }),
      },
      {
        id: "import",
        title: "导入文件…",
        hint: "写入 OPFS",
        icon: <FilePlus2 className="size-3.5" />,
        run: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.onchange = () => {
            const file = input.files?.[0];
            if (file !== undefined) {
              void importFile(services, file).then((ref) => selection.select({ file: ref.id }));
            }
          };
          input.click();
        },
      },
      {
        id: "blake3",
        title: "运行 hash.blake3",
        hint: currentFile?.name ?? "未选择文件",
        icon: <Hash className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "hash.blake3", currentFile.size);
          }
        },
      },
      {
        id: "waveform",
        title: "运行 audio.waveform",
        hint: currentFile?.name ?? "未选择文件",
        icon: <AudioWaveform className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "audio.waveform", currentFile.size);
          }
        },
      },
      {
        id: "cleanup-artifacts",
        title: "清理未追踪 Artifact",
        hint: "预览后确认",
        icon: <Trash2 className="size-3.5" />,
        run: startCleanup,
      },
      {
        id: "maintenance-retention",
        title: "整理过期缓存与历史",
        hint: "30d cache · 90d history",
        icon: <Eraser className="size-3.5" />,
        run: startMaintenance,
      },
      {
        id: "clear-console",
        title: "清空控制台",
        icon: <Eraser className="size-3.5" />,
        run: () => studio.clearLogs(),
      },
      {
        id: "reset-layout",
        title: "重置工作台布局",
        hint: "清除布局缓存并刷新",
        icon: <LayoutGrid className="size-3.5" />,
        run: resetLayout,
      },
    ],
    [services, selection, currentFile, navigate, startCleanup, startMaintenance],
  );

  const filtered = commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));

  const close = () => props.onOpenChange(false);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      filtered[active]?.run();
      close();
    }
  };

  return (
    <>
      <Dialog.Root
        open={props.open}
        onOpenChange={(open) => {
          props.onOpenChange(open);
          if (open) {
            setQuery("");
            setActive(0);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
          <Dialog.Popup className="fixed top-[18%] left-1/2 z-50 w-105 -translate-x-1/2 overflow-hidden rounded-[var(--radius-md)] border border-border-strong bg-raised shadow-2xl shadow-black/60 outline-none studio-enter">
            <Dialog.Title className="sr-only">命令面板</Dialog.Title>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search className="size-3.5 text-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="输入命令…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-faint"
              />
              <kbd className="rounded-[var(--radius-xs)] border border-border px-1 font-mono text-[10px] text-faint">
                esc
              </kbd>
            </div>
            <div className="max-h-64 overflow-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-[11px] text-faint">无匹配命令</p>
              )}
              {filtered.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    command.run();
                    close();
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    index === active ? "bg-accent-dim/50 text-text" : "text-muted"
                  }`}
                >
                  <span className="text-faint">{command.icon}</span>
                  <span className="flex-1">{command.title}</span>
                  {command.hint !== undefined && (
                    <span className="font-mono text-[10px] text-faint">{command.hint}</span>
                  )}
                </button>
              ))}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={cleanup.status !== "idle"}
        onOpenChange={(open) => {
          if (!open && cleanup.status !== "running" && cleanup.status !== "loading") {
            setCleanup({ status: "idle" });
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[3px]" />
          <Dialog.Popup className="fixed top-[20%] left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-md)] border border-border-strong bg-raised shadow-2xl shadow-black/60 outline-none studio-enter">
            <div className="border-b border-border px-5 py-4">
              <Dialog.Title className="text-[15px] font-medium text-text">
                Artifact 存储清理
              </Dialog.Title>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                仅清理没有血缘记录、也不在当前项目源文件中的产物。执行前会再次校验文件大小。
              </p>
            </div>
            <CleanupDialogBody
              state={cleanup}
              onCancel={() => setCleanup({ status: "idle" })}
              onConfirm={confirmCleanup}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={maintenance.status !== "idle"}
        onOpenChange={(open) => {
          if (!open && maintenance.status !== "running" && maintenance.status !== "loading") {
            setMaintenance({ status: "idle" });
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[3px]" />
          <Dialog.Popup className="fixed top-[20%] left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-md)] border border-border-strong bg-raised shadow-2xl shadow-black/60 outline-none studio-enter">
            <div className="border-b border-border px-5 py-4">
              <Dialog.Title className="text-[15px] font-medium text-text">
                缓存与任务历史整理
              </Dialog.Title>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                默认保留 30 天缓存、90 天任务历史，并限制总条目数；运行中的任务与当前执行 key
                始终保留。
              </p>
            </div>
            <MaintenanceDialogBody
              state={maintenance}
              onCancel={() => setMaintenance({ status: "idle" })}
              onConfirm={confirmMaintenance}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function CleanupDialogBody(props: {
  state: CleanupState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { state } = props;
  if (state.status === "loading" || state.status === "running") {
    return (
      <div className="flex items-center gap-3 px-5 py-8 text-[12px] text-muted">
        <span className="size-2 animate-pulse rounded-full bg-accent" />
        {state.status === "loading" ? "正在扫描本地 Artifact…" : "正在安全删除…"}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-4 px-5 py-5">
        <p className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[11px] text-danger">
          {state.message}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className="space-y-4 px-5 py-5">
        <div className="rounded-[var(--radius-sm)] border border-accent/25 bg-accent-dim/30 px-3 py-3">
          <div className="text-[13px] text-text">清理完成</div>
          <div className="mt-1 font-mono text-[11px] text-accent">
            {state.result.deleted.length} objects · {formatBytes(state.result.reclaimedBytes)}{" "}
            reclaimed
          </div>
          {state.result.skipped.length > 0 && (
            <div className="mt-1 text-[11px] text-amber">
              {state.result.skipped.length} 个对象因变化或保护规则被跳过
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-medium text-[#06251b] hover:brightness-110"
          >
            完成
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "idle") return null;

  const plan = state.plan;
  if (plan.candidates.length === 0) {
    return (
      <div className="space-y-4 px-5 py-5">
        <p className="text-[12px] text-muted">当前没有符合条件的未追踪 Artifact。</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4 px-5 py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[22px] tracking-[-0.04em] text-text">
            {plan.candidates.length}
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
            untracked objects
          </div>
        </div>
        <div className="text-right font-mono text-[12px] text-accent">
          {formatBytes(plan.candidates.reduce((total, entry) => total + entry.size, 0))}
        </div>
      </div>
      <div className="max-h-36 overflow-auto rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2">
        {plan.candidates.slice(0, 8).map((entry) => (
          <div key={`${entry.storage}:${entry.path}`} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">
              {entry.id}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-faint">
              {formatBytes(entry.size)}
            </span>
          </div>
        ))}
        {plan.candidates.length > 8 && (
          <div className="pt-1 font-mono text-[10px] text-faint">
            + {plan.candidates.length - 8} more
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
        >
          取消
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          className="h-9 rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-medium text-[#06251b] hover:brightness-110"
        >
          清理这些对象
        </button>
      </div>
    </div>
  );
}

function MaintenanceDialogBody(props: {
  state: MaintenanceState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { state } = props;
  if (state.status === "loading" || state.status === "running") {
    return (
      <div className="flex items-center gap-3 px-5 py-8 text-[12px] text-muted">
        <span className="size-2 animate-pulse rounded-full bg-accent" />
        {state.status === "loading" ? "正在扫描缓存与任务历史…" : "正在整理本地元数据…"}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-4 px-5 py-5">
        <p className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[11px] text-danger">
          {state.message}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className="space-y-4 px-5 py-5">
        <div className="rounded-[var(--radius-sm)] border border-accent/25 bg-accent-dim/30 px-3 py-3">
          <div className="text-[13px] text-text">整理完成</div>
          <div className="mt-1 font-mono text-[11px] text-accent">
            cache {state.result.cache.removed.length} · history{" "}
            {state.result.journal.removed.length}
          </div>
          {(state.result.cache.skipped.length > 0 || state.result.journal.skipped.length > 0) && (
            <div className="mt-1 text-[11px] text-amber">
              {state.result.cache.skipped.length + state.result.journal.skipped.length}{" "}
              个对象因变化、保护或正在运行被跳过
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-medium text-[#06251b] hover:brightness-110"
          >
            完成
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "idle") return null;

  const cacheCandidates = state.plan.cache.candidates;
  const journalCandidates = state.plan.journal.candidates;
  const total = cacheCandidates.length + journalCandidates.length;
  if (total === 0) {
    return (
      <div className="space-y-4 px-5 py-5">
        <p className="text-[12px] text-muted">当前没有需要整理的缓存或任务历史。</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4 px-5 py-5">
      <div className="grid grid-cols-2 gap-2">
        <RetentionMetric label="cache candidates" value={cacheCandidates.length} />
        <RetentionMetric label="history candidates" value={journalCandidates.length} />
      </div>
      <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[11px] leading-5 text-muted">
        共发现 <span className="font-mono text-accent">{total}</span>{" "}
        个可整理条目。缓存清理只删除索引元数据， 不会删除 Artifact 内容；任务历史只包含已结束记录。
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
        >
          取消
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          className="h-9 rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-medium text-[#06251b] hover:brightness-110"
        >
          整理这些条目
        </button>
      </div>
    </div>
  );
}

function RetentionMetric(props: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2">
      <div className="font-mono text-[20px] tracking-[-0.04em] text-text">{props.value}</div>
      <div className="font-mono text-[10px] tracking-[0.06em] text-faint uppercase">
        {props.label}
      </div>
    </div>
  );
}
