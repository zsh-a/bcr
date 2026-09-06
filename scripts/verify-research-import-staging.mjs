import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const errors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  const metrics = await page.evaluate(async () => {
    const loaded = (suffix) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((url) => new URL(url).pathname.endsWith(suffix))
        .at(-1);
    const { createPackageStaging } = await import(loaded("/src/researchPackageStaging.ts"));
    const { createContentHasher, hashReadableStream } = await import(
      loaded("/packages/core/src/index.ts")
    );
    const root = await navigator.storage.getDirectory();
    const temp = await root.getDirectoryHandle("bcr-research-imports-v1", { create: true });
    const names = async () => {
      const entries = [];
      for await (const [name] of temp) entries.push(name);
      return entries;
    };
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const size = 64 * 1024 * 1024;
    const chunk = new Uint8Array(65536).fill(73);
    const hasher = createContentHasher();
    for (let offset = 0; offset < size; offset += chunk.length) hasher.update(chunk);
    const hash = hasher.digest();
    const source = () => {
      let bytes = 0;
      return new ReadableStream({
        pull(controller) {
          if (bytes === size) controller.close();
          else {
            controller.enqueue(chunk);
            bytes += chunk.length;
          }
        },
      });
    };
    const baselineStart = performance.now();
    const baseline = await new Response(source()).blob();
    assert((await hashReadableStream(baseline.stream())) === hash, "baseline hash");
    const baselineMs = performance.now() - baselineStart;
    const heapBefore = performance.memory?.usedJSHeapSize;
    const staging = await createPackageStaging();
    assert(staging.mode === "disk", "OPFS staging unavailable");
    const diskStart = performance.now();
    const file = await staging.write(size, hash, (sink) => source().pipeTo(sink));
    const diskMs = performance.now() - diskStart;
    assert(file instanceof File && file.size === size, "Expected a disk-backed File");
    assert((await hashReadableStream(file.stream())) === hash, "staged hash");
    const lease = staging.acquire();
    await staging.dispose();
    assert((await names()).length === 1, "Active restore lease lost its files");
    await lease();
    assert((await names()).length === 0, "Preview files leaked");
    const active = await createPackageStaging();
    const another = await createPackageStaging();
    assert((await names()).length === 2, "Sweep deleted an active session");
    await another.dispose();
    await active.dispose();
    const controller = new AbortController();
    const cancelled = await createPackageStaging(controller.signal);
    let rejected = false;
    try {
      await cancelled.write(size, hash, async (sink) => {
        const writer = sink.getWriter();
        await writer.write(chunk);
        controller.abort();
        try {
          await writer.write(chunk);
        } finally {
          writer.releaseLock();
        }
      });
    } catch (error) {
      rejected = error.name === "AbortError";
    }
    await cancelled.dispose();
    assert(rejected && (await names()).length === 0, "Cancelled extraction leaked");
    const quota = await createPackageStaging();
    const estimate = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ quota: 1, usage: 1 });
    let quotaRejected = false;
    try {
      await quota.write(size, hash, (sink) => source().pipeTo(sink));
    } catch (error) {
      quotaRejected = error.message.includes("空间不足");
    } finally {
      navigator.storage.estimate = estimate;
      await quota.dispose();
    }
    assert(quotaRejected && (await names()).length === 0, "Quota failure leaked");
    const failedWrite = await createPackageStaging();
    const nativeWrite = FileSystemWritableFileStream.prototype.write;
    FileSystemWritableFileStream.prototype.write = async function (data) {
      await nativeWrite.call(this, data);
      throw new DOMException("disk filled during write", "QuotaExceededError");
    };
    let writeRejected = false;
    try {
      await failedWrite.write(size, hash, (sink) => source().pipeTo(sink));
    } catch (error) {
      writeRejected = error.message.includes("空间不足");
    } finally {
      FileSystemWritableFileStream.prototype.write = nativeWrite;
      await failedWrite.dispose();
    }
    assert(writeRejected && (await names()).length === 0, "Partially written quota failure leaked");
    // PDF object URLs must outlive temporary files and reuse of the same source.
    const transferUrl =
      loaded("/apps/reader-studio/src/researchTransfer.ts") ??
      new URL("./researchTransfer.ts", loaded("/apps/reader-studio/src/store.ts")).href;
    const { decodeReaderBackup, restoreReaderTransfer, readerTransferState } = await import(
      transferUrl
    );
    const body = "BT /F1 12 Tf 20 100 Td (Durable source) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    for (const [index, object] of objects.entries()) {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const pdfBlob = new Blob([pdf]);
    const pdfHash = await hashReadableStream(pdfBlob.stream());
    const pdfStaging = await createPackageStaging();
    const pdfFile = await pdfStaging.write(pdfBlob.size, pdfHash, (sink) =>
      pdfBlob.stream().pipeTo(sink),
    );
    const manifest = decodeReaderBackup({
      format: "bcr-reader-backup",
      version: 1,
      createdAt: 1,
      settings: readerTransferState().state.settings,
      progressByBook: {},
      bookmarksByBook: {},
      annotationsByBook: {},
      books: [
        {
          book: {
            id: "pdf",
            title: "Durable PDF",
            source: {
              name: "durable.pdf",
              mime: "application/pdf",
              format: "pdf",
              size: pdfBlob.size,
            },
            sections: [
              {
                id: "page",
                order: 0,
                label: "Page 1",
                kind: "pdf-page",
                text: "Durable source",
                pageNumber: 1,
              },
            ],
            importedAt: 1,
            updatedAt: 1,
            tags: [],
          },
          source: { path: `sources/${pdfHash}`, hash: pdfHash, size: pdfBlob.size },
        },
      ],
    });
    const prepared = { manifest, sources: new Map([[`sources/${pdfHash}`, pdfFile]]) };
    const first = await restoreReaderTransfer(prepared, () => {});
    const second = await restoreReaderTransfer(
      {
        ...prepared,
        manifest: {
          ...manifest,
          books: manifest.books.map((entry) => ({
            ...entry,
            book: { ...entry.book, title: "Another PDF snapshot" },
          })),
        },
      },
      () => {},
    );
    await pdfStaging.dispose();
    for (const binding of [...first, ...second]) {
      const book = readerTransferState().state.library.find((book) => book.id === binding.target);
      assert(
        (await (await fetch(book.source.objectUrl)).text()).startsWith("%PDF"),
        "PDF lost its source after temporary cleanup",
      );
    }
    window.__orphan = await createPackageStaging();
    await window.__orphan.write(size, hash, (sink) => source().pipeTo(sink));
    return {
      bytes: size,
      baselineBlobMs: Math.round(baselineMs),
      diskStreamingMs: Math.round(diskMs),
      jsHeapBefore: heapBefore,
      jsHeapAfter: performance.memory?.usedJSHeapSize,
    };
  });
  // Closing the page releases its Web Lock. A new session reclaims the orphan.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await reopened.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((url) => new URL(url).pathname.endsWith("/src/researchPackageStaging.ts"))
      .at(-1);
    const { createPackageStaging } = await import(url);
    const staging = await createPackageStaging();
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("bcr-research-imports-v1");
    let count = 0;
    for await (const _entry of root) count++;
    if (count !== 1) throw new Error("Orphan was not reclaimed");
    await staging.dispose();
  });
  assert.deepEqual(errors, []);
  console.log("Research import staging PASSED", JSON.stringify(metrics));
  console.log(
    "Timing is a 64 MiB sink microbenchmark; JS heap metrics exclude Blob/native/parser memory.",
  );
  await context.close();
} finally {
  await browser.close();
}
