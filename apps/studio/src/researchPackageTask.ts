import {
  decodeVolumeTaskState,
  type VolumeTaskStates,
  type VolumeTaskState,
} from "./researchPackageState";
import { textVersion } from "@bcr/core";
import { decodeResearchBackup } from "./researchBackup";
import { decodeVolumeCatalog, matchesVolumeBook, groupBooksByVolume } from "./researchVolumes";
import type { ResearchPackagePlan } from "./researchPackage";
export interface ResearchPackageTask {
  readonly version: 2;
  readonly plan: ResearchPackagePlan;
  readonly states: VolumeTaskStates;
  readonly volumeBytes: number;
  readonly drafts: boolean;
}
export function decodePackageTask(raw: string | undefined): ResearchPackageTask | undefined {
  if (!raw) return undefined;
  if (new Blob([raw]).size > 40 * 1024 * 1024) throw new Error("分卷任务记录过大");
  const task = JSON.parse(raw) as Omit<ResearchPackageTask, "version"> & { version: 1 | 2 };
  if (
    !task ||
    (task.version !== 1 && task.version !== 2) ||
    typeof task.drafts !== "boolean" ||
    !Number.isSafeInteger(task.volumeBytes) ||
    task.volumeBytes <= 0 ||
    task.volumeBytes > 512 * 1024 * 1024
  )
    throw new Error("分卷任务记录无效");
  const plan = task.plan;
  if (
    !plan ||
    !plan.backup ||
    !Array.isArray(plan.volumes) ||
    !Array.isArray(plan.books) ||
    !Array.isArray(plan.references) ||
    !task.states ||
    typeof task.states !== "object"
  )
    throw new Error("分卷任务计划无效");
  decodeResearchBackup(JSON.stringify(plan.backup));
  const catalog = decodeVolumeCatalog(plan.catalog);
  if (
    textVersion(JSON.stringify(catalog)) !== plan.set ||
    textVersion(JSON.stringify(plan.backup)) !== catalog.researchHash ||
    plan.volumes.length !== catalog.total ||
    typeof plan.readerStamp !== "string"
  )
    throw new Error("分卷任务快照校验失败");
  const allBooks: string[] = [];
  const grouped = groupBooksByVolume(catalog.books);
  for (const [index, volume] of plan.volumes.entries()) {
    const books = (grouped.get(index + 1) ?? []).map((book) => book.book);
    if (
      !volume ||
      JSON.stringify(volume.books) !== JSON.stringify(books) ||
      typeof volume.readerStamp !== "string" ||
      [volume.sourceBytes, volume.snapshotBytes, volume.estimatedBytes].some(
        (size) => !Number.isSafeInteger(size) || size < 0,
      )
    )
      throw new Error("分卷任务容量或来源无效");
    allBooks.push(...books);
  }
  if (
    JSON.stringify([...allBooks].sort()) !== JSON.stringify([...plan.books].sort()) ||
    plan.references.some(
      (ref) =>
        !ref ||
        typeof ref.label !== "string" ||
        !["ready", "missing", "unsupported", "historical"].includes(ref.state),
    )
  )
    throw new Error("分卷任务引用无效");
  const states: Record<number, VolumeTaskState> = {};
  for (const [key, value] of Object.entries(task.states)) {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.total)
      throw new Error("分卷任务状态无效");
    states[index] = decodeVolumeTaskState(value, task.version);
  }
  return { ...task, version: 2, states };
}
export async function verifyPackageTask(
  task: ResearchPackageTask,
  report: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { readerTransferStamp, checkReaderTransfer, planReaderTransfer } =
    await import("@bcr/reader-studio/research-transfer");
  signal?.throwIfAborted();
  const verify = () => {
    if (
      task.plan.volumes.some((volume) => readerTransferStamp(volume.books) !== volume.readerStamp)
    )
      throw new Error("任务来源已变化，不能继续原分卷；请重新检查并创建新任务");
    const current = planReaderTransfer(task.plan.books, 512 * 1024 * 1024).flatMap(
      (volume) => volume.books,
    );
    const byId = new Map(current.map((book) => [book.book, book]));
    if (task.plan.catalog.books.some((book) => !matchesVolumeBook(book, byId.get(book.book))))
      throw new Error("任务来源身份已变化，请重新检查资料包");
  };
  verify();
  const missing = await checkReaderTransfer(task.plan.books, report, signal);
  if (missing.length) throw new Error("任务源文件缺失或损坏，请恢复源文件后重试");
  verify();
  signal?.throwIfAborted();
}
