import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { hashReadableStream, textVersion } from "@bcr/core";
import type { PreparedReaderBackup } from "@bcr/reader-studio/research-transfer";
import { boundReaderExcerpt, type ResearchLibrary } from "./research";
import {
  createResearchBackup,
  decodeResearchBackup,
  planResearchImport,
  type ResearchBackup,
} from "./researchBackup";
export const PACKAGE_LIMIT = 600 * 1024 * 1024;
export interface PackageReference {
  readonly label: string;
  readonly book?: string;
  readonly section?: string;
  readonly version?: string;
  readonly state: "ready" | "missing" | "unsupported" | "historical";
}
export interface ResearchPackagePlan {
  readonly backup: ResearchBackup;
  readonly references: ReadonlyArray<PackageReference>;
  readonly books: ReadonlyArray<string>;
  readonly sourceBytes: number;
  readonly readerStamp: string;
}
export async function planResearchPackage(
  library: ResearchLibrary,
  includeDrafts: boolean,
): Promise<ResearchPackagePlan> {
  const { readerTransferState, checkReaderTransfer, readerTransferStamp } =
    await import("@bcr/reader-studio/research-transfer");
  const { state } = readerTransferState();
  const backup = createResearchBackup(library, includeDrafts, {
    getItem: (key) => localStorage.getItem(key),
  });
  const references = backup.library.collections.flatMap((collection) =>
    collection.excerpts.flatMap((item) =>
      [item, ...(item.links ?? []).map((link) => ({ ...item, ...link }))].map(
        (entry, i): PackageReference => {
          const active = boundReaderExcerpt(entry);
          const url = new URL(active.route, "https://bcr.invalid");
          const label = `${collection.name} · ${item.title} · ${i ? `修订 ${i}` : "最初引用"}`;
          if (url.pathname !== "/reader") return { label, state: "unsupported" };
          const id = url.searchParams.get("book") ?? "",
            section = url.searchParams.get("section") ?? "";
          const book = state.library.find((book) => book.id === id);
          const chapter = book?.sections.find((part) => part.id === section);
          const version = active.citation?.source.version;
          return {
            label,
            book: id,
            section,
            ...(version ? { version } : {}),
            state:
              !book?.source.ref || !chapter
                ? "missing"
                : !version || textVersion(chapter.text) !== version
                  ? "historical"
                  : "ready",
          };
        },
      ),
    ),
  );
  const candidateIds = [
    ...new Set(references.flatMap((entry) => (entry.book ? [entry.book] : []))),
  ];
  const missing = new Set(await checkReaderTransfer(candidateIds));
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
  return {
    backup,
    references,
    books,
    readerStamp: readerTransferStamp(books),
    sourceBytes: [...unique.values()].reduce((sum, size) => sum + size, 0),
  };
}
export async function createResearchPackage(
  plan: ResearchPackagePlan,
  report: (message: string) => void,
): Promise<Blob> {
  const { createReaderTransfer } = await import("@bcr/reader-studio/research-transfer");
  const reader = await createReaderTransfer(plan.books, report, plan.readerStamp);
  const research = new Blob([JSON.stringify(plan.backup)], { type: "application/json" });
  if (research.size > 16 * 1024 * 1024) throw new Error("集合快照超过 16 MiB 上限，请减少所选集合");
  const manifest = {
    format: "bcr-research-package",
    version: 1,
    entries: [
      {
        path: "research.json",
        size: research.size,
        hash: await hashReadableStream(research.stream()),
      },
      { path: "reader.zip", size: reader.size, hash: await hashReadableStream(reader.stream()) },
    ],
  };
  if (reader.size + research.size > PACKAGE_LIMIT)
    throw new Error("资料包超过 600 MiB 上限，请减少所选集合");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  try {
    await zip.add("manifest.json", new TextReader(JSON.stringify(manifest)));
    await zip.add("research.json", new BlobReader(research), { level: 0 });
    await zip.add("reader.zip", new BlobReader(reader), { level: 0 });
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => {});
    throw error;
  }
}
export interface PreparedResearchPackage {
  readonly backup: ResearchBackup;
  readonly reader: PreparedReaderBackup;
}
export async function inspectResearchPackage(file: Blob): Promise<PreparedResearchPackage> {
  if (file.size > PACKAGE_LIMIT + 65536) throw new Error("资料包超过 600 MiB 上限");
  const zip = new ZipReader(new BlobReader(file));
  try {
    const allEntries = await zip.getEntries();
    const entries = allEntries.filter((entry) => !entry.directory);
    if (allEntries.length !== entries.length) throw new Error("资料包不允许目录条目");
    if (
      entries.length !== 3 ||
      new Set(entries.map((entry) => entry.filename)).size !== 3 ||
      entries.some(
        (entry) =>
          entry.directory ||
          !["manifest.json", "research.json", "reader.zip"].includes(entry.filename),
      )
    )
      throw new Error("资料包包含缺失、重复或未知路径");
    const header = entries.find((entry) => entry.filename === "manifest.json")!;
    if (header.uncompressedSize > 65536) throw new Error("资料包清单过大");
    const manifest = JSON.parse(
      await header.getData!(new TextWriter(), { checkSignature: true }),
    ) as {
      format?: unknown;
      version?: unknown;
      entries?: Array<{ path: string; size: number; hash: string }>;
    };
    if (
      !manifest ||
      manifest.format !== "bcr-research-package" ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.length !== 2
    )
      throw new Error("资料包版本或清单无效");
    const blobs = new Map<string, Blob>();
    for (const item of manifest.entries) {
      if (
        !item ||
        !["research.json", "reader.zip"].includes(item.path) ||
        blobs.has(item.path) ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        item.size >
          (item.path === "research.json" ? 16 * 1024 * 1024 : PACKAGE_LIMIT - 16 * 1024 * 1024) ||
        !/^[a-f0-9]{64}$/u.test(item.hash)
      )
        throw new Error("资料包文件清单无效");
      const entry = entries.find((entry) => entry.filename === item.path)!;
      if (entry.uncompressedSize !== item.size) throw new Error("资料包文件大小不符");
      const blob = await entry.getData!(new BlobWriter(), { checkSignature: true });
      if (blob.size !== item.size || (await hashReadableStream(blob.stream())) !== item.hash)
        throw new Error("资料包文件哈希校验失败");
      blobs.set(item.path, blob);
    }
    const { inspectReaderBackup } = await import("@bcr/reader-studio/research-transfer");
    const backup = decodeResearchBackup(await blobs.get("research.json")!.text());
    const reader = await inspectReaderBackup(blobs.get("reader.zip")!);
    if (reader.manifest.books.some((entry) => !entry.source))
      throw new Error("完整资料包中的 Reader 书籍缺少源文件");
    return { backup, reader };
  } finally {
    await zip.close();
  }
}
export function bindResearchPackage(
  backup: ResearchBackup,
  bindings: ReadonlyArray<{ book: string; target: string }>,
): ResearchBackup {
  return {
    ...backup,
    library: {
      ...backup.library,
      collections: backup.library.collections.map((collection) => ({
        ...collection,
        excerpts: collection.excerpts.map((item) => {
          const needed = new Set(
            [item, ...(item.links ?? [])].map((entry) => {
              const url = new URL(entry.route, "https://bcr.invalid");
              return url.pathname === "/reader" ? url.searchParams.get("book") : null;
            }),
          );
          const mapped = new Map(
            (item.readerBindings ?? []).map((binding) => [
              binding.book,
              bindings.find((next) => next.book === binding.target)?.target ?? binding.target,
            ]),
          );
          for (const binding of bindings)
            if (needed.has(binding.book) && !mapped.has(binding.book))
              mapped.set(binding.book, binding.target);
          return {
            ...item,
            readerBindings: [...mapped].map(([book, target]) => ({ book, target })),
          };
        }),
      })),
    },
  };
}
export async function restoreResearchPackage(
  prepared: PreparedResearchPackage,
  write: (change: (library: ResearchLibrary) => ResearchLibrary) => Promise<void>,
  report: (message: string) => void,
) {
  const { restoreReaderTransfer } = await import("@bcr/reader-studio/research-transfer");
  const bindings = await restoreReaderTransfer(prepared.reader, report);
  const backup = bindResearchPackage(prepared.backup, bindings);
  try {
    await write((current) => planResearchImport(current, backup).library);
  } catch (error) {
    throw new Error(`源资料已恢复，集合尚未保存；请重试，已恢复书籍不会重复添加：${String(error)}`);
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
    collections: planResearchImport(current, bindResearchPackage(prepared.backup, bindings)),
  };
}
