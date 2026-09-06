import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { BlobWriter, TextReader, ZipWriter } = require("@zip.js/zip.js");
async function zip(entries) {
  const writer = new ZipWriter(new BlobWriter());
  for (const [name, text] of Object.entries(entries)) await writer.add(name, new TextReader(text));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
const art =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#cde"/></svg>';
const chapters = Array.from({ length: 40 }, (_, index) => `chapter-${index}.xhtml`);
const epub = await zip({
  mimetype: "application/epub+zip",
  "META-INF/container.xml":
    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  "book.opf": `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Deferred EPUB</dc:title></metadata><manifest>${chapters.map((href, i) => `<item id="c${i}" href="${href}" media-type="application/xhtml+xml"/>`).join("")}<item id="art" href="art.svg" media-type="image/svg+xml"/></manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
  "art.svg": art,
  ...Object.fromEntries(
    chapters.map((href, i) => [
      href,
      `<html><head><title>Chapter ${i}</title></head><body><p>${i === 39 ? "NeedleFinal" : "Chapter"} ${i} ${"Content ".repeat(50)}</p><img src="art.svg"/></body></html>`,
    ]),
  ),
});
const cbz = await zip(
  Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`page-${i + 1}.svg`, art])),
);
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: 40 }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count 40 >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < 40; i++) {
    const content = `BT /F1 20 Tf 40 700 Td (${i === 39 ? "NeedleFinal" : "Content"} page ${i + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let raw = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(raw));
    raw += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(raw);
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(raw);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  await page.getByLabel("导入阅读文件").waitFor();
  // Use the live module URLs so this exercises the same provider registry as the UI.
  async function run(name, buffer, query) {
    return page.evaluate(
      async ({ name, bytes, query }) => {
        const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
        const base = urls
          .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
          .at(-1);
        const load = (file) =>
          import(
            urls
              .filter((url) => new URL(url).pathname.endsWith(`/apps/reader-studio/src/${file}`))
              .at(-1) ?? new URL(file, base).toString()
          );
        const { importReaderFile } = await load("readerImports.ts");
        const { readerRuntime, createReaderRuntime } = await load("readerRuntimeCore.ts");
        const content = await load("readerContent.ts");
        const { persistBook, persistReader, restoreReader } = await load("readerPersistence.ts");
        const runtime = readerRuntime() ?? (await createReaderRuntime());
        const book = await importReaderFile(runtime, new File([new Uint8Array(bytes)], name));
        const cold = book.sections.every(
          (section) =>
            section.contentInfo && section.text === "" && !section.html && !section.imageUrl,
        );
        const last = book.sections.at(-1);
        const before = persistBook(book);
        const hits = await content.searchReaderContent(book, query);
        const coldAfterSearch = book.sections.every(
          (section) => !content.sectionContentReady(section),
        );
        const unpin = content.subscribeSectionContent(last, () => {});
        await content.loadSectionContent(last);
        const loaded = content.sectionContentReady(last);
        const images = content.sectionImages(last);
        const imageValid = await Promise.all(
          images.map(
            (src) =>
              new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve(image.naturalWidth > 0);
                image.onerror = () => resolve(false);
                image.src = src;
              }),
          ),
        );
        const snapshotStable = JSON.stringify(before) === JSON.stringify(persistBook(book));
        unpin();
        const released = book.sections.every((section) => !content.sectionContentReady(section));
        const repin = content.subscribeSectionContent(last, () => {});
        await content.loadSectionContent(last);
        const reloaded = content.sectionContentReady(last);
        repin();
        const { reader, getReaderState } = await load("store.ts");
        const state = { ...getReaderState(), library: [book], activeBookId: book.id };
        await persistReader(runtime, state);
        const projection = await restoreReader(runtime, { deferBinary: true });
        const coldBook = projection.books.find((item) => item.id === book.id);
        const coldHits = await content.searchReaderContent(coldBook, query);
        const coldRestoreSearch = coldHits.some((hit) => hit.sectionId === last.id);
        content.releaseBookResources(coldBook);
        const { createReaderBackup, inspectReaderBackup, prepareReaderRestore } =
          await load("readerBackup.ts");
        const backup = await inspectReaderBackup(await createReaderBackup(runtime, state));
        // Derived block caches must be rebuildable using only the portable source.
        for (const path of await runtime.binary.list("reader/content-v1/"))
          await runtime.binary.delete(path);
        const [restored] = await prepareReaderRestore(runtime, backup, []);
        const restoredHits = await content.searchReaderContent(restored, query);
        const portable = restoredHits.some((hit) => hit.sectionId === last.id);
        content.releaseBookResources(restored);
        reader.addBook(book);
        reader.openBook(book.id, last.id);
        return {
          portable,
          coldRestoreSearch,
          cold,
          coldAfterSearch,
          loaded,
          released,
          reloaded,
          imageValid,
          snapshotStable,
          hits: hits.map((hit) => hit.sectionId),
          lastId: last.id,
          count: book.sections.length,
        };
      },
      { name, bytes: [...buffer], query },
    );
  }
  for (const [name, bytes, query] of [
    ["deferred.epub", epub, "NeedleFinal"],
    ["deferred.cbz", cbz, "Page 40"],
    ["deferred.pdf", pdf(), "NeedleFinal"],
    [
      "deferred.fb2",
      Buffer.from(
        `<FictionBook><body>${Array.from({ length: 40 }, (_, i) => `<section><title>Chapter ${i}</title><p>${"Structured body ".repeat(600)} ${i === 39 ? "NeedleFinal" : ""}</p></section>`).join("")}</body></FictionBook>`,
      ),
      "NeedleFinal",
    ],
    [
      "deferred.md",
      Buffer.from("# Modern reader\n\n" + "Paragraph ".repeat(40000) + " NeedleFinal"),
      "NeedleFinal",
    ],
  ]) {
    const result = await run(name, bytes, query);
    assert(
      result.cold && result.coldAfterSearch,
      `${name}: index/search must not retain display content`,
    );
    assert(
      result.portable &&
        result.coldRestoreSearch &&
        result.loaded &&
        result.released &&
        result.reloaded &&
        result.snapshotStable,
      `${name}: lifecycle and snapshot`,
    );
    assert(result.imageValid.every(Boolean), `${name}: image decoding`);
    assert(result.hits.includes(result.lastId), `${name}: unloaded final section search`);
    await page.waitForFunction(
      ({ lastId, name }) => {
        if (name.endsWith(".cbz"))
          return [...document.querySelectorAll(".reader-comic-pages img")].some(
            (image) => image.complete && image.naturalWidth > 0,
          );
        const target = [...document.querySelectorAll("[data-reader-section]")].find(
          (element) => element.getAttribute("data-reader-section") === lastId,
        );
        if (name.endsWith(".pdf")) return target?.querySelector("canvas")?.width > 0;
        return target?.getAttribute("data-reader-content-ready") === "true";
      },
      { lastId: result.lastId, name },
    );
    console.log(name, result);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
