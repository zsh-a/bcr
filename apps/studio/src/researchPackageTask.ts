import { textVersion } from "@bcr/core";
import { decodeResearchBackup } from "./researchBackup";
import { decodeVolumeCatalog } from "./researchVolumes";
import type { ResearchPackagePlan } from "./researchPackage";
export interface ResearchPackageTask {
  readonly version: 1;
  readonly plan: ResearchPackagePlan;
  readonly states: Readonly<Record<number, string>>;
  readonly volumeBytes: number;
  readonly drafts: boolean;
}
const statuses = new Set([
  "待生成",
  "正在生成",
  "正在保存",
  "生成失败，可重试",
  "已取消，可重试",
  "已触发下载，可重新生成",
  "已保存到文件",
  "上次操作未完成，可重试",
]);
export function decodePackageTask(raw: string | undefined): ResearchPackageTask | undefined {
  if (!raw) return undefined;
  if (new Blob([raw]).size > 40 * 1024 * 1024) throw new Error("分卷任务记录过大");
  const task = JSON.parse(raw) as ResearchPackageTask;
  if (
    !task ||
    task.version !== 1 ||
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
  for (const [index, volume] of plan.volumes.entries()) {
    const books = catalog.books
      .filter((book) => book.volume === index + 1)
      .map((book) => book.book);
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
  const states: Record<number, string> = {};
  for (const [key, value] of Object.entries(task.states)) {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.total || !statuses.has(value))
      throw new Error("分卷任务状态无效");
    states[index] = value === "正在生成" || value === "正在保存" ? "上次操作未完成，可重试" : value;
  }
  return { ...task, states };
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
    if (
      task.plan.catalog.books.some(
        (book) =>
          !current.some(
            (entry) =>
              entry.book === book.book && entry.target === book.target && entry.hash === book.hash,
          ),
      )
    )
      throw new Error("任务来源身份已变化，请重新检查资料包");
  };
  verify();
  const missing = await checkReaderTransfer(task.plan.books, report, signal);
  if (missing.length) throw new Error("任务源文件缺失或损坏，请恢复源文件后重试");
  verify();
  signal?.throwIfAborted();
}
