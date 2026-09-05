import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
const browser = await chromium.launch();
mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });
try {
  for (const width of [375, 900, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByLabel("阅读内容").waitFor();
    await page.getByRole("button", { name: "打开书库", exact: true }).click();
    const card = page.locator(".reader-book-card").first();
    await card.waitFor();
    await card.hover();
    const bounds = await card.evaluate((element) => {
      const entry = element.closest(".reader-book-entry");
      const rect = (node) => node.getBoundingClientRect().toJSON();
      return {
        card: rect(element),
        entry: rect(entry),
        copy: rect(element.querySelector(".reader-book-card-copy")),
        remove: rect(entry.querySelector(".reader-book-remove")),
      };
    });
    assert(Math.abs(bounds.card.width - bounds.entry.width) < 1, `${width}: card must fill row`);
    assert(bounds.remove.right <= bounds.card.right, `${width}: remove button outside card`);
    assert(bounds.copy.right <= bounds.remove.left, `${width}: remove overlaps book text`);
    await page.screenshot({ path: `scripts/shots/reader-library-alignment-${width}.png` });
    await page.getByRole("button", { name: "收起书库", exact: true }).first().click();
    for (const mode of ["连续滚动", "分页阅读"]) {
      await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
      const nav = page.getByRole("navigation", { name: "阅读导航", exact: true });
      await nav.waitFor();
      const aligned = await nav.evaluate((element) => {
        const button = element.querySelector(".reader-mobile-nav-toc");
        const box = button.getBoundingClientRect();
        const icon = button.querySelector("svg").getBoundingClientRect();
        const label = button.querySelector("span").getBoundingClientRect();
        const vertical = getComputedStyle(button).flexDirection === "column";
        const center = (rect, axis) => rect[axis] + rect[axis === "x" ? "width" : "height"] / 2;
        const axis = vertical ? "x" : "y";
        return (
          Math.abs(center(icon, axis) - center(label, axis)) < 1 &&
          Math.abs(center(icon, axis) - center(box, axis)) < 1 &&
          box.height >= 44 &&
          box.width >= 44 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      });
      assert(aligned, `${width} ${mode}: navigation alignment or overflow`);
    }
    await page.screenshot({ path: `scripts/shots/reader-navigation-alignment-${width}.png` });
    await context.close();
  }
  console.log(
    "reader alignment verification PASSED: library actions and navigation at four widths",
  );
} finally {
  await browser.close();
}
