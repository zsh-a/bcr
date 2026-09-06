import { textVersion } from "@bcr/core";
import type { ResearchStore } from "./research";
import { decodeResearchBackup, type ResearchBackup } from "./researchBackup";
import type { PreparedReaderBackup } from "@bcr/reader-studio/research-transfer";

export type RecoveryPhase = "pending" | "reader-restored" | "collections-merged" | "complete";
export interface RecoverySnapshot {
  backup: ResearchBackup;
  manifest: PreparedReaderBackup["manifest"];
}
interface RecoveryIdentity {
  id: string;
  identity: string;
  phase: RecoveryPhase;
}
interface RecoveryProgress extends RecoveryIdentity {
  version: 2;
  snapshot: string;
}
interface LegacyRecovery extends RecoveryIdentity, RecoverySnapshot {
  version: 1;
}
export type ResearchRecovery = RecoveryProgress | LegacyRecovery;
const phases: RecoveryPhase[] = ["pending", "reader-restored", "collections-merged", "complete"];
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const LIMIT = 112 * 1024 * 1024;
function envelope(raw: string, limit: number) {
  if (new Blob([raw]).size > limit) throw new Error("恢复日志过大");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("恢复日志格式无效");
  const { checksum, ...record } = value;
  if (checksum !== textVersion(JSON.stringify(record)))
    throw new Error("恢复日志损坏，请结束跟踪后重新导入");
  return record;
}
function encode(record: object) {
  return JSON.stringify({ ...record, checksum: textVersion(JSON.stringify(record)) });
}
async function decodeSnapshot(value: RecoverySnapshot): Promise<RecoverySnapshot> {
  const { decodeReaderBackup } = await import("@bcr/reader-studio/research-transfer");
  return {
    backup: decodeResearchBackup(JSON.stringify(value.backup)),
    manifest: decodeReaderBackup(value.manifest),
  };
}
export async function decodeResearchRecovery(
  raw: string | undefined,
): Promise<ResearchRecovery | undefined> {
  if (!raw) return;
  const record = envelope(raw, LIMIT);
  if (
    typeof record.id !== "string" ||
    !record.id ||
    !hash(record.identity) ||
    !phases.includes(record.phase)
  )
    throw new Error("恢复日志损坏，请结束跟踪后重新导入");
  if (record.version === 1) return { ...record, ...(await decodeSnapshot(record)) };
  if (record.version !== 2 || !hash(record.snapshot) || new Blob([raw]).size > 4096)
    throw new Error("恢复进度记录无效");
  return record;
}
export async function readResearchRecovery(store: ResearchStore) {
  return decodeResearchRecovery(await store.readPackageRecord("recovery"));
}
export async function loadRecoverySnapshot(
  store: ResearchStore,
  record: ResearchRecovery,
): Promise<RecoverySnapshot> {
  if (record.version === 1) return { backup: record.backup, manifest: record.manifest };
  const raw = await store.readPackageRecord("recovery-snapshot");
  if (!raw || textVersion(raw) !== record.snapshot)
    throw new Error("恢复快照缺失或损坏，请结束跟踪后重新导入");
  const value = envelope(raw, LIMIT);
  if (value.version !== 1 || value.id !== record.id || value.identity !== record.identity)
    throw new Error("恢复快照与任务不匹配");
  return decodeSnapshot(value);
}
export async function saveRecoveryProgress(
  store: ResearchStore,
  record: ResearchRecovery,
  phase: RecoveryPhase,
): Promise<RecoveryProgress> {
  if (record.version === 1 && phase !== "complete") throw new Error("旧恢复任务需先迁移快照");
  const next: RecoveryProgress = {
    version: 2,
    id: record.id,
    identity: record.identity,
    phase,
    snapshot: record.version === 2 ? record.snapshot : textVersion(""),
  };
  const raw = encode(next);
  await decodeResearchRecovery(raw);
  await store.writePackageRecord("recovery", raw);
  return next;
}
export async function saveRecoverySnapshot(
  store: ResearchStore,
  identity: RecoveryIdentity,
  snapshot: RecoverySnapshot,
): Promise<RecoveryProgress> {
  const raw = encode({ version: 1, id: identity.id, identity: identity.identity, ...snapshot });
  const value = envelope(raw, LIMIT);
  await decodeSnapshot(value);
  // One active task owns this slot. Publish its pointer only after the snapshot
  // is durable; a failed pointer write leaves the old journal readable.
  await store.writePackageRecord("recovery-snapshot", raw);
  return saveRecoveryProgress(
    store,
    { ...identity, version: 2, snapshot: textVersion(raw) },
    identity.phase,
  );
}
export async function cleanupRecoverySnapshot(store: ResearchStore) {
  // Call only after publishing completion/clearing the pointer, under the task queue.
  await store.writePackageRecord("recovery-snapshot", "");
}
