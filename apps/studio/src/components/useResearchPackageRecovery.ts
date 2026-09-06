import { useEffect, useRef, useState } from "react";
import type { ResearchStore } from "../research";
import type { PreparedResearchPackage } from "../researchPackage";
import {
  clearResearchRecovery,
  readResearchRecovery,
  resumeResearchRecovery,
  type ResearchRecovery,
} from "../researchPackageRecovery";
export function useResearchPackageRecovery(store: ResearchStore) {
  const [record, setRecord] = useState<ResearchRecovery>();
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  async function refresh() {
    try {
      const next = await readResearchRecovery(store);
      if (mounted.current) {
        setRecord(next);
        setNotice("");
      }
    } catch (error) {
      if (mounted.current) setNotice(String(error));
    } finally {
      if (mounted.current) setReady(true);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [store]);
  return {
    record,
    notice,
    ready,
    async resume(report: (message: string) => void, prepared?: PreparedResearchPackage) {
      try {
        await resumeResearchRecovery(store, report, prepared);
      } finally {
        await refresh();
      }
    },
    async clear() {
      await clearResearchRecovery(store);
      await refresh();
    },
  };
}
