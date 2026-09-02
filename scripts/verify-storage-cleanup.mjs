/* Storage plane 走查：容量状态可见，清理命令必须先打开 dry-run 对话框。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5199/studio";
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1_500);
await page.getByRole("button", { name: "刷新本地 Artifact 容量" }).waitFor();
await page.getByRole("tab", { name: "存储" }).click();
await page.getByText("Storage Plane").waitFor();
const body = await page.locator("body").innerText();
if (!/(objects|scanning storage)/u.test(body)) fail("顶栏未显示本地存储状态");

const orphanCreated = await page.evaluate(async () => {
  if (typeof navigator.storage?.getDirectory !== "function") return false;
  const root = await navigator.storage.getDirectory();
  const project = await root.getDirectoryHandle("studio", { create: true });
  const artifacts = await project.getDirectoryHandle("artifacts", { create: true });
  const verify = await artifacts.getDirectoryHandle("verify", { create: true });
  const file = await verify.getFileHandle("cleanup-orphan.bin", { create: true });
  const writable = await file.createWritable();
  await writable.write(new Uint8Array([1, 2, 3, 4]));
  await writable.close();
  return true;
});

await page.getByRole("button", { name: "打开命令面板" }).click();
await page.getByPlaceholder("输入命令…").fill("清理未追踪 Artifact");
await page.getByRole("button", { name: /清理未追踪 Artifact/u }).click();
await page.getByText("Artifact 存储清理").waitFor();
await page.getByText(/仅清理没有血缘记录/u).waitFor();
if (orphanCreated) {
  // The dialog intentionally caps the visible list at eight items; canonical
  // Manga/Document packages can put the verification orphan after that cap.
  await page.getByText("untracked objects").waitFor();
  await page.getByRole("button", { name: "清理这些对象" }).click();
  await page.getByText("清理完成").waitFor();
  const stillExists = await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const project = await root.getDirectoryHandle("studio");
      const artifacts = await project.getDirectoryHandle("artifacts");
      const verify = await artifacts.getDirectoryHandle("verify");
      await verify.getFileHandle("cleanup-orphan.bin");
      return true;
    } catch {
      return false;
    }
  });
  if (stillExists) fail("清理确认后 orphan Artifact 仍然存在");
}

await page.getByRole("button", { name: orphanCreated ? "完成" : "关闭" }).click();
await page.getByRole("button", { name: "打开命令面板" }).click();
await page.getByPlaceholder("输入命令…").fill("整理过期缓存与历史");
await page.getByRole("button", { name: /整理过期缓存与历史/u }).click();
await page.getByText("缓存与任务历史整理").waitFor();
await page.getByText(/默认保留 30 天缓存/u).waitFor();

await browser.close();
console.log(
  process.exitCode ? "storage cleanup verification FAILED" : "storage cleanup verification PASSED",
);
