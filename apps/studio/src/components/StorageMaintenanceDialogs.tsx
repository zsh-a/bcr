import { Dialog } from "@base-ui/react/dialog";
import type {
  CleanupState,
  MaintenanceState,
  StorageMaintenanceController,
} from "./useStorageMaintenance";
import { formatBytes } from "./ui";

export function StorageMaintenanceDialogs(props: {
  readonly controller: StorageMaintenanceController;
}) {
  const controller = props.controller;
  return (
    <>
      <Dialog.Root
        open={controller.cleanup.status !== "idle"}
        onOpenChange={(open) => {
          if (
            !open &&
            controller.cleanup.status !== "running" &&
            controller.cleanup.status !== "loading"
          ) {
            controller.closeCleanup();
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
              state={controller.cleanup}
              onCancel={controller.closeCleanup}
              onConfirm={controller.confirmCleanup}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={controller.maintenance.status !== "idle"}
        onOpenChange={(open) => {
          if (
            !open &&
            controller.maintenance.status !== "running" &&
            controller.maintenance.status !== "loading"
          ) {
            controller.closeMaintenance();
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
              state={controller.maintenance}
              onCancel={controller.closeMaintenance}
              onConfirm={controller.confirmMaintenance}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function CleanupDialogBody(props: {
  readonly state: CleanupState;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
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
    return <ErrorState message={state.message} onClose={props.onCancel} />;
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
        <DialogActions onCancel={props.onCancel} done />
      </div>
    );
  }
  if (state.status === "idle") return null;

  const plan = state.plan;
  if (plan.candidates.length === 0) {
    return <EmptyState message="当前没有符合条件的未追踪 Artifact。" onClose={props.onCancel} />;
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
      <DialogActions
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
        confirmLabel="清理这些对象"
      />
    </div>
  );
}

function MaintenanceDialogBody(props: {
  readonly state: MaintenanceState;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
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
    return <ErrorState message={state.message} onClose={props.onCancel} />;
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
        <DialogActions onCancel={props.onCancel} done />
      </div>
    );
  }
  if (state.status === "idle") return null;

  const cacheCandidates = state.plan.cache.candidates;
  const journalCandidates = state.plan.journal.candidates;
  const total = cacheCandidates.length + journalCandidates.length;
  if (total === 0) {
    return <EmptyState message="当前没有需要整理的缓存或任务历史。" onClose={props.onCancel} />;
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
      <DialogActions
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
        confirmLabel="整理这些条目"
      />
    </div>
  );
}

function DialogActions(props: {
  readonly onCancel: () => void;
  readonly onConfirm?: () => void;
  readonly confirmLabel?: string;
  readonly done?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      {!props.done && (
        <button
          type="button"
          onClick={props.onCancel}
          className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
        >
          取消
        </button>
      )}
      <button
        type="button"
        onClick={props.done ? props.onCancel : props.onConfirm}
        className="h-9 rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-medium text-[#06251b] hover:brightness-110"
      >
        {props.done ? "完成" : props.confirmLabel}
      </button>
    </div>
  );
}

function EmptyState(props: { readonly message: string; readonly onClose: () => void }) {
  return (
    <div className="space-y-4 px-5 py-5">
      <p className="text-[12px] text-muted">{props.message}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={props.onClose}
          className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
        >
          关闭
        </button>
      </div>
    </div>
  );
}

function ErrorState(props: { readonly message: string; readonly onClose: () => void }) {
  return (
    <div className="space-y-4 px-5 py-5">
      <p className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[11px] text-danger">
        {props.message}
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={props.onClose}
          className="h-9 rounded-[var(--radius-sm)] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-text"
        >
          关闭
        </button>
      </div>
    </div>
  );
}

function RetentionMetric(props: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2">
      <div className="font-mono text-[20px] tracking-[-0.04em] text-text">{props.value}</div>
      <div className="font-mono text-[10px] tracking-[0.06em] text-faint uppercase">
        {props.label}
      </div>
    </div>
  );
}
