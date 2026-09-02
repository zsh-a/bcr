/* 关键工作台的轻量无障碍审计：可命名控件、地标和重复 ID。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const routes = [
  { path: "/documents", root: ".document-studio", skip: ".document-skip-link" },
  { path: "/reader", root: ".reader-studio", skip: ".reader-skip-link" },
  { path: "/manga", root: ".manga-studio" },
];

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

for (const route of routes) {
  const url = new URL(base.toString());
  url.pathname = route.path;
  url.search = "";
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await page.locator(route.root).waitFor({ timeout: 20_000 });

  const unnamedButtons = await page.locator("button:visible").evaluateAll((elements) =>
    elements
      .map((element) => {
        const aria = element.getAttribute("aria-label")?.trim();
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledText = labelledBy
          ? labelledBy
              .split(/\s+/u)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
              .trim()
          : "";
        const text = element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
        const title = element.getAttribute("title")?.trim() ?? "";
        return aria || labelledText || text || title ? null : element.outerHTML.slice(0, 180);
      })
      .filter((value) => value !== null),
  );
  if (unnamedButtons.length > 0)
    fail(`${route.path} 存在未命名按钮：${unnamedButtons.join(" | ")}`);

  const unnamedControls = await page
    .locator("input:visible, textarea:visible, select:visible")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          if (element instanceof HTMLInputElement && element.type === "file") return null;
          const aria = element.getAttribute("aria-label")?.trim();
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledText = labelledBy
            ? labelledBy
                .split(/\s+/u)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
                .trim()
            : "";
          const labelText = element.closest("label")?.textContent?.replace(/\s+/gu, " ").trim();
          const placeholder = element.getAttribute("placeholder")?.trim();
          return aria || labelledText || labelText || placeholder
            ? null
            : element.outerHTML.slice(0, 180);
        })
        .filter((value) => value !== null),
    );
  if (unnamedControls.length > 0) {
    fail(`${route.path} 存在未命名表单控件：${unnamedControls.join(" | ")}`);
  }

  if (route.skip !== undefined && (await page.locator(route.skip).count()) !== 1) {
    fail(`${route.path} 缺少跳转正文的 skip link`);
  }
  const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
    const counts = new Map();
    for (const element of elements) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  });
  if (duplicateIds.length > 0) fail(`${route.path} 存在重复 ID：${duplicateIds.join(", ")}`);
}

await browser.close();
console.log(
  process.exitCode ? "accessibility verification FAILED" : "accessibility verification PASSED",
);
