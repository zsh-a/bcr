export async function openActionMenu(page, label) {
  const panel = page
    .getByRole("dialog", { name: label, exact: true, includeHidden: true })
    .or(page.getByRole("menu", { name: label, exact: true, includeHidden: true }))
    .and(page.locator("[popover]"));
  if (!(await panel.evaluate((el) => el.matches(":popover-open"))))
    await page.getByRole("button", { name: label, exact: true }).click();
  await panel.waitFor();
  return panel;
}

export async function openStudioPanel(page, name) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.count()) {
    await tab.click();
    return;
  }
  const menu = await openActionMenu(page, "工作区面板");
  await menu.getByRole("button", { name, exact: true }).click();
  await tab.waitFor();
}
