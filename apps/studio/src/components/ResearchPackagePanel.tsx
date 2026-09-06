import {
  useResearchPackageController,
  type ResearchPackagePanelProps,
} from "./useResearchPackageController";
import {
  ResearchPackageResume,
  ResearchPackageExport,
  ResearchPackageRestore,
  ResearchPackageSources,
  packageButton as button,
} from "./ResearchPackageViews";
export function ResearchPackagePanel(props: ResearchPackagePanelProps) {
  const controller = useResearchPackageController(props);
  const {
    selected,
    changeSelection,
    drafts,
    changeDrafts,
    plan,
    prepared,
    volumeBytes,
    changeVolumeBytes,
    volumeIndex,
    setVolumeIndex,
    volumeStates,
    savedTask,
    taskNotice,
    sourceCatalog,
    sourceVolume,
    setSourceVolume,
    volumeReport,
    importSummary,
    working,
    message,
    disabled,
    cancel,
    resumeTask,
    clearTask,
    checkPackage,
    saveVolume,
    downloadVolume,
    restorePackage,
    dismissRestore,
    refreshSources,
    inspectFile,
    canSaveDirectly,
  } = controller;
  return (
    <details className="my-2 rounded border border-border p-3 text-[11px] text-muted">
      <summary className="cursor-pointer text-text">Reader 完整资料包</summary>
      <p className="my-2 leading-5">
        包含所选集合及关联的 Reader 源文件、章节快照。请先
        <a className="text-accent underline" href="/reader">
          打开 Reader
        </a>
        并等待书库加载。其它类型和无法提供的历史版本会在预览中标明。
      </p>
      {savedTask && !plan && (
        <ResearchPackageResume
          savedTask={savedTask}
          disabled={disabled}
          resumeTask={resumeTask}
          clearTask={clearTask}
        />
      )}
      {taskNotice && (
        <p aria-label="分卷任务保存状态" className="my-2 leading-5">
          {taskNotice}
        </p>
      )}
      <div className="max-h-32 space-y-1 overflow-auto">
        {props.library.collections.map((item) => (
          <label key={item.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`打包集合：${item.name}`}
              checked={selected.includes(item.id)}
              disabled={disabled}
              onChange={(event) => changeSelection(item.id, event.target.checked)}
            />
            {item.name} · {item.excerpts.length} 条摘录
          </label>
        ))}
      </div>
      <label className="my-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={drafts}
          disabled={disabled}
          onChange={(event) => changeDrafts(event.target.checked)}
        />
        资料包包含草稿
      </label>
      <label className="my-2 flex items-center gap-2">
        单卷源文件上限
        <select
          aria-label="单卷源文件上限"
          className="rounded border border-border bg-surface p-1"
          disabled={disabled}
          value={volumeBytes}
          onChange={(event) => changeVolumeBytes(Number(event.target.value))}
        >
          {[1, 32, 128, 256, 512].map((size) => (
            <option key={size} value={size * 1024 * 1024}>
              {size} MiB
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={disabled || !selected.length}
          onClick={checkPackage}
        >
          检查资料包
        </button>
        <label>
          选择 Reader 资料包
          <input
            aria-label="选择 Reader 资料包"
            type="file"
            accept=".zip,application/zip"
            disabled={disabled}
            className="mt-1 block max-w-full"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) inspectFile(file);
            }}
          />
        </label>
      </div>
      {working && (
        <div className="mt-3 flex items-center gap-3" aria-label="资料包任务进度">
          <progress aria-label="资料包处理进度" className="h-1 flex-1 accent-accent" />
          <button type="button" className={button} onClick={cancel}>
            取消资料包操作
          </button>
        </div>
      )}
      {plan && (
        <ResearchPackageExport
          plan={plan}
          volumeIndex={volumeIndex}
          setVolumeIndex={setVolumeIndex}
          volumeStates={volumeStates}
          disabled={disabled}
          canSaveDirectly={canSaveDirectly}
          saveVolume={saveVolume}
          downloadVolume={downloadVolume}
        />
      )}
      {prepared && (
        <ResearchPackageRestore
          prepared={prepared}
          importSummary={importSummary}
          disabled={disabled}
          restorePackage={restorePackage}
          dismissRestore={dismissRestore}
        />
      )}
      <ResearchPackageSources
        sourceCatalog={sourceCatalog}
        sourceVolume={sourceVolume}
        setSourceVolume={setSourceVolume}
        volumeReport={volumeReport}
        disabled={disabled}
        refreshSources={refreshSources}
      />
      {message && (
        <p role="status" className="mt-2 whitespace-pre-wrap leading-5">
          {message}
        </p>
      )}
    </details>
  );
}
