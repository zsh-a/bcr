import assert from "node:assert/strict";
import path from "node:path";
import { baseUrl, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(baseUrl("http://localhost:5202")).origin;
const tag = new URL(origin).port || "default",
  shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
const page = await context.newPage(),
  errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
    external.push(url.href);
    await route.abort();
  } else await route.continue();
});
const section = () => page.locator(".research-events");
async function navigate(search) {
  await page.evaluate((url) => {
    history.pushState(null, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/markets?${search}`);
  await page.locator(".research-workbench").waitFor();
}
async function noOverflow() {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert(await section().evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
}
try {
  await page.goto(`${origin}/markets?view=macro&layer=research&countries=CHN,USA,JPN,DEU`, {
    waitUntil: "networkidle",
  });
  await section().waitFor();
  const first = section().locator(".research-event-rail button").first();
  assert((await first.innerText()).includes("2026-10-19"));
  assert((await first.innerText()).includes("央行提出非银流动性工具"));
  assert((await section().locator(".research-event-coverage").innerText()).includes("2026-10-27"));
  assert((await section().innerText()).includes("精选事件库 · 非实时新闻"));
  assert((await section().innerText()).includes("中美发布日内瓦经贸会谈联合声明"));

  await navigate(
    "view=macro&layer=research&countries=CHN,USA&rFrom=2008-01-01&rTo=2009-12-31&rDate=2009-12-31&rAsOf=date",
  );
  assert(!(await section().locator(".research-event-rail").innerText()).includes("2026-10-19"));
  await section().getByRole("button", { name: "近两年", exact: true }).click();
  const recent = section().locator(".research-event-rail button").first();
  assert((await recent.innerText()).includes("2026-10-19"));
  assert((await recent.innerText()).includes("窗口外"));
  assert.equal(
    new URL(page.url()).searchParams.get("rTo"),
    "2009-12-31",
    "Browsing recent context does not silently change the historical chart window",
  );
  await recent.click();
  await page.waitForFunction(
    () => new URLSearchParams(location.search).get("rEvent") === "pboc-liquidity-framework-2026",
  );
  assert.equal(new URL(page.url()).searchParams.get("rAsOf"), "date");
  assert(new URL(page.url()).searchParams.get("rTo") >= "2026-10-19");
  const detail = section().locator(".research-event-detail");
  assert((await detail.innerText()).includes("拟设"));
  const source = detail.locator("a").first();
  assert((await source.getAttribute("href")).startsWith("https://www.pbc.gov.cn/"));
  assert((await source.getAttribute("rel")).includes("noopener"));
  assert.equal(await source.getAttribute("target"), "_blank");
  assert(
    (await page.locator(".research-panel .research-chart-event-note").allTextContents()).every(
      (note) => note.includes("2026-10-19"),
    ),
  );

  await navigate("view=macro&layer=research&countries=GBR&rFrom=2024-01-01&rTo=2026-10-23");
  await section().getByRole("button", { name: "近两年", exact: true }).click();
  const uk = await section().locator(".research-event-rail").innerText();
  assert(uk.includes("英国央行宣布将银行利率下调至4%"));
  assert(uk.includes("中东战事升级"));
  assert(!uk.includes("央行提出非银流动性工具"), "Recent scope retains the country filter");
  assert(!uk.includes("中美发布日内瓦"));

  await navigate(
    "view=macro&layer=research&countries=CHN&rFrom=1980-12-31&rTo=1980-12-31&rDate=1980-12-31&rAsOf=date",
  );
  await section().getByRole("button", { name: "当前窗口", exact: true }).click();
  assert.equal(await section().locator(".research-event-rail button").count(), 0);
  assert((await section().innerText()).includes("当前范围暂无收录事件"));
  await section().getByRole("button", { name: "全部收录", exact: true }).click();
  assert((await section().locator(".research-event-rail button").count()) > 10);

  for (const theme of ["light", "dark"])
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await section().scrollIntoViewIfNeeded();
      await noOverflow();
      await page.screenshot({
        path: path.join(shots, `recent-events-${tag}-${theme}-${width}.png`),
      });
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    history.pushState(
      null,
      "",
      "/markets?view=macro&layer=history&countries=CHN&from=1990&to=2025",
    );
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "查看近期事件", exact: true }).waitFor();
  assert((await page.locator(".macro-history-section").innerText()).includes("年度窗口"));
  await page.getByRole("button", { name: "查看近期事件", exact: true }).click();
  await section().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("layer"), "research");
  assert.equal(new URL(page.url()).searchParams.get("countries"), "CHN");
  assert(
    (await section().locator(".research-event-rail button").first().innerText()).includes(
      "2026-10-19",
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `Recent events PASS ${origin}: recent-first coverage, source/announcement notes, window/recent/all, country scope, all-panel event focus, annual handoff and mobile reflow; no external fetches.`,
  );
} catch (error) {
  console.error(`Failed at ${page.url()}`);
  await page
    .screenshot({ path: path.join(shots, `recent-events-${tag}-failure.png`) })
    .catch(() => {});
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
