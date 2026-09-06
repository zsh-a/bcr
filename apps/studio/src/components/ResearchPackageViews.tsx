import type {
  ResearchPackagePlan,
  PreparedResearchPackage,
  PackageReference,
} from "../researchPackage";
import type { ResearchPackageTask } from "../researchPackageTask";
import { hasVolumeOutput, volumeStateLabels, type VolumeTaskStates } from "../researchPackageState";
import {
  groupBooksByVolume,
  sourceStatusLabel,
  sourceStatusCounts,
  type ResearchSourceStatus,
} from "../researchVolumes";
export const packageButton =
  "rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
const button = packageButton;
const referenceStateLabels: Record<PackageReference["state"], string> = {
  ready: "可打包当前版本",
  missing: "来源或章节缺失，无法完整恢复",
  unsupported: "暂不支持此来源类型",
  historical: "仅提供当前资料，旧版本不可保证；回跳时重新核验",
};
export function ResearchPackageResume(props: {
  savedTask: ResearchPackageTask;
  disabled: boolean;
  resumeTask(): void;
  clearTask(): void;
}) {
  const { savedTask, disabled, resumeTask, clearTask } = props;

  return (
    <div aria-label="上次分卷任务" className="my-3 space-y-2 rounded border border-border p-2">
      <p>
        任务 {savedTask.plan.set.slice(0, 12)} · {savedTask.plan.volumes.length} 卷 ·{" "}
        {Object.values(savedTask.states).filter(hasVolumeOutput).length} 卷已有输出记录
      </p>
      <p>继续使用上次检查的集合快照。下载记录不代表文件仍在磁盘上；刷新后需要重新选择保存位置。</p>
      <button type="button" className={button} disabled={disabled} onClick={resumeTask}>
        核验并继续上次任务
      </button>
      <button type="button" className={button} disabled={disabled} onClick={clearTask}>
        清除任务记录
      </button>
    </div>
  );
}
export function ResearchPackageExport(props: {
  plan: ResearchPackagePlan;
  volumeIndex: number;
  setVolumeIndex(index: number): void;
  volumeStates: VolumeTaskStates;
  disabled: boolean;
  canSaveDirectly: boolean;
  saveVolume(): void;
  downloadVolume(): void;
}) {
  const {
    plan,
    volumeIndex,
    setVolumeIndex,
    volumeStates,
    disabled,
    canSaveDirectly,
    saveVolume,
    downloadVolume,
  } = props;
  const booksByVolume = groupBooksByVolume(plan.catalog.books);
  return (
    <div aria-label="资料包导出预览" className="mt-3 space-y-2 border-t border-border pt-2">
      <p>
        {plan.backup.library.collections.length} 个集合 · {plan.books.length} 本 Reader 资料 ·
        预计源文件 {(plan.sourceBytes / 1024 / 1024).toFixed(2)} MiB（不含快照与容器开销）
      </p>
      <p>
        共 {plan.volumes.length} 卷 · 每卷包含完整集合快照（
        {(plan.researchBytes / 1024).toFixed(1)} KiB）。按卷生成并保存后，再生成下一卷。
      </p>
      <label className="flex items-center gap-2">
        选择资料包分卷
        <select
          aria-label="选择资料包分卷"
          className="rounded border border-border bg-surface p-1"
          disabled={disabled}
          value={volumeIndex}
          onChange={(event) => setVolumeIndex(Number(event.target.value))}
        >
          {plan.volumes.map((_, index) => (
            <option key={index} value={index}>
              第 {index + 1}/{plan.volumes.length} 卷
            </option>
          ))}
        </select>
      </label>
      <ul aria-label="资料包分卷清单" className="max-h-48 space-y-2 overflow-auto">
        {plan.volumes.map((volume, index) => (
          <li key={index} className="rounded border border-border p-2">
            第 {index + 1}/{plan.volumes.length} 卷 · {volume.books.length} 本 · 预计{" "}
            {(volume.estimatedBytes / 1024 / 1024).toFixed(2)} MiB ·{" "}
            {volumeStateLabels[volumeStates[index] ?? "pending"]}
            <p>
              源文件 {(volume.sourceBytes / 1024 / 1024).toFixed(2)} MiB · 章节快照{" "}
              {(volume.snapshotBytes / 1024 / 1024).toFixed(2)} MiB
            </p>
            <p>
              {(booksByVolume.get(index + 1) ?? []).map((book) => book.title).join("、") ||
                "仅集合快照"}
            </p>
          </li>
        ))}
      </ul>
      <ul className="max-h-36 space-y-1 overflow-auto">
        {plan.references.map((item, i) => (
          <li key={i}>
            {item.label}：{referenceStateLabels[item.state]}
          </li>
        ))}
      </ul>
      {canSaveDirectly && (
        <button type="button" className={button} disabled={disabled} onClick={saveVolume}>
          直接保存当前卷
        </button>
      )}
      <button type="button" className={button} disabled={disabled} onClick={downloadVolume}>
        生成并下载资料包
      </button>
    </div>
  );
}
export function ResearchPackageRestore(props: {
  prepared: PreparedResearchPackage;
  importSummary: string;
  disabled: boolean;
  restorePackage(): void;
  dismissRestore(): void;
}) {
  const { prepared, importSummary, disabled, restorePackage, dismissRestore } = props;

  return (
    <div aria-label="资料包恢复预览" className="mt-3 space-y-2 border-t border-border pt-2">
      <p>
        {prepared.backup.library.collections.length} 个集合 ·{" "}
        {prepared.reader.manifest.books.length} 本带源文件的 Reader
        资料。先恢复书籍，再合并集合；相同资料包可重复导入，冲突集合保留副本。
      </p>
      {prepared.volume && (
        <p>
          资料包 {prepared.volume.set.slice(0, 12)} · 第 {prepared.volume.index}/
          {prepared.volume.catalog.total} 卷。各卷可独立恢复，支持乱序与重复导入。
        </p>
      )}
      <p>{importSummary}</p>
      <p>已有书籍与笔记不覆盖。非 Reader 来源和未包含的历史版本仍需另行恢复。</p>
      <button type="button" className={button} disabled={disabled} onClick={restorePackage}>
        确认恢复 Reader 资料包
      </button>
      <button type="button" className={button} disabled={disabled} onClick={dismissRestore}>
        取消资料包恢复
      </button>
    </div>
  );
}
export function ResearchPackageSources(props: {
  sourceCatalog: Pick<PreparedResearchPackage, "volume"> | undefined;
  sourceVolume: number;
  setSourceVolume(index: number): void;
  volumeReport: ReadonlyArray<ResearchSourceStatus>;
  disabled: boolean;
  refreshSources(): void;
}) {
  const { sourceCatalog, sourceVolume, setSourceVolume, volumeReport, disabled, refreshSources } =
    props;
  const counts = sourceStatusCounts(volumeReport);
  const visibleSources = volumeReport.filter(
    (book) => !sourceVolume || book.volume === sourceVolume,
  );
  return (
    <>
      {sourceCatalog?.volume && (
        <div className="mt-3 space-y-2" aria-label="资料来源汇总">
          <p>
            资料包 {sourceCatalog.volume.set.slice(0, 12)} · {sourceCatalog.volume.catalog.total} 卷
          </p>
          {volumeReport.length !== sourceCatalog.volume.catalog.books.length ? (
            <p>尚未核验。点击「重新核验来源状态」检查文件是否仍然可用。</p>
          ) : (
            <p>
              已恢复 {counts.restored} · 缺失 {counts.missing} · 需修复 {counts.repair}
            </p>
          )}
          <label>
            按卷查看来源{" "}
            <select
              aria-label="按卷查看来源"
              className="rounded border border-border bg-surface p-1"
              value={sourceVolume}
              onChange={(event) => setSourceVolume(Number(event.target.value))}
            >
              <option value={0}>全部分卷</option>
              {Array.from({ length: sourceCatalog.volume.catalog.total }, (_, index) => (
                <option key={index} value={index + 1}>
                  第 {index + 1} 卷
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={button} disabled={disabled} onClick={refreshSources}>
            重新核验来源状态
          </button>
        </div>
      )}
      {volumeReport.length > 0 && (
        <ul aria-label="分卷来源恢复状态" className="mt-3 max-h-40 space-y-1 overflow-auto">
          {visibleSources.map((book) => (
            <li key={book.book}>
              {book.title} · {sourceStatusLabel(book)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
