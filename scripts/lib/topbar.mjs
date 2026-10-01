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
