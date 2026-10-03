import assert from "node:assert/strict";

async function selectedIsVisible(list, selector) {
  const bounds = await list.evaluate((el, target) => {
    const row = el.querySelector(target).getBoundingClientRect();
    const container = el.getBoundingClientRect();
    return { top: row.top, bottom: row.bottom, min: container.top, max: container.bottom };
  }, selector);
  assert(bounds.top >= bounds.min - 1 && bounds.bottom <= bounds.max + 1, JSON.stringify(bounds));
}

/** Exercise the shortcuts as a user would, without locator.fill silently fixing focus. */
export async function verifyHomeInteractions(page) {
  await page.keyboard.press("Control+Shift+f");
  const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await search.waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "全局搜索",
  );
  assert((await search.locator('[role="option"]').first().innerText()).includes("市场行情"));
  assert.equal(await search.getByRole("button", { name: "保存当前结果" }).count(), 0);
  assert((await search.getByRole("tab").count()) < 5, "empty categories stay collapsed");
  await page.keyboard.insertText("市场");
  assert((await search.locator('[role="option"]').first().innerText()).includes("市场行情"));
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("阅读");
  assert((await search.locator('[role="option"]').first().innerText()).includes("阅读器"));
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  for (let index = 0; index < 10; index++) await page.keyboard.press("ArrowDown");
  await selectedIsVisible(search.locator('[role="listbox"]'), '[aria-selected="true"]');
  await page.keyboard.press("Escape");
  await search.waitFor({ state: "hidden" });

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
  await palette.waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "搜索命令",
  );
  for (let index = 0; index < 17; index++) await page.keyboard.press("ArrowDown");
  await selectedIsVisible(palette.locator(".max-h-64"), '[data-command-index="17"]');
  await page.keyboard.insertText("hash.blake3");
  assert(await palette.locator('[data-command-id="blake3"]').isDisabled());
  await page.keyboard.press("Enter");
  assert(await palette.isVisible(), "unavailable commands do not silently close the palette");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("no-such-command");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert(await palette.isVisible(), "Enter with no result keeps the query editable");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Reader");
  await palette.getByRole("textbox").evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
  });
  assert(await palette.isVisible(), "IME confirmation does not execute a command");
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });

  await page.setViewportSize({ width: 390, height: 844 });
  const home = page.locator(".studio-home");
  const tools = page.locator(".home-more-tools");
  await tools.locator("summary").click();
  const studio = page.locator('.home-tool-link[data-app-id="studio"]');
  await studio.scrollIntoViewIfNeeded();
  const top = (await studio.boundingBox()).y;
  await studio.click();
  await page.locator(".studio-dock-shell").waitFor();
  await page.goBack();
  await home.waitFor();
  assert(await tools.evaluate((el) => el.open), "return retains expanded tools");
  assert(
    Math.abs((await studio.boundingBox()).y - top) < 2,
    "return retains the card's viewport position",
  );
  assert(
    await studio.evaluate((el) => el === document.activeElement),
    "return restores card focus",
  );

  await studio.click();
  await page.locator(".studio-dock-shell").waitFor();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入文件", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "homepage-resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Resume this exact file from the home page."),
  });
  await page.waitForURL((url) => url.pathname === "/studio" && url.searchParams.has("file"));
  const deepLink = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.keyboard.press("Alt+Digit0");
  await home.waitFor();
  const recent = page.locator('[data-recent-app="studio"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-recent-app="studio"]')
      ?.textContent.includes("homepage-resume.txt"),
  );
  await page.reload();
  await recent.waitFor();
  await recent.click();
  await page.waitForURL((url) => url.pathname + url.search === deepLink);
  await page.getByRole("button", { name: "计算校验值", exact: true }).waitFor();
  await page.keyboard.press("Alt+Digit0");
  await home.waitFor();
  assert.equal(await page.locator('[data-recent-app="studio"]').count(), 1);
  await page.setViewportSize({ width: 1366, height: 768 });
  console.log(
    "PASS: natural keyboard input, Chinese search, result visibility, IME, disabled commands, home restoration and persisted file resume",
  );
}
