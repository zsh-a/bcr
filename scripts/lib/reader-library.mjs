/** Exercise the same collection actions with a mouse or a real emulated touch gesture. */
export async function openLibrary(page) {
  await page.getByLabel("阅读内容", { exact: true }).waitFor();
  const button = page.getByRole("button", { name: "打开书库", exact: true });
  if (await button.isVisible()) await button.click();
}

export async function openBookMenu(page, title, { touch = false } = {}) {
  const row = page.getByRole("button", { name: title, exact: true });
  if (touch) {
    const box = await row.boundingBox();
    if (!box) throw new Error(`Book row not visible: ${title}`);
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
      });
      await page.getByRole("menu", { name: "读物操作", exact: true }).waitFor();
    } finally {
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await session.detach();
    }
  } else {
    await row.click({ button: "right" });
  }
  const menu = page.getByRole("menu", { name: "读物操作", exact: true });
  await menu.waitFor();
  return menu;
}

export async function libraryTool(page, name) {
  const panel = page.locator(".reader-library-quick");
  await panel.getByRole("button", { name: "书库操作", exact: true }).click();
  await panel
    .getByRole("menu", { name: "书库操作", exact: true })
    .getByRole("menuitem", { name, exact: true })
    .click();
}
