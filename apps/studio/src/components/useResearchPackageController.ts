import {
  openPackageDestination,
  downloadPackage,
  canSavePackageDirectly,
} from "../researchPackageFiles";
import { verifyPackageTask } from "../researchPackageTask";
import { writeResearchPackage } from "../researchPackageStream";
import { verifyRecoveryPackage } from "../researchPackageRecovery";
import { useResearchPackageRecovery } from "./useResearchPackageRecovery";
import { useEffect, useRef, useState } from "react";
import type { ResearchLibrary, ResearchStore } from "../research";
import {
  PACKAGE_LIMIT,
  researchVolumeStatus,
  previewResearchPackageImport,
  planResearchPackage,
  createResearchPackage,
  inspectResearchPackage,
  type ResearchPackagePlan,
  type PreparedResearchPackage,
} from "../researchPackage";
import { useResearchPackageRecords } from "./useResearchPackageRecords";
import { useResearchPackageAction } from "./useResearchPackageAction";
import {
  nextPendingVolume,
  type VolumeTaskState,
  type VolumeTaskStates,
} from "../researchPackageState";
export interface ResearchPackagePanelProps {
  readonly library: ResearchLibrary;
  readonly store: ResearchStore;
  readonly busy: boolean;
  readonly run: (action: () => Promise<void>) => void;
}
export function useResearchPackageController(props: ResearchPackagePanelProps) {
  const recovery = useResearchPackageRecovery(props.store);
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState(false);
  const [plan, setPlan] = useState<ResearchPackagePlan>();
  const [prepared, publishPrepared] = useState<PreparedResearchPackage>();
  const ownedPrepared = useRef<PreparedResearchPackage | undefined>(undefined);
  const setPrepared = (next: PreparedResearchPackage | undefined) => {
    if (ownedPrepared.current !== next)
      void ownedPrepared.current?.dispose?.().catch(() => undefined);
    ownedPrepared.current = next;
    publishPrepared(next);
  };
  useEffect(
    () => () => {
      void ownedPrepared.current?.dispose?.().catch(() => undefined);
      ownedPrepared.current = undefined;
    },
    [],
  );
  const [volumeBytes, setVolumeBytes] = useState(128 * 1024 * 1024);
  const [volumeIndex, setVolumeIndex] = useState(0);
  const [volumeStates, setVolumeStates] = useState<VolumeTaskStates>({});
  const [sourceVolume, setSourceVolume] = useState(0);
  const [volumeReport, setVolumeReport] = useState<
    Awaited<ReturnType<typeof researchVolumeStatus>>
  >([]);
  const [importSummary, setImportSummary] = useState("");
  const generating = useRef<number | null>(null);
  const {
    savedTask,
    setSavedTask,
    taskReady,
    taskNotice,
    setTaskNotice,
    sourceCatalog,
    setSourceCatalog,
  } = useResearchPackageRecords(props.store, plan, volumeStates, volumeBytes, drafts);
  function markGeneration(state: VolumeTaskState) {
    const index = generating.current;
    if (index !== null) setVolumeStates((states) => ({ ...states, [index]: state }));
  }
  const { action, cancel, working, message, setMessage } = useResearchPackageAction(
    props.busy || !taskReady,
    {
      onFailure: () => markGeneration("failed"),
      onCancel: () => {
        markGeneration("cancelled");
        generating.current = null;
      },
      onFinish: () => {
        generating.current = null;
      },
    },
  );
  const disabled = props.busy || working || !taskReady || !recovery.ready;
  const resumeTask = () => {
    if (!savedTask) return;
    action(async (signal, report) => {
      await verifyPackageTask(savedTask, report, signal);
      return () => {
        setPlan(savedTask.plan);
        setVolumeStates({ ...savedTask.states });
        setVolumeBytes(savedTask.volumeBytes);
        setDrafts(savedTask.drafts);
        setSelected(savedTask.plan.backup.library.collections.map((collection) => collection.id));
        setVolumeIndex(nextPendingVolume(savedTask.states, savedTask.plan.volumes.length));
        setMessage("来源核验通过，可以继续上次分卷任务。");
      };
    });
  };
  const clearTask = () => {
    action(async () => {
      await props.store.writePackageRecord("export", "");
      return () => {
        setSavedTask(undefined);
        setTaskNotice("分卷任务记录已清除，已保存文件不受影响。");
      };
    });
  };
  const changeSelection = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id),
    );
    setPlan(undefined);
  };
  const changeDrafts = (value: boolean) => {
    setDrafts(value);
    setPlan(undefined);
  };
  const changeVolumeBytes = (value: number) => {
    setVolumeBytes(value);
    setPlan(undefined);
  };
  const checkPackage = () => {
    action(async (signal, report) => {
      setPrepared(undefined);
      setPlan(undefined);
      const checked = await planResearchPackage(
        {
          ...props.library,
          collections: props.library.collections.filter((item) => selected.includes(item.id)),
        },
        drafts,
        report,
        signal,
        volumeBytes,
      );
      return () => {
        setPlan(checked);
        setVolumeIndex(0);
        setVolumeStates({});
        setVolumeReport([]);
        setMessage("");
      };
    });
  };
  const saveVolume = () => {
    if (!plan) return;
    action(async (signal, report) => {
      const destination = await openPackageDestination(plan, volumeIndex, signal);
      if (signal.aborted) {
        await destination.abort(signal.reason);
        signal.throwIfAborted();
      }
      generating.current = volumeIndex;
      setVolumeStates((states) => ({ ...states, [volumeIndex]: "saving" }));
      await writeResearchPackage(plan, destination, report, signal, volumeIndex);
      return () => {
        setVolumeStates((states) => ({ ...states, [volumeIndex]: "saved" }));
        setMessage(`Reader 资料包第 ${volumeIndex + 1}/${plan.volumes.length} 卷已保存。`);
      };
    });
  };
  const downloadVolume = () => {
    if (!plan) return;
    action(async (signal, report) => {
      generating.current = volumeIndex;
      setVolumeStates((states) => ({ ...states, [volumeIndex]: "generating" }));
      const blob = await createResearchPackage(plan, report, signal, volumeIndex);
      return () => {
        downloadPackage(blob, plan, volumeIndex);
        setVolumeStates((states) => ({
          ...states,
          [volumeIndex]: "downloaded",
        }));
        setMessage(
          `Reader 资料包第 ${volumeIndex + 1}/${plan.volumes.length} 卷已生成，请保存下载文件。`,
        );
      };
    });
  };
  const finishRecovery = (file?: PreparedResearchPackage) => {
    props.run(async () => {
      const result = await recovery.resume(setMessage, file);
      if (!recovery.isCurrent()) return;
      setPrepared(undefined);
      setImportSummary("");
      setVolumeReport([]);
      const catalog = file ?? sourceCatalog;
      try {
        const statuses = catalog ? await researchVolumeStatus(catalog) : [];
        if (!recovery.isCurrent()) return;
        setVolumeReport(statuses);
        setMessage(
          result === "restored"
            ? "Reader 资料包恢复完成，可从集合回到原文。未包含的来源仍待恢复。"
            : "恢复任务记录已完成，后续修改保持不变。",
        );
      } catch (error) {
        if (recovery.isCurrent())
          setMessage(`恢复任务已完成，来源状态刷新失败，可手动重新核验：${String(error)}`);
      }
    });
  };
  const restorePackage = () => {
    if (prepared) finishRecovery(prepared);
  };
  const dismissRestore = () => {
    setPrepared(undefined);
  };
  const refreshSources = () => {
    if (!sourceCatalog) return;
    action(async (signal, report) => {
      const statuses = await researchVolumeStatus(sourceCatalog, report, signal);
      return () => {
        setVolumeReport(statuses);
        setMessage("来源状态已重新核验，需修复的来源可重新选择所属分卷恢复。");
      };
    });
  };
  const inspectFile = (file: File) => {
    setPlan(undefined);
    setPrepared(undefined);
    action(async (signal, report) => {
      if (file.size > PACKAGE_LIMIT + 65536) throw new Error("资料包超过 600 MiB 上限");
      const checked = await inspectResearchPackage(file, report, signal);
      const discard = () => {
        void checked.dispose?.().catch(() => undefined);
      };
      signal.addEventListener("abort", discard, { once: true });
      try {
        signal.throwIfAborted();
        await verifyRecoveryPackage(props.store, checked);
        signal.throwIfAborted();
        const preview = await previewResearchPackageImport(checked, props.library);
        const statuses = await researchVolumeStatus(checked, report, signal);
        signal.throwIfAborted();
        await props.store.writePackageRecord(
          "restore",
          checked.volume ? JSON.stringify({ volume: checked.volume }) : "",
        );
        return () => {
          signal.removeEventListener("abort", discard);
          setImportSummary(
            `书籍：新增 ${preview.books.added}，复用 ${preview.books.reused}；集合：新增 ${preview.collections.added}，跳过 ${preview.collections.skipped}，冲突副本 ${preview.collections.copies}`,
          );
          setPrepared(checked);
          setSourceCatalog(checked.volume ? { volume: checked.volume } : undefined);
          setSourceVolume(0);
          setVolumeReport(statuses);
          setMessage("文件哈希与 Reader 源文件校验通过，请确认恢复。");
        };
      } catch (error) {
        signal.removeEventListener("abort", discard);
        await checked.dispose?.().catch(() => undefined);
        throw error;
      }
    });
  };
  return {
    recovery,
    resumeRecovery: () => finishRecovery(),
    clearRecovery: () => props.run(() => recovery.clear()),
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
    canSaveDirectly: canSavePackageDirectly(),
  };
}
export type ResearchPackageController = ReturnType<typeof useResearchPackageController>;
