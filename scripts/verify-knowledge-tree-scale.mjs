import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { launchEphemeralBrowser, collectPageErrors } from "./lib/browser.mjs";
const require = createRequire(new URL("../apps/studio/package.json", import.meta.url));
const { ZipWriter, Uint8ArrayWriter, TextReader } = await import(require.resolve("@zip.js/zip.js"));
const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
await writer.add(
  "knowledge/manifest.json",
  new TextReader(JSON.stringify({ format: "bcr-knowledge", version: 2 })),
);
for (let i = 0; i < 300; i++) {
  const id = `scale-${String(i).padStart(4, "0")}`;
  const metadata = {
    bcr: 2,
    id,
    title: `规模笔记${String(i).padStart(4, "0")}`,
    path: `规模/${id}.md`,
    tags: [],
    collectionId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  await writer.add(`knowledge/citations/${id}.json`, new TextReader("[]"));
  await writer.add(
    `knowledge/notes/${id}.md`,
    new TextReader(`---\n${JSON.stringify(metadata)}\n---\n规模测试。`),
  );
}
const archive = Buffer.from(await writer.close());
const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
const errors = collectPageErrors(page);
const tree = () => page.locator(".knowledge-note-list .knowledge-file-tree");
const folder = () =>
  tree()
    .locator("summary")
    .filter({ hasText: /^规模$/u });
try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const restore = page.getByRole("menuitem", { name: "恢复 ZIP 备份", exact: true });
  if (!(await restore.isVisible()))
    await page.getByRole("menuitem", { name: "笔记库管理", exact: true }).click();
  await restore.click();
  await page
    .getByLabel("选择知识库备份", { exact: true })
    .setInputFiles({ name: "scale.zip", mimeType: "application/zip", buffer: archive });
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await tree().locator('[aria-current="page"]').waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".knowledge-note-list .knowledge-file-tree")?.dataset.virtual ===
      "true",
  );
  assert.ok(
    (await tree().locator(".knowledge-file-note").count()) < 45,
    "300 notes mount only a viewport and overscan",
  );
  await folder().click();
  assert.equal(
    await tree().locator(".knowledge-file-note").count(),
    0,
    "collapsed notes are not mounted",
  );
  await folder().press("ArrowRight");
  await folder().press("ArrowRight");
  await page.waitForFunction(() =>
    document.activeElement?.getAttribute("title")?.includes("scale-0000.md"),
  );
  await page.keyboard.press("End");
  await page.waitForFunction(() =>
    document.activeElement?.getAttribute("title")?.includes("scale-0299.md"),
  );
  assert.ok((await tree().locator(".knowledge-file-note").count()) < 45);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.searchParams.get("note") === "scale-0299");
  await page.getByLabel("笔记标题", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("笔记标题", { exact: true }).inputValue(), "规模笔记0299");
  await tree().locator('[aria-current="page"]').press("Home");
  await folder().waitFor({ state: "visible" });
  await folder().press("ArrowLeft");
  assert.equal(await tree().locator(".knowledge-file-note").count(), 0);
  await folder().press("Enter");
  await tree().locator(".knowledge-file-note").first().waitFor();
  await tree().locator(".knowledge-file-note").first().click({ button: "right" });
  await page.getByRole("menu", { name: "目录树操作", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "knowledge tree scale PASSED: 300-note viewport rendering, unmounted collapsed branches, keyboard navigation across virtual boundaries, opening last note, context menus",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
