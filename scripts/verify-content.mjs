import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";

const require = createRequire(new URL("../apps/studio/package.json", import.meta.url));
const { ZipReader, BlobReader, Uint8ArrayWriter } = require("@zip.js/zip.js");
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = collectPageErrors(page),
  shots = ensureShots();
page.setDefaultTimeout(30_000);
const workflow = (p = page) => p.getByRole("navigation", { name: "内容创作流程" });
const tab = (name, p = page) =>
  workflow(p)
    .getByRole("button", { name: new RegExp(name) })
    .click();
const body = () => page.getByLabel("内容项目文稿", { exact: true });
async function selectClaim(text) {
  await body().evaluate((el, text) => {
    const view = el.cmTile.root.view,
      from = view.state.doc.toString().indexOf(text);
    if (from < 0) throw new Error("Claim text not found");
    view.dispatch({ selection: { anchor: from, head: from + text.length }, scrollIntoView: true });
    view.focus();
  }, text);
}
async function downloaded(button, path, p = page) {
  const pending = p.waitForEvent("download", { timeout: 90_000 });
  await button.click();
  const download = await Promise.race([
    pending,
    p
      .locator(".content-alert")
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(async () => {
        throw new Error(await p.locator(".content-alert").innerText());
      }),
  ]);
  await download.saveAs(path);
  return readFile(path);
}
async function zipFiles(bytes) {
  const zip = new ZipReader(new BlobReader(new Blob([bytes]))),
    files = new Map();
  try {
    for (const entry of await zip.getEntries()) {
      assert(!files.has(entry.filename), "no duplicate exported paths");
      files.set(entry.filename, Buffer.from(await entry.getData(new Uint8ArrayWriter())));
    }
    return files;
  } finally {
    await zip.close();
  }
}
async function packageFor(version, p = page) {
  const button = p
    .locator(".content-release")
    .filter({ has: p.getByRole("heading", { name: `版本 ${version}`, exact: true }) })
    .getByRole("button", { name: "下载发布包" });
  return zipFiles(await downloaded(button, `${shots}/content-v${version}.zip`, p));
}
try {
  await page.goto(`${origin}/content`);
  await page.getByRole("button", { name: "创建健身卡示例" }).click();
  await page.getByRole("heading", { name: "这期内容，想回答什么？" }).waitFor();
  const projectUrl = page.url();

  await tab("资料");
  await page.getByLabel("导入价格 CSV 文件").setInputFiles({
    name: "prices.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("parameter,value\nfixed,2400\nvariable,0\nalternative,60\nweeks,52"),
  });
  await page
    .locator(".content-evidence")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("资料标题", { exact: true }).fill("健身卡测试报价");
  await page.getByLabel("网页来源", { exact: true }).fill("https://example.com/gym-prices");
  await page.getByLabel("适用日期", { exact: true }).fill("2026-10-04");
  await page.getByLabel("适用地区", { exact: true }).fill("上海（测试）");
  await page.getByRole("button", { name: "保存证据", exact: true }).click();
  await page.getByRole("heading", { name: "健身卡测试报价", exact: true }).waitFor();
  await tab("模型");
  await page.getByText("参数已保存", { exact: true }).waitFor();
  assert.match(await page.locator(".content-main").innerText(), /41/u);
  await tab("图表");
  await page.locator(".content-visual-preview img").first().waitFor();
  await page.screenshot({ path: `${shots}/content-visuals.png` });

  await tab("文稿");
  const originalClaim = "使用 40 次时两种方案持平，从第 41 次起年卡更便宜。";
  await selectClaim(originalClaim);
  await page.getByRole("button", { name: "绑定选中文本并复核", exact: true }).click();
  await page.locator('.content-claim[data-status="current"]').waitFor();
  await tab("发布与归档");
  await page.getByRole("button", { name: "生成发布快照", exact: true }).click();
  await page.getByRole("heading", { name: "版本 1", exact: true }).waitFor();
  const first = await packageFor(1);
  assert.equal(JSON.parse(first.get("model.json")).result.breakEven.firstCheaper, "41");
  assert.match(first.get("article.md").toString(), /charts\/chart-1\.png/u);
  assert.match(first.get("sources.md").toString(), /example\.com\/gym-prices/u);
  assert.match(first.get("charts/chart-1.svg").toString(), /data:font\/woff;base64/u);
  const png = first.get("cover.png");
  assert.equal(png.readUInt32BE(16), 1440);
  assert.equal(png.readUInt32BE(20), 900);
  await writeFile(`${shots}/content-cover.png`, png);
  // A syntactically valid PNG can still silently omit every glyph if resvg gets WOFF bytes.
  const ink = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(50, 40, 1300, 180).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150 && pixels[i + 1] < 150) dark++;
    return dark;
  }, png.toString("base64"));
  assert(ink > 1000, `PNG must include real title glyphs, found ${ink} pixels`);
  console.log("PASS: evidence, model, bound article, SVG and Chinese PNG export");

  await tab("模型");
  await page.getByLabel("年卡固定费用（元 / 周期）", { exact: true }).fill("3000");
  await page.getByRole("button", { name: "保存并重算", exact: true }).click();
  await page.getByText("参数已保存", { exact: true }).waitFor();
  await tab("文稿");
  await page.locator('.content-claim[data-status="review"]').waitFor();
  assert.match(await body().innerText(), /第 41 次/u, "price changes preserve authored prose");
  await page.getByRole("button", { name: "在知识库打开 ↗", exact: true }).click();
  await page
    .getByRole("complementary", { name: "内容项目复核" })
    .getByText("1 项判断需要复核")
    .waitFor();
  await page.goto(projectUrl);
  await tab("发布与归档");
  await page.getByRole("button", { name: "生成发布快照", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "请先复核" }).waitFor();
  const frozen = await packageFor(1);
  assert.deepEqual(frozen.get("model.json"), first.get("model.json"));
  assert.deepEqual(frozen.get("cover.png"), png, "old releases render identically after editing");

  await tab("文稿");
  await body().evaluate((el) => {
    const view = el.cmTile.root.view,
      text = view.state.doc.toString();
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: text
          .replace("年卡 2400", "年卡 3000")
          .replace("使用 40 次", "使用 50 次")
          .replace("第 41 次", "第 51 次"),
      },
    });
  });
  await page.getByText("文稿已保存到知识库", { exact: true }).waitFor();
  await page.locator('.content-claim[data-status="relink"]').waitFor();
  await selectClaim("使用 50 次时两种方案持平，从第 51 次起年卡更便宜。");
  await page.getByRole("button", { name: "用选中文本重新关联并复核", exact: true }).click();
  await page.locator('.content-claim[data-status="current"]').waitFor();
  await page.screenshot({ path: `${shots}/content-article.png` });
  await tab("发布与归档");
  await page.getByRole("button", { name: "生成发布快照", exact: true }).click();
  await page.getByRole("heading", { name: "版本 2", exact: true }).waitFor();
  const second = await packageFor(2);
  assert.equal(JSON.parse(second.get("model.json")).result.breakEven.firstCheaper, "51");
  console.log("PASS: price invalidation, knowledge review, immutable historical exports");

  await tab("经营记录");
  await page.getByRole("button", { name: "添加发布记录", exact: true }).click();
  await page.getByLabel("发布平台", { exact: true }).fill("测试平台");
  await page.getByLabel("制作工时（小时）", { exact: true }).fill("3.5");
  await page.getByLabel("平台分成（元）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "添加观测指标", exact: true }).click();
  await page.getByLabel("观测值", { exact: true }).fill("1200");
  await page.getByRole("button", { name: "保存发布记录", exact: true }).click();
  await page.getByRole("button", { name: "编辑记录", exact: true }).waitFor();
  await tab("发布与归档");
  const archivePath = `${shots}/content-project.bcr-content.zip`;
  const archive = await downloaded(
    page.getByRole("button", { name: "导出项目归档", exact: true }),
    archivePath,
  );
  const manifest = JSON.parse((await zipFiles(archive)).get("manifest.json"));
  assert.equal(manifest.project.publications[0].platformRevenue, "0");
  assert.equal(manifest.project.publications[0].adRevenue, null);
  assert.equal(manifest.releases.length, 2);
  console.log("PASS: publication metrics and full archive");

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const restored = await fresh.newPage();
  restored.setDefaultTimeout(30_000);
  restored.on("pageerror", (error) => errors.push(error.message));
  await restored.goto(`${origin}/content`);
  async function restore() {
    await restored.getByLabel("选择内容项目归档", { exact: true }).setInputFiles(archivePath);
    await restored.getByRole("button", { name: "恢复项目", exact: true }).click();
    await restored.getByRole("heading", { name: "这期内容，想回答什么？" }).waitFor();
  }
  await restore();
  const restoredUrl = restored.url();
  assert.notEqual(restoredUrl, projectUrl);
  await restore();
  assert.equal(
    await restored.getByLabel("选择内容项目", { exact: true }).locator("option").count(),
    1,
  );
  await restored.reload();
  await tab("文稿", restored);
  await restored.locator('.content-claim[data-status="current"]').waitFor();
  await restored.getByRole("button", { name: "预览图文", exact: true }).click();
  await restored.locator(".content-article-preview img").nth(1).waitFor();
  await tab("发布与归档", restored);
  const reproduced = await packageFor(2, restored);
  assert.deepEqual(
    reproduced.get("cover.png"),
    second.get("cover.png"),
    "fresh storage reproduces snapshot images exactly",
  );
  assert.deepEqual(reproduced.get("article.md"), second.get("article.md"));
  await restored.setViewportSize({ width: 390, height: 844 });
  await tab("模型", restored);
  assert(
    await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "mobile viewport must not overflow",
  );
  await restored.screenshot({ path: `${shots}/content-mobile.png` });
  assert.deepEqual(errors, []);
  console.log(
    "Content workflow verified: sources, precise models, claim review, immutable PNG/SVG releases, metrics, fresh restore, mobile.",
  );
} catch (error) {
  await page.screenshot({ path: `${shots}/content-failure.png` }).catch(() => {});
  console.error(
    (
      await page
        .locator(".content-app")
        .innerText()
        .catch(() => "")
    ).slice(0, 2000),
  );
  throw error;
} finally {
  await browser.close();
}
