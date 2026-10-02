/** Reveal the overlay navigation in apps; home already has an inline toolbar. */
export async function openTopBar(page) {
  const bar = page.locator(".studio-topbar");
  await bar.waitFor({ state: "attached" });
  if (!(await bar.isVisible()))
    await page.getByRole("button", { name: "展开工作区导航", exact: true }).click();
  await bar.waitFor();
  return bar;
}

/** Return to the app's unobstructed toolbar after using global navigation. */
export async function closeTopBar(page) {
  const collapse = page.getByRole("button", { name: "收起工作区导航", exact: true });
  if (await collapse.isVisible()) {
    await collapse.click();
    await page.locator(".studio-navigation-surface").waitFor({ state: "hidden" });
  }
}

/** Open the shared options surface through its visible toolbar entry. */
export async function openWorkspaceOptions(page) {
  await openTopBar(page);
  const panel = page.locator(".studio-options-popover");
  if (!(await panel.evaluate((element) => element.matches(":popover-open"))))
    await page.getByRole("button", { name: "工作区选项", exact: true }).click();
  await panel.waitFor();
  return panel;
}

/** Run a named command without depending on the launch pad's numeric order. */
export async function runWorkspaceCommand(page, title) {
  const palette = page.locator(".studio-command-palette");
  if (!(await palette.isVisible())) {
    // Apps can own Ctrl+K (Knowledge opens its note switcher). Use the global
    // options entry so navigation is independent of focus and app shortcuts.
    const options = await openWorkspaceOptions(page);
    await options.getByRole("button", { name: "打开命令面板", exact: true }).click();
  }
  await palette.getByRole("textbox", { name: "搜索命令", exact: true }).fill(title);
  await palette
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  await palette.waitFor({ state: "hidden" });
  await closeTopBar(page);
}
