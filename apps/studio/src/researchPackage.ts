import { createPackageStaging, type PackageStaging } from "./researchPackageStaging";
import {
  collectPackageReferences,
  bindPackageLibrary,
  type PackageReference,
} from "./researchPackageReferences";
export type { PackageReference } from "./researchPackageReferences";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { hashReadableStream } from "@bcr/core";
import type { PreparedReaderBackup } from "@bcr/reader-studio/research-transfer";
import { type ResearchLibrary, type ReaderBinding } from "./research";
import {
  createResearchBackup,
  decodeResearchBackup,
  planResearchImport,
  type ResearchBackup,
} from "./researchBackup";
import {
  DEFAULT_VOLUME_BYTES,
  RESEARCH_LIMIT,
  decodeVolumeCatalog,
  matchesVolumeBook,
  type ResearchSourceStatus,
  type ResearchVolumeCatalog,
} from "./researchVolumes";
export const PACKAGE_LIMIT = 600 * 1024 * 1024;
export interface ResearchPackagePlan {
  readonly backup: ResearchBackup;
  readonly references: ReadonlyArray<PackageReference>;
  readonly books: ReadonlyArray<string>;
  readonly sourceBytes: number;
  readonly readerStamp: string;
  readonly researchBytes: number;
  readonly catalog: ResearchVolumeCatalog;
  readonly set: string;
  readonly volumes: ReadonlyArray<{
    readonly books: ReadonlyArray<string>;
    readonly sourceBytes: number;
    readonly snapshotBytes: number;
    readonly readerStamp: string;
    readonly estimatedBytes: number;
  }>;
}
export async function planResearchPackage(
  library: ResearchLibrary,
  includeDrafts: boolean,
  report: (message: string) => void = () => {},
  signal?: AbortSignal,
  volumeBytes = DEFAULT_VOLUME_BYTES,
): Promise<ResearchPackagePlan> {
  signal?.throwIfAborted();
  report("正在收集原始与历史引用…");
  const { readerTransferState, checkReaderTransfer, readerTransferStamp, planReaderTransfer } =
    await import("@bcr/reader-studio/research-transfer");
  signal?.throwIfAborted();
  const { state } = readerTransferState();
  const backup = createResearchBackup(library, includeDrafts, {
    getItem: (key) => localStorage.getItem(key),
  });
  const references = collectPackageReferences(backup.library, state.library);
  const candidateIds = [
    ...new Set(references.flatMap((entry) => (entry.book ? [entry.book] : []))),
  ];
  const missing = new Set(await checkReaderTransfer(candidateIds, report, signal));
  for (let i = 0; i < references.length; i++) {
    const entry = references[i]!;
    if (entry.book && missing.has(entry.book)) references[i] = { ...entry, state: "missing" };
  }
  if (readerTransferState().state.library !== state.library)
    throw new Error("Reader 资料在检查期间发生变化，请重新检查资料包");
  // Retain a readable original even if its cited chapter no longer exists.
  const books = candidateIds.filter((id) => !missing.has(id));
  const unique = new Map(
    state.library
      .filter((book) => books.includes(book.id))
      .map((book) => [book.source.ref!.hash, book.source.ref!.size]),
  );
  if (!Number.isSafeInteger(volumeBytes) || volumeBytes <= 0 || volumeBytes > 512 * 1024 * 1024)
    throw new Error("单卷源文件上限必须大于 0 且不超过 512 MiB");
  const research = new Blob([JSON.stringify(backup)]);
  if (research.size > RESEARCH_LIMIT) throw new Error("集合快照超过 16 MiB 上限，请减少所选集合");
  const parts = planReaderTransfer(books, volumeBytes);
  const catalog: ResearchVolumeCatalog = {
    format: "bcr-research-volumes",
    version: 1,
    researchHash: await hashReadableStream(research.stream(), { signal }),
    total: parts.length,
    books: parts.flatMap((part, index) =>
      part.books.map((book) => ({ ...book, volume: index + 1 })),
    ),
  };
  decodeVolumeCatalog(catalog);
  const catalogBlob = new Blob([JSON.stringify(catalog)]);
  if (catalogBlob.size > RESEARCH_LIMIT)
    throw new Error("分卷目录超过 16 MiB 上限，请减少所选集合");
  const set = await hashReadableStream(catalogBlob.stream(), { signal });
  if (
    new Blob([JSON.stringify(bindResearchPackage(backup, catalogBindings(catalog, set)))]).size >
    RESEARCH_LIMIT
  )
    throw new Error("包含来源映射的集合快照超过 16 MiB 上限，请减少所选集合");
  const volumes = parts.map((part) => ({
    ...part,
    books: part.books.map((book) => book.book),
    estimatedBytes:
      research.size +
      catalogBlob.size +
      part.sourceBytes +
      part.snapshotBytes +
      65536 +
      part.books.length * 512,
  }));
  if (volumes.some((part) => part.estimatedBytes > PACKAGE_LIMIT))
    throw new Error("单卷内容超过 600 MiB 上限，请降低单卷容量");
  if (readerTransferState().state.library !== state.library)
    throw new Error("Reader 资料在检查期间发生变化，请重新检查资料包");
  return {
    backup,
    references,
    researchBytes: research.size,
    catalog,
    set,
    volumes,
    books,
    readerStamp: readerTransferStamp(books),
    sourceBytes: [...unique.values()].reduce((sum, size) => sum + size, 0),
  };
}
export async function createResearchPackage(
  plan: ResearchPackagePlan,
  report: (message: string) => void,
  signal?: AbortSignal,
  volumeIndex = 0,
): Promise<Blob> {
  signal?.throwIfAborted();
  const { createReaderTransfer } = await import("@bcr/reader-studio/research-transfer");
  const volume = plan.volumes[volumeIndex];
  if (!volume) throw new Error("分卷编号无效");
  const reader = await createReaderTransfer(volume.books, report, volume.readerStamp, signal);
  const catalog = new Blob([JSON.stringify(plan.catalog)]);
  const research = new Blob([JSON.stringify(plan.backup)], { type: "application/json" });
  if (research.size > 16 * 1024 * 1024) throw new Error("集合快照超过 16 MiB 上限，请减少所选集合");
  const manifest = {
    format: "bcr-research-package",
    version: 2,
    volume: { set: plan.set, index: volumeIndex + 1 },
    entries: [
      {
        path: "catalog.json",
        size: catalog.size,
        hash: await hashReadableStream(catalog.stream(), { signal }),
      },
      {
        path: "research.json",
        size: research.size,
        hash: await hashReadableStream(research.stream(), { signal }),
      },
      {
        path: "reader.zip",
        size: reader.size,
        hash: await hashReadableStream(reader.stream(), {
          signal,
          onProgress: (bytes) =>
            report(
              `正在校验 Reader 容器 · ${Math.floor((bytes / Math.max(1, reader.size)) * 100)}%`,
            ),
        }),
      },
    ],
  };
  if (reader.size + research.size + catalog.size > PACKAGE_LIMIT)
    throw new Error("资料包超过 600 MiB 上限，请减少所选集合");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  try {
    signal?.throwIfAborted();
    report("正在组装资料包…");
    await zip.add(
      "manifest.json",
      new TextReader(JSON.stringify(manifest)),
      signal ? { signal } : {},
    );
    await zip.add("catalog.json", new BlobReader(catalog), {
      level: 0,
      ...(signal ? { signal } : {}),
    });
    await zip.add("research.json", new BlobReader(research), {
      level: 0,
      ...(signal ? { signal } : {}),
    });
    await zip.add("reader.zip", new BlobReader(reader), {
      level: 0,
      ...(signal ? { signal } : {}),
      onprogress: (bytes, total) =>
        report(`正在组装资料包 · ${Math.floor((bytes / Math.max(1, total)) * 100)}%`),
    });
    const result = await zip.close();
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    await zip.close().catch(() => {});
    throw error;
  }
}
export interface PreparedResearchPackage {
  readonly dispose?: () => Promise<void>;
  readonly acquire?: () => () => Promise<void>;
  readonly backup: ResearchBackup;
  readonly reader: PreparedReaderBackup;
  readonly volume?: {
    readonly catalog: ResearchVolumeCatalog;
    readonly set: string;
    readonly index: number;
  };
}
export async function inspectResearchPackage(
  file: Blob,
  report: (message: string) => void = () => {},
  signal?: AbortSignal,
): Promise<PreparedResearchPackage> {
  signal?.throwIfAborted();
  report("正在读取资料包清单…");
  if (file.size > PACKAGE_LIMIT + 65536) throw new Error("资料包超过 600 MiB 上限");
  const staging = await createPackageStaging(signal);
  try {
    const value = await inspectStagedPackage(file, staging, report, signal);
    return { ...value, dispose: staging.dispose, acquire: staging.acquire };
  } catch (error) {
    await staging.dispose().catch(() => undefined);
    throw error;
  }
}
async function inspectStagedPackage(
  file: Blob,
  staging: PackageStaging,
  report: (message: string) => void,
  signal?: AbortSignal,
): Promise<PreparedResearchPackage> {
  const zip = new ZipReader(new BlobReader(file));
  try {
    const allEntries = await zip.getEntries();
    signal?.throwIfAborted();
    const entries = allEntries.filter((entry) => !entry.directory);
    if (allEntries.length !== entries.length) throw new Error("资料包不允许目录条目");
    if (
      (entries.length !== 3 && entries.length !== 4) ||
      new Set(entries.map((entry) => entry.filename)).size !== entries.length ||
      entries.some(
        (entry) =>
          entry.directory ||
          !["manifest.json", "research.json", "reader.zip", "catalog.json"].includes(
            entry.filename,
          ),
      )
    )
      throw new Error("资料包包含缺失、重复或未知路径");
    const header = entries.find((entry) => entry.filename === "manifest.json")!;
    if (header.uncompressedSize > 65536) throw new Error("资料包清单过大");
    const manifest = JSON.parse(
      await header.getData!(new TextWriter(), {
        checkSignature: true,
        ...(signal ? { signal } : {}),
      }),
    ) as {
      format?: unknown;
      version?: unknown;
      volume?: { set: string; index: number };
      entries?: Array<{ path: string; size: number; hash: string }>;
    };
    if (
      !manifest ||
      manifest.format !== "bcr-research-package" ||
      (manifest.version !== 1 && manifest.version !== 2) ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.length !== (manifest.version === 2 ? 3 : 2) ||
      entries.length !== manifest.entries.length + 1
    )
      throw new Error("资料包版本或清单无效");
    if (manifest.entries.reduce((sum, item) => sum + (item?.size ?? 0), 0) > PACKAGE_LIMIT)
      throw new Error("资料包内容超过 600 MiB 上限");
    const blobs = new Map<string, Blob>();
    for (const item of manifest.entries) {
      signal?.throwIfAborted();
      if (
        !item ||
        !(
          manifest.version === 2
            ? ["research.json", "reader.zip", "catalog.json"]
            : ["research.json", "reader.zip"]
        ).includes(item.path) ||
        blobs.has(item.path) ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        item.size >
          (item.path !== "reader.zip" ? RESEARCH_LIMIT : PACKAGE_LIMIT - RESEARCH_LIMIT) ||
        !/^[a-f0-9]{64}$/u.test(item.hash)
      )
        throw new Error("资料包文件清单无效");
      const entry = entries.find((entry) => entry.filename === item.path)!;
      if (entry.uncompressedSize !== item.size) throw new Error("资料包文件大小不符");
      const label = item.path === "reader.zip" ? "Reader 源资料" : "集合与笔记";
      report(`正在解包 · ${label}`);
      const blob = await staging.write(item.size, item.hash, (stream) =>
        entry.getData!(stream, {
          checkSignature: true,
          ...(signal ? { signal } : {}),
          onprogress: (bytes, total) =>
            report(`正在解包 · ${label} · ${Math.floor((bytes / Math.max(1, total)) * 100)}%`),
        }),
      );
      blobs.set(item.path, blob);
    }
    const { inspectReaderBackup } = await import("@bcr/reader-studio/research-transfer");
    const backup = decodeResearchBackup(await blobs.get("research.json")!.text());
    const reader = await inspectReaderBackup(blobs.get("reader.zip")!, report, signal, staging);
    signal?.throwIfAborted();
    if (reader.manifest.books.some((entry) => !entry.source))
      throw new Error("完整资料包中的 Reader 书籍缺少源文件");
    if (manifest.version === 1) return { backup, reader };
    const { readerTransferIdentity } = await import("@bcr/reader-studio/research-transfer");
    const catalog = decodeVolumeCatalog(JSON.parse(await blobs.get("catalog.json")!.text()));
    const set = manifest.entries.find((entry) => entry.path === "catalog.json")!.hash;
    const volume = manifest.volume;
    if (
      !volume ||
      volume.set !== set ||
      !Number.isSafeInteger(volume.index) ||
      volume.index < 1 ||
      volume.index > catalog.total ||
      catalog.researchHash !==
        manifest.entries.find((entry) => entry.path === "research.json")!.hash
    )
      throw new Error("分卷身份或集合快照不匹配");
    const expected = catalog.books.filter((entry) => entry.volume === volume.index);
    const byId = new Map(expected.map((book) => [book.book, book]));
    const actual = reader.manifest.books.map((entry) => ({
      book: entry.book.id,
      target: readerTransferIdentity(entry),
      hash: entry.source!.hash,
    }));
    if (
      expected.length !== actual.length ||
      actual.some((book) => !matchesVolumeBook(book, byId.get(book.book)))
    )
      throw new Error("本卷源文件与分卷目录不匹配");
    return { backup, reader, volume: { catalog, set, index: volume.index } };
  } finally {
    await zip.close();
  }
}
export function bindResearchPackage(
  backup: ResearchBackup,
  bindings: ReadonlyArray<ReaderBinding>,
): ResearchBackup {
  return { ...backup, library: bindPackageLibrary(backup.library, bindings) };
}

