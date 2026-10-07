import { existsSync, readFileSync, realpathSync, lstatSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { chromium } from "playwright-core";
import {
  installPageReview,
  decode,
  PageStateSchema,
  type PageState,
  type PageElement,
} from "@bcr/work-core";
import { prepareBrowser } from "@bcr/work-engine/browser";
import { hash, json } from "./projects";

const directory = process.argv[2]!;
const input = json(join(directory, "input.json")) as {
  page: PageState;
  document?: string;
  site?: string;
  manifest?: Record<string, string>;
  assetRoot?: string;
};
const state = decode(PageStateSchema, input.page);
const origin = "https://bcr-page.invalid";
const path = `/${state.path.split("/").map(encodeURIComponent).join("/")}`;
type PageApi = {
  capture(): Promise<PageState>;
  restore(state: PageState): Promise<string[]>;
  elements(): PageElement[];
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: await prepareBrowser(), headless: true });
  const context = await browser.newContext({
    viewport: state.viewport,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.routeWebSocket("**/*", (route) => route.close());
  let blocked = false,
    integrityError = false;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blocked = true;
      return route.abort();
    }
    if (input.document !== undefined && url.pathname === path)
      return route.fulfill({ contentType: "text/html", body: input.document });
    try {
      const name = decodeURIComponent(url.pathname.slice(1));
      if (!input.site || !input.manifest || !Object.hasOwn(input.manifest, name))
        return route.abort();
      const root =
        !existsSync(join(input.site, name)) && name.startsWith("public/") && input.assetRoot
          ? input.assetRoot
          : input.site;
      const file = join(root, name),
        rel = relative(realpathSync(root), realpathSync(file));
      if (rel.startsWith("..") || isAbsolute(rel) || !lstatSync(file).isFile())
        return route.abort();
      const bytes = readFileSync(file);
      if (hash(bytes) !== input.manifest[name]) {
        integrityError = true;
        throw new Error("页面文件校验失败");
      }
      return route.fulfill({ contentType: Bun.file(file).type, body: bytes });
    } catch {
      return route.abort();
    }
  });
  await context.addInitScript(installPageReview);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.dismiss());
  const response = await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 15000 });
  if (!response?.ok()) throw new Error("无法打开固定的页面产物");
  const warnings = await page.evaluate(async (value) => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
    const api = (window as unknown as { __bcrPageReview: PageApi }).__bcrPageReview;
    return api.restore(value);
  }, state);
  // Replay is best effort. Pin the rendered pixels; do not claim to clone the user's JS heap.
  const animations = await page.evaluate(() => {
    const items = document.getAnimations();
    for (const animation of items) animation.pause();
    return items.length;
  });
  if (animations) warnings.push("页面动画已暂停在重放时刻；动画时间未包含在普通控件状态中。");
  await page.screenshot({
    path: join(directory, "page.png"),
    animations: "allow",
    caret: "hide",
    timeout: 10000,
  });
  if (integrityError) throw new Error("页面文件校验失败，无法生成可信截图");
  const elements = await page.evaluate(() =>
    (window as unknown as { __bcrPageReview: PageApi }).__bcrPageReview.elements(),
  );
  if (blocked) warnings.push("部分外部资源被隔离策略阻止；请将所需资源随作品保存。");
  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify({ elements, warnings: warnings.slice(0, 20) }),
  );
} catch (error) {
  process.stderr.write(String(error).slice(0, 2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
