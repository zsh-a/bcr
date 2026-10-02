import { Button, Dialog, PanelEmpty, Spinner, formatBytes } from "@bcr/react";
import type {
  CleanupState,
  MaintenanceState,
  StorageMaintenanceController,
} from "./useStorageMaintenance";
import { useEffect } from "react";

export function StorageMaintenanceDialogs(props: {
  readonly controller: StorageMaintenanceController;
}) {
  const controller = props.controller;
  const cleanupLocked =
    controller.cleanup.status === "loading" || controller.cleanup.status === "running";
  const maintenanceLocked =
    controller.maintenance.status === "loading" || controller.maintenance.status === "running";

  // 保留原 base-ui 的守卫：扫描/删除进行中时 Esc 不得关闭对话框（其余关闭途径由 onClose 条件挡住）。
  useEffect(() => {
    const onCancel = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLDialogElement)) return;
      const locked =
        (target.classList.contains("studio-cleanup-dialog") && cleanupLocked) ||
        (target.classList.contains("studio-maintenance-dialog") && maintenanceLocked);
      if (locked) event.preventDefault();
    };
    document.addEventListener("cancel", onCancel, true);
    return () => document.removeEventListener("cancel", onCancel, true);
  }, [cleanupLocked, maintenanceLocked]);

  return (
    <>
      <Dialog
        open={controller.cleanup.status !== "idle"}
        onClose={() => {
          if (!cleanupLocked) controller.closeCleanup();
        }}
        title="Artifact 存储清理"
        placement="center"
        className="studio-cleanup-dialog"
      >
        <div className="space-y-4">
          <p className="text-sm leading-5 text-muted">
            仅清理没有血缘记录、也不在当前项目源文件中的产物。执行前会再次校验文件大小。
          </p>
          <CleanupDialogBody
            state={controller.cleanup}
            onCancel={controller.closeCleanup}
            onConfirm={controller.confirmCleanup}
          />
        </div>
      </Dialog>

      <Dialog
        open={controller.maintenance.status !== "idle"}
        onClose={() => {
          if (!maintenanceLocked) controller.closeMaintenance();
        }}
        title="缓存与任务历史整理"
        placement="center"
        className="studio-maintenance-dialog"
      >
        <div className="space-y-4">
          <p className="text-sm leading-5 text-muted">
            默认保留 30 天缓存、90 天任务历史，并限制总条目数；运行中的任务与当前执行 key 始终保留。
          </p>
          <MaintenanceDialogBody
            state={controller.maintenance}
            onCancel={controller.closeMaintenance}
            onConfirm={controller.confirmMaintenance}
          />
        </div>
      </Dialog>
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
      <div className="flex items-center gap-3 py-6 text-sm text-muted">
        <Spinner size="sm" />
        {state.status === "loading" ? "正在扫描本地 Artifact…" : "正在安全删除…"}
      </div>
    );
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} onClose={props.onCancel} />;
  }
  if (state.status === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-accent/25 bg-accent-dim/30 px-3 py-3">
          <div className="text-base text-text">清理完成</div>
          <div className="mt-1 font-mono text-xs text-accent">
            {state.result.deleted.length} objects · {formatBytes(state.result.reclaimedBytes)}{" "}
            reclaimed
          </div>
          {state.result.skipped.length > 0 && (
            <div className="mt-1 text-xs text-amber">
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
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xl leading-none tracking-tight text-text">
            {plan.candidates.length}
          </div>
          <div className="ui-section-label -mx-3">untracked objects</div>
        </div>
        <div className="pb-2 text-right font-mono text-sm text-accent">
          {formatBytes(plan.candidates.reduce((total, entry) => total + entry.size, 0))}
        </div>
      </div>
      <div className="max-h-36 overflow-auto rounded-sm border border-border bg-surface px-3 py-2">
        {plan.candidates.slice(0, 8).map((entry) => (
          <div key={`${entry.storage}:${entry.path}`} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{entry.id}</span>
            <span className="shrink-0 font-mono text-xs text-faint">{formatBytes(entry.size)}</span>
          </div>
        ))}
        {plan.candidates.length > 8 && (
          <div className="pt-1 font-mono text-xs text-faint">
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
      <div className="flex items-center gap-3 py-6 text-sm text-muted">
        <Spinner size="sm" />
        {state.status === "loading" ? "正在扫描缓存与任务历史…" : "正在整理本地元数据…"}
      </div>
    );
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} onClose={props.onCancel} />;
  }
  if (state.status === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-accent/25 bg-accent-dim/30 px-3 py-3">
          <div className="text-base text-text">整理完成</div>
          <div className="mt-1 font-mono text-xs text-accent">
            cache {state.result.cache.removed.length} · history{" "}
            {state.result.journal.removed.length}
          </div>
          {(state.result.cache.skipped.length > 0 || state.result.journal.skipped.length > 0) && (
            <div className="mt-1 text-xs text-amber">
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <RetentionMetric label="cache candidates" value={cacheCandidates.length} />
        <RetentionMetric label="history candidates" value={journalCandidates.length} />
      </div>
      <div className="rounded-sm border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted">
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
      {!props.done && <Button onClick={props.onCancel}>取消</Button>}
      <Button
        variant={props.done === true ? "default" : "danger"}
        onClick={props.done === true ? props.onCancel : props.onConfirm}
      >
        {props.done === true ? "完成" : props.confirmLabel}
      </Button>
    </div>
  );
}

function EmptyState(props: { readonly message: string; readonly onClose: () => void }) {
  return (
    <PanelEmpty title={props.message} action={<Button onClick={props.onClose}>关闭</Button>} />
  );
}

function ErrorState(props: { readonly message: string; readonly onClose: () => void }) {
  return (
    <div className="space-y-4">
      <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
        {props.message}
      </p>
      <div className="flex justify-end">
        <Button onClick={props.onClose}>关闭</Button>
      </div>
    </div>
  );
}

function RetentionMetric(props: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-sm border border-border bg-surface px-3">
      <div className="pt-2 font-mono text-xl tracking-tight text-text">{props.value}</div>
      <div className="ui-section-label -mx-3">{props.label}</div>
    </div>
  );
}
