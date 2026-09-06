import { textVersion } from "@bcr/core";
import type { ResearchStore } from "./research";
import { planResearchImport } from "./researchBackup";
import {
  bindResearchPackage,
  catalogBindings,
  type PreparedResearchPackage,
} from "./researchPackage";

import {
  readResearchRecovery,
  saveRecoveryProgress,
  saveRecoverySnapshot,
  loadRecoverySnapshot,
  cleanupRecoverySnapshot,
  type ResearchRecovery,
  type RecoverySnapshot,
} from "./researchRecoveryJournal";
export { decodeResearchRecovery, readResearchRecovery } from "./researchRecoveryJournal";
export type { ResearchRecovery, RecoveryPhase } from "./researchRecoveryJournal";

const queues = new WeakMap<ResearchStore, Promise<unknown>>();
function serial<T>(store: ResearchStore, work: () => Promise<T>): Promise<T> {
  const operation = (queues.get(store) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(store, operation);
  return operation;
}
export function compactCompletedRecovery(store: ResearchStore) {
  return serial(store, async () => {
    // Re-read under the task queue: a new import may have started since the UI loaded.
    const record = await readResearchRecovery(store);
    if (record?.phase !== "complete") return;
    if (record.version === 1) await saveRecoveryProgress(store, record, "complete");
    await cleanupRecoverySnapshot(store);
  });
}
export function clearResearchRecovery(store: ResearchStore) {
  return serial(store, async () => {
    await store.writePackageRecord("recovery", "");
    await cleanupRecoverySnapshot(store).catch(() => undefined);
  });
}
function identity(prepared: PreparedResearchPackage) {
  return textVersion(
    JSON.stringify([prepared.backup, prepared.reader.manifest.books, prepared.volume]),
  );
}
export function assertRecoveryPackage(
  record: ResearchRecovery | undefined,
  prepared: PreparedResearchPackage,
) {
  if (record && record.phase !== "complete" && identity(prepared) !== record.identity)
    throw new Error("请选择中断任务的同一资料包分卷，或先结束该任务的跟踪。");
}
export async function verifyRecoveryPackage(
  store: ResearchStore,
  prepared: PreparedResearchPackage,
) {
  assertRecoveryPackage(await readResearchRecovery(store), prepared);
}
export type RecoveryResult = "restored" | "finalized" | "complete";
export function resumeResearchRecovery(
  store: ResearchStore,
  report: (message: string) => void,
  prepared?: PreparedResearchPackage,
): Promise<RecoveryResult> {
  const release = prepared?.acquire?.();
  return serial(store, async () => {
    let record = await readResearchRecovery(store);
    if (record?.phase === "complete" && !prepared) {
      if (record.version === 1) await saveRecoveryProgress(store, record, "complete");
      await cleanupRecoverySnapshot(store).catch(() => undefined);
      return "complete";
    }
    if (prepared) assertRecoveryPackage(record, prepared);
    if (record && record.phase !== "complete" && (await store.hasRestoredPackage(record.id))) {
      // The collection receipt proves both stores committed. Later user changes
      // must not be interpreted as missing work belonging to this import.
      await saveRecoveryProgress(store, record, "complete");
      await cleanupRecoverySnapshot(store).catch(() => undefined);
      report("恢复任务记录已完成，保留了后续修改。");
      return "finalized";
    }
    const {
      readerTransferIdentity,
      recoverReaderTransfer,
      restoreReaderTransfer,
      flushReaderTransfer,
    } = await import("@bcr/reader-studio/research-transfer");
    let snapshot: RecoverySnapshot;
    if (!record || record.phase === "complete") {
      if (!prepared) throw new Error("没有待续接的恢复任务");
      const bindings = prepared.volume
        ? catalogBindings(prepared.volume.catalog, prepared.volume.set)
        : prepared.reader.manifest.books.map((entry) => ({
            book: entry.book.id,
            target: readerTransferIdentity(entry),
          }));
      snapshot = {
        backup: bindResearchPackage(prepared.backup, bindings),
        manifest: prepared.reader.manifest,
      };
      record = await saveRecoverySnapshot(
        store,
        {
          id: crypto.randomUUID(),
          identity: identity(prepared),
          phase: "pending",
        },
        snapshot,
      );
    } else {
      snapshot = await loadRecoverySnapshot(store, record);
      if (record.version === 1) record = await saveRecoverySnapshot(store, record, snapshot);
    }

    report("正在核验并续接 Reader 恢复任务…");
    const reader = prepared?.reader ?? (await recoverReaderTransfer(snapshot.manifest));
    await restoreReaderTransfer(reader, report);
    // Repair a close between library and session metadata writes, including reused books.
    await flushReaderTransfer();
    record = await saveRecoveryProgress(store, record, "reader-restored");
    const backup = snapshot.backup;
    await store.updateRestoredPackage(
      record.id,
      (current) => planResearchImport(current, backup).library,
    );
    record = await saveRecoveryProgress(store, record, "collections-merged");
    await saveRecoveryProgress(store, record, "complete");
    await cleanupRecoverySnapshot(store).catch(() => undefined);
    report("Reader 资料包恢复完成，可从集合回到原文。");
    return "restored";
  }).finally(async () => {
    await release?.().catch(() => undefined);
  });
}
