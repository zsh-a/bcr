import { useEffect, useMemo, useState } from "react";
import type { ResearchStore } from "../research";
import type { PreparedResearchPackage } from "../researchPackage";
import {
  clearResearchRecovery,
  compactCompletedRecovery,
  readResearchRecovery,
  resumeResearchRecovery,
  type ResearchRecovery,
} from "../researchPackageRecovery";
export function useResearchPackageRecovery(store: ResearchStore) {
  const scope = useMemo(() => ({ active: false, revision: 0 }), [store]);
  const [snapshot, setSnapshot] = useState<{
    scope: typeof scope;
    record: ResearchRecovery | undefined;
    notice: string;
    ready: boolean;
  }>();
  const current = () => scope.active;
  async function refresh() {
    if (!current()) return;
    const revision = ++scope.revision;
    const publish = (record: ResearchRecovery | undefined, notice: string) => {
      if (current() && revision === scope.revision)
        setSnapshot({ scope, record, notice, ready: true });
    };
    try {
      const record = await readResearchRecovery(store);
      publish(record, "");
      if (current() && revision === scope.revision && record?.phase === "complete")
        void compactCompletedRecovery(store).catch(() => undefined);
    } catch (error) {
      publish(undefined, String(error));
    }
  }
  useEffect(() => {
    scope.active = true;
    void refresh();
    return () => {
      scope.active = false;
      scope.revision++;
    };
  }, [scope]);
  const visible = snapshot?.scope === scope ? snapshot : undefined;
  return {
    record: visible?.record,
    notice: visible?.notice ?? "",
    ready: visible?.ready ?? false,
    isCurrent: current,
    async resume(report: (message: string) => void, prepared?: PreparedResearchPackage) {
      try {
        return await resumeResearchRecovery(
          store,
          (message) => {
            if (current()) report(message);
          },
          prepared,
        );
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