export async function restoreResearchPackage(
  prepared: PreparedResearchPackage,
  write: (change: (library: ResearchLibrary) => ResearchLibrary) => Promise<void>,
  report: (message: string) => void,
) {
  const release = prepared.acquire?.();
  try {
    const { restoreReaderTransfer } = await import("@bcr/reader-studio/research-transfer");
    const bindings = await restoreReaderTransfer(prepared.reader, report);
    const backup = bindResearchPackage(
      prepared.backup,
      prepared.volume ? catalogBindings(prepared.volume.catalog, prepared.volume.set) : bindings,
    );
    try {
      await write((current) => planResearchImport(current, backup).library);
    } catch (error) {
      throw new Error(
        `源资料已恢复，集合尚未保存；请重试，已恢复书籍不会重复添加：${String(error)}`,
      );
    }
  } finally {
    await release?.().catch(() => undefined);
  }
}

export async function previewResearchPackageImport(
  prepared: PreparedResearchPackage,
  current: ResearchLibrary,
) {
  const { readerTransferIdentity, readerTransferPreview } =
    await import("@bcr/reader-studio/research-transfer");
  const bindings = prepared.reader.manifest.books.map((entry) => ({
    book: entry.book.id,
    target: readerTransferIdentity(entry),
  }));
  return {
    books: readerTransferPreview(prepared.reader),
    collections: planResearchImport(
      current,
      bindResearchPackage(
        prepared.backup,
        prepared.volume ? catalogBindings(prepared.volume.catalog, prepared.volume.set) : bindings,
      ),
    ),
  };
}

