import type { Entry, FileEntry } from "@zip.js/zip.js";

export type MangaFileFormat = "image" | "cbz" | "pdf" | "unknown";

const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|webp|svg)$/iu;

export function formatForMangaFile(file: Pick<File, "name" | "type">): MangaFileFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  if (
    extension === "cbz" ||
    extension === "zip" ||
    file.type === "application/vnd.comicbook+zip" ||
    file.type === "application/zip"
  ) {
    return "cbz";
  }
  if (extension === "pdf" || file.type === "application/pdf") return "pdf";
  return "unknown";
}

export interface ExpandArchiveOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((value: number) => void) | undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function archiveMime(path: string): string {
  const extension = path.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "png") return "image/png";
  if (extension === "bmp") return "image/bmp";
  if (extension === "avif") return "image/avif";
  return "image/jpeg";
}

function pageName(name: string, index: number, extension: string): string {
  const basename = name.replace(/\.[^.]+$/u, "") || "manga";
  return `${basename}-${String(index + 1).padStart(4, "0")}.${extension}`;
}

function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  if (mime === "image/avif") return "avif";
  if (mime === "image/svg+xml") return "svg";
  return "jpg";
}

function imageEntries(entries: ReadonlyArray<Entry>): ReadonlyArray<FileEntry> {
  return entries
    .filter(
      (entry): entry is FileEntry => !entry.directory && IMAGE_EXTENSIONS.test(entry.filename),
    )
    .sort((left, right) =>
      left.filename.localeCompare(right.filename, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

async function expandCbz(file: File, options: ExpandArchiveOptions): Promise<ReadonlyArray<File>> {
  const { BlobReader, BlobWriter, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = imageEntries(await reader.getEntries());
    if (entries.length === 0) throw new Error("CBZ 中没有可读图片");
    const files: File[] = [];
    for (const [index, entry] of entries.entries()) {
      throwIfAborted(options.signal);
      const mime = archiveMime(entry.filename);
      const blob = await entry.getData(new BlobWriter(mime));
      files.push(
        new File([blob], pageName(file.name, index, extensionForMime(mime)), {
          type: mime,
          lastModified: Date.now(),
        }),
      );
      options.onProgress?.((index + 1) / entries.length);
    }
    return files;
  } finally {
    await reader.close();
  }
}

async function expandPdf(file: File, options: ExpandArchiveOptions): Promise<ReadonlyArray<File>> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const objectUrl = URL.createObjectURL(file);
  try {
    const pdfDocument = await pdfjs.getDocument(objectUrl).promise;
    const files: File[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        throwIfAborted(options.signal);
        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2400 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error(`PDF 第 ${pageNumber} 页无法创建画布`);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (blob === null) throw new Error(`PDF 第 ${pageNumber} 页无法导出图片`);
        files.push(
          new File([blob], pageName(file.name, pageNumber - 1, "png"), {
            type: "image/png",
            lastModified: Date.now(),
          }),
        );
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        options.onProgress?.(pageNumber / pdfDocument.numPages);
      }
    } finally {
      await pdfDocument.cleanup();
    }
    return files;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Expand an archive into image Files so the existing page queue remains the unit of work. */
export async function expandMangaArchive(
  file: File,
  options: ExpandArchiveOptions = {},
): Promise<ReadonlyArray<File>> {
  const format = formatForMangaFile(file);
  if (format === "cbz") return expandCbz(file, options);
  if (format === "pdf") return expandPdf(file, options);
  throw new Error(`${file.name} 不是可展开的 CBZ/PDF 文件`);
}
