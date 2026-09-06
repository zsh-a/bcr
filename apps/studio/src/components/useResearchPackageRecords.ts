import { useEffect, useState } from "react";
import { textVersion } from "@bcr/core";
import { decodeVolumeCatalog } from "../researchVolumes";
import { decodePackageTask, type ResearchPackageTask } from "../researchPackageTask";
import type { VolumeTaskStates } from "../researchPackageState";
import type { ResearchStore } from "../research";
import type { ResearchPackagePlan, PreparedResearchPackage } from "../researchPackage";
export function useResearchPackageRecords(
  store: ResearchStore,
  plan: ResearchPackagePlan | undefined,
  volumeStates: VolumeTaskStates,
  volumeBytes: number,
  drafts: boolean,
) {
  const [savedTask, setSavedTask] = useState<ResearchPackageTask>();
  const [taskReady, setTaskReady] = useState(false);
  const [taskNotice, setTaskNotice] = useState("");
  const [sourceCatalog, setSourceCatalog] = useState<Pick<PreparedResearchPackage, "volume">>();
  useEffect(() => {
    let mounted = true;
    void Promise.all([store.readPackageRecord("export"), store.readPackageRecord("restore")])
      .then(([raw, sources]) => {
        if (!mounted) return;
        try {
          setSavedTask(decodePackageTask(raw));
        } catch (error) {
          setTaskNotice(`任务记录无法读取：${String(error)}`);
        }
        if (sources) {
          const record = JSON.parse(sources) as Pick<PreparedResearchPackage, "volume">;
          if (
            !record.volume ||
            textVersion(JSON.stringify(decodeVolumeCatalog(record.volume.catalog))) !==
              record.volume.set
          )
            throw new Error("恢复目录校验失败");
          setSourceCatalog(record);
        }
      })
      .catch((error: unknown) => {
        if (mounted) setTaskNotice(String(error));
      })
      .finally(() => {
        if (mounted) setTaskReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [store]);
  useEffect(() => {
    if (!plan || !taskReady) return;
    let current = true;
    const task: ResearchPackageTask = {
      version: 2,
      plan,
      states: volumeStates,
      volumeBytes,
      drafts,
    };
    const raw = JSON.stringify(task);
    try {
      decodePackageTask(raw);
    } catch (error) {
      setTaskNotice(`分卷任务未保存：${String(error)}；请勿刷新页面。`);
      return;
    }
    setTaskNotice("正在保存分卷任务…");
    void store
      .writePackageRecord("export", raw)
      .then(() => {
        if (current) {
          setSavedTask(task);
          setTaskNotice("分卷任务已保存到本地");
        }
      })
      .catch((error: unknown) => {
        if (current) setTaskNotice(`分卷任务未保存：${String(error)}；请勿刷新页面。`);
      });
    return () => {
      current = false;
    };
  }, [plan, volumeStates, volumeBytes, drafts, taskReady, store]);
  return {
    savedTask,
    setSavedTask,
    taskReady,
    taskNotice,
    setTaskNotice,
    sourceCatalog,
    setSourceCatalog,
  };
}
