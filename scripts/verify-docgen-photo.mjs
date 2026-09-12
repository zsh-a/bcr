import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.BCR_SCENE_URL ?? "http://127.0.0.1:5209";
const output = process.env.BCR_SCENE_OUTPUT ?? "/tmp/bcr-scene-renderer";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const executablePath =
  process.env.BCR_BROWSER_PATH ??
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath());
const browser = await chromium.launch({
  executablePath,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--enable-unsafe-webgpu",
    "--use-angle=swiftshader",
  ],
});
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(
    requests.some(
      (url) => url.includes("scene-renderer/src/renderer") || url.includes("three_webgpu"),
    ),
    false,
    "GPU engine was eagerly loaded",
  );
  await page
    .getByRole("button", { name: /新加坡/ })
    .first()
    .click();
  await page.getByRole("button", { name: "随机地址", exact: true }).click();
  await page.locator("aside input").first().fill("Sample Person");
  await page.getByLabel("拍摄场景", { exact: true }).selectOption("studio");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await page.locator('img[alt="账单预览"]').waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "实拍 JPG", exact: true }).click();
  const preview = page.getByAltText("实拍合成预览");
  const size = await preview.evaluate(async (img) => {
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
  assert.deepEqual(size, [1620, 2160]);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载实拍 JPG", exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /-photo\.jpg$/);
  await download.saveAs(`${output}/docgen-ui-download.jpg`);
  await page.screenshot({ path: `${output}/docgen-ui.png` });

  const cases = await page.evaluate(async (root) => {
    const { TEMPLATES, randomAddress, mulberry32, validateBillInput } = await import(
      `/@fs${root}/packages/docgen-core/src/index.ts`
    );
    return TEMPLATES.map((template, i) => {
      const input = {
        docType: template.docType,
        name: "Sample Person",
        address: randomAddress(template.regionId, mulberry32(42 + i)),
        billDate: "2026-09-05",
      };
      if (!validateBillInput(template, input).ok)
        throw new Error(`Invalid fixture: ${template.docType}`);
      return input;
    });
  }, root);
  for (const input of cases) {
    const result = await page.evaluate(
      async ({ root, input }) => {
        const { generateBill } = await import(`/@fs${root}/packages/docgen-core/src/dom.ts`);
        const start = performance.now();
        const result = await generateBill(input, { watermark: true });
        const photo = await createImageBitmap(result.paperJpeg);
        const document = await createImageBitmap(result.documentPng);
        const size = [photo.width, photo.height];
        const expected = document.width > document.height ? [2160, 1620] : [1620, 2160];
        photo.close();
        document.close();
        return {
          size,
          expected,
          ms: performance.now() - start,
          bytes: [...new Uint8Array(await result.paperJpeg.arrayBuffer())],
        };
      },
      { root, input },
    );
    assert.deepEqual(result.size, result.expected);
    await writeFile(`${output}/docgen-${input.docType}.jpg`, Buffer.from(result.bytes));
    console.log(
      JSON.stringify({
        template: input.docType,
        size: result.size,
        ms: result.ms,
        bytes: result.bytes.length,
      }),
    );
  }
  assert.deepEqual(errors, []);
  console.log(`Docgen photo UI/download and ${cases.length} templates passed.`);
} finally {
  await browser.close();
}