export function catalogBindings(catalog: ResearchVolumeCatalog, set: string): ReaderBinding[] {
  return catalog.books.map((entry) => ({
    book: entry.book,
    target: entry.target,
    volume: { set, index: entry.volume, total: catalog.total },
  }));
}
export async function researchVolumeStatus(
  prepared: Pick<PreparedResearchPackage, "volume">,
  report: (message: string) => void = () => {},
  signal?: AbortSignal,
) {
  if (!prepared.volume) return [];
  const { readerTransferState, checkReaderTransfer } =
    await import("@bcr/reader-studio/research-transfer");
  const { state } = readerTransferState();
  const byId = new Map(state.library.map((book) => [book.id, book]));
  const existing = prepared.volume.catalog.books.filter((entry) => byId.has(entry.target));
  const unavailable = new Set(
    await checkReaderTransfer(
      existing.map((entry) => entry.target),
      report,
      signal,
    ),
  );
  if (readerTransferState().state.library !== state.library)
    throw new Error("书库在核验期间发生变化，请重新核验来源状态");
  return prepared.volume.catalog.books.map((entry): ResearchSourceStatus => {
    const book = byId.get(entry.target);
    if (!book) return { ...entry, state: "missing", restored: false };
    if (unavailable.has(entry.target) || book.source.ref?.hash !== entry.hash)
      return { ...entry, state: "repair", restored: false };
    return { ...entry, state: "restored", restored: true };
  });
}
