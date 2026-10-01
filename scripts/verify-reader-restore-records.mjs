import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";
import { trackModuleRequests } from "./lib/modules.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
const directory = await mkdtemp(join(tmpdir(), "bcr-reader-record-restore-"));
const errors = [];
const file = {
  name: "restore-records.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(
    [
      "Restore records",
      "第一章 阅读",
      ...Array.from(
        { length: 8 },
        (_, index) => `第 ${index} 段 ${"在书页之间记录思考。".repeat(8)}`,
      ),
    ].join("\n\n"),
  ),
};
async function attachStore(page) {
  await page.evaluate(async () => {
    const urls = await window.__bcrTestModuleUrls();
    window.restoreAudit = await import(
      urls.find((url) => new URL(url).pathname.endsWith("/packages/reader-studio/src/store.ts"))
    );
  });
}
async function openBackup(page) {
  const library = page.getByRole("button", { name: "打开书库", exact: true });
  if (await library.isVisible()) await library.click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
}
async function start(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await trackModuleRequests(page);
  await page.goto(`${origin}/pwa/reader/`);
  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles(file);
  await page.getByText("导入完成", { exact: true }).waitFor();
  await attachStore(page);
  return page;
}
try {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const source = await start(sourceContext);
  await source.evaluate(() => {
    const { reader, getReaderState } = window.restoreAudit;
    const state = getReaderState();
    const original = state.library.find((book) => !book.tags.includes("DEMO"));
    const book = {
      ...original,
      id: "remote-publication",
      title: "备份书名",
      sections: original.sections.map((section, index) => ({
        ...section,
        id: `remote-section-${index}`,
      })),
      toc: undefined,
    };
    const locator = { kind: "section", sectionId: book.sections[3].id, progression: 0.6 };
    const bookmark = { id: "shared-bookmark", label: "备份书签", locator, createdAt: 10 };
    const note = {
      id: "shared-note",
      label: "备份笔记",
      locator,
      createdAt: 10,
      updatedAt: 12,
      note: "备份中编辑的笔记",
    };
    reader.hydrate(
      [book],
      { [book.id]: { locator, percentage: 0.3, updatedAt: 12 } },
      state.settings,
      {
        [book.id]: [
          bookmark,
          { ...bookmark, id: "remote-bookmark", label: "新增书签", createdAt: 20 },
        ],
      },
      book.id,
      {
        [book.id]: [
          note,
          { ...note, id: "remote-note", note: "仅在备份中的笔记", createdAt: 20, updatedAt: 20 },
        ],
      },
    );
  });
  await openBackup(source);
  await source.getByRole("button", { name: "生成完整备份", exact: true }).click();
  const link = source.locator(".reader-data-download");
  await link.waitFor();
  const downloaded = source.waitForEvent("download");
  await link.click();
  const archive = join(directory, "records.zip");
  await (await downloaded).saveAs(archive);
  await sourceContext.close();

  const targetContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const target = await start(targetContext);
  await target.evaluate(() => {
    const { reader, getReaderState } = window.restoreAudit;
    const state = getReaderState();
    const original = state.library.find((book) => !book.tags.includes("DEMO"));
    const book = { ...original, title: "本机书名", favorite: true };
    const locator = { kind: "section", sectionId: book.sections[1].id, progression: 0.2 };
    const recordLocator = { kind: "section", sectionId: book.sections[3].id, progression: 0.6 };
    reader.hydrate(
      [book],
      { [book.id]: { locator, percentage: 0.1, updatedAt: 50 } },
      state.settings,
      {
        [book.id]: [
          { id: "shared-bookmark", label: "本机书签", locator: recordLocator, createdAt: 10 },
        ],
      },
      book.id,
      {
        [book.id]: [
          {
            id: "shared-note",
            label: "本机笔记",
            locator: recordLocator,
            createdAt: 10,
            updatedAt: 50,
            note: "本机最新的笔记",
          },
        ],
      },
    );
  });
  await openBackup(target);
  await target.getByLabel("选择 Reader 备份", { exact: true }).setInputFiles(archive);
  await target
    .getByRole("heading", { name: "新增 0 本 · 合并 1 本 · 保留 0 本", exact: true })
    .waitFor();
  await target.getByText(/导入 2 个书签、2 条笔记.*2 条不同版本均保留/u).waitFor();
  const before = await target.evaluate(() => {
    const state = window.restoreAudit.getReaderState();
    return {
      id: state.activeBookId,
      sequence: state.navigationSequence,
      section: state.activeSectionId,
    };
  });
  await target.getByRole("button", { name: "确认合并恢复", exact: true }).click();
  await target
    .getByText(/^恢复完成，已新增 0 本读物，合并 1 本已有读物，导入 4 条阅读记录/u)
    .waitFor();
  const merged = await target.evaluate(() => {
    const state = window.restoreAudit.getReaderState();
    const book = state.library[0];
    return {
      book: { id: book.id, title: book.title, favorite: book.favorite },
      active: state.activeBookId,
      sequence: state.navigationSequence,
      section: state.activeSectionId,
      bookmarks: state.bookmarksByBook[book.id],
      notes: state.annotationsByBook[book.id],
      expected: book.sections[3].id,
      remoteNotes: state.annotationsByBook["remote-publication"],
    };
  });
  assert.deepEqual(merged.book, { id: before.id, title: "本机书名", favorite: true });
  assert.equal(merged.active, before.id);
  assert.equal(merged.sequence, before.sequence);
  assert.equal(merged.section, before.section);
  assert.equal(merged.bookmarks.length, 3);
  assert.equal(merged.notes.length, 3);
  assert(merged.notes.some((note) => note.note === "本机最新的笔记"));
  assert(merged.notes.some((note) => note.note === "备份中编辑的笔记"));
  assert(merged.notes.every((note) => note.locator.sectionId === merged.expected));
  assert.equal(merged.remoteNotes, undefined);
  await target.getByLabel("选择 Reader 备份", { exact: true }).setInputFiles(archive);
  await target
    .getByRole("heading", { name: "新增 0 本 · 合并 0 本 · 保留 1 本", exact: true })
    .waitFor();
  assert(await target.getByRole("button", { name: "确认合并恢复", exact: true }).isDisabled());
  await target.getByRole("button", { name: "关闭备份与恢复", exact: true }).click();
  await target.reload();
  await target.getByLabel("阅读内容", { exact: true }).waitFor();
  await attachStore(target);
  const reloaded = await target.evaluate(() => {
    const state = window.restoreAudit.getReaderState();
    return {
      title: state.library[0].title,
      favorite: state.library[0].favorite,
      notes: state.annotationsByBook[state.library[0].id].length,
    };
  });
  assert.deepEqual(reloaded, { title: "本机书名", favorite: true, notes: 3 });
  await targetContext.close();

  const mobileContext = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await start(mobileContext);
  await openBackup(phone);
  await phone.getByLabel("选择 Reader 备份", { exact: true }).setInputFiles(archive);
  await phone
    .getByRole("heading", { name: "新增 0 本 · 合并 1 本 · 保留 0 本", exact: true })
    .waitFor();
  await phone.getByRole("button", { name: "确认合并恢复", exact: true }).click();
  await phone
    .getByText(/^恢复完成，已新增 0 本读物，合并 1 本已有读物，导入 4 条阅读记录/u)
    .waitFor();
  assert.equal(
    await phone.evaluate(() => {
      const state = window.restoreAudit.getReaderState();
      return state.annotationsByBook[state.activeBookId].length;
    }),
    2,
  );
  await mobileContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "Reader record restore PASSED: verified ZIP, distinct source identities, both edited versions, repeat restore, active read, durable metadata and iPhone merge",
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
