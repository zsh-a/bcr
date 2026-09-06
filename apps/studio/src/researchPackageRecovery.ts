import { textVersion } from "@bcr/core";
import type { ResearchStore } from "./research";
import { decodeResearchBackup, planResearchImport, type ResearchBackup } from "./researchBackup";
import {
  bindResearchPackage,
  catalogBindings,
  type PreparedResearchPackage,
} from "./researchPackage";
import type { PreparedReaderBackup } from "@bcr/reader-studio/research-transfer";

export type RecoveryPhase = "pending" | "reader-restored" | "collections-merged" | "complete";
export interface ResearchRecovery {
  version: 1;
  id: string;
  identity: string;
  phase: RecoveryPhase;
  backup: ResearchBackup;
  manifest: PreparedReaderBackup["manifest"];
}
const phases: RecoveryPhase[] = ["pending", "reader-restored", "collections-merged", "complete"];
export async function decodeResearchRecovery(
  raw: string | undefined,
): Promise<ResearchRecovery | undefined> {
  if (!raw) return;
  if (new Blob([raw]).size > 112 * 1024 * 1024) throw new Error("恢复日志过大");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("恢复日志格式无效");
  const { checksum, ...record } = value;
  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.identity !== "string" ||
    !phases.includes(record.phase) ||
    checksum !== textVersion(JSON.stringify(record))
  )
    throw new Error("恢复日志损坏，请结束跟踪后重新导入");
  const { decodeReaderBackup } = await import("@bcr/reader-studio/research-transfer");
  return {
    ...record,
    backup: decodeResearchBackup(JSON.stringify(record.backup)),
    manifest: decodeReaderBackup(record.manifest),
  };
}
export async function readResearchRecovery(store: ResearchStore) {
  return decodeResearchRecovery(await store.readPackageRecord("recovery"));
}
async function save(store: ResearchStore, record: ResearchRecovery) {
  const raw = JSON.stringify({ ...record, checksum: textVersion(JSON.stringify(record)) });
  await decodeResearchRecovery(raw);
  await store.writePackageRecord("recovery", raw);
}
const queues = new WeakMap<ResearchStore, Promise<unknown>>();
function serial<T>(store: ResearchStore, work: () => Promise<T>): Promise<T> {
  const operation = (queues.get(store) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(store, operation);
  return operation;
}
export function clearResearchRecovery(store: ResearchStore) {
  return serial(store, () => store.writePackageRecord("recovery", ""));
}
function identity(prepared: PreparedResearchPackage) {
  return textVersion(
    JSON.stringify([prepared.backup, prepared.reader.manifest.books, prepared.volume]),
  );
}
export function resumeResearchRecovery(
  store: ResearchStore,
  report: (message: string) => void,
  prepared?: PreparedResearchPackage,
) {
  return serial(store, async () => {
    let record = await readResearchRecovery(store);
    const {
      readerTransferIdentity,
      recoverReaderTransfer,
      restoreReaderTransfer,
      flushReaderTransfer,
    } = await import("@bcr/reader-studio/research-transfer");
    if (record?.phase === "complete" && !prepared) return;
    if (record && record.phase !== "complete") {
      if (prepared && identity(prepared) !== record.identity)
        throw new Error("请选择中断任务的同一资料包分卷，或先结束该任务的跟踪。");
    } else {
      if (!prepared) throw new Error("没有待续接的恢复任务");
      const bindings = prepared.volume
        ? catalogBindings(prepared.volume.catalog, prepared.volume.set)
        : prepared.reader.manifest.books.map((entry) => ({
            book: entry.book.id,
            target: readerTransferIdentity(entry),
          }));
      record = {
        version: 1,
        id: crypto.randomUUID(),
        identity: identity(prepared),
        phase: "pending",
        backup: bindResearchPackage(prepared.backup, bindings),
        manifest: prepared.reader.manifest,
      };
      // This must succeed before any Reader source or library writes.
      await save(store, record);
    }
    report("正在核验并续接 Reader 恢复任务…");
    const reader = prepared?.reader ?? (await recoverReaderTransfer(record.manifest));
    await restoreReaderTransfer(reader, report);
    // Repair a close between library and session metadata writes, including reused books.
    await flushReaderTransfer();
    record = { ...record, phase: "reader-restored" };
    await save(store, record);
    const backup = record.backup;
    await store.updateRestoredPackage(
      record.id,
      (current) => planResearchImport(current, backup).library,
    );
    record = { ...record, phase: "collections-merged" };
    await save(store, record);
    await save(store, { ...record, phase: "complete" });
    report("Reader 资料包恢复完成，可从集合回到原文。");
  });
}
