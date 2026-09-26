/** Open the shared options surface through its visible toolbar entry. */
export async function openWorkspaceOptions(page) {
  const panel = page.locator(".studio-options-popover");
  if (!(await panel.evaluate((element) => element.matches(":popover-open"))))
    await page.getByRole("button", { name: "工作区选项", exact: true }).click();
  await panel.waitFor();
  return panel;
}
