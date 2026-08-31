import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 走查脚本专用：持久化浏览器 profile 启动。
 *
 * Cache API / OPFS 均按 origin（协议+域名+端口）隔离——dev server 端口固定 +
 * 复用同一 userDataDir，模型权重（HF CDN）只下载一次，走查之间共享缓存与项目数据。
 * 注意：同一 app 的 profile 不要并行跑两个脚本（Chromium 单实例锁）。
 */
export async function launchVerifyBrowser(app) {
  const scriptDir = fileURLToPath(new URL("./", import.meta.url));
  const profileDir = path.join(scriptDir, `.pw-profile-${app}`);
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(path.join(scriptDir, "shots"), { recursive: true });
  const browser = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1440, height: 900 },
    args: ["--disable-dev-shm-usage"],
  });
  return browser;
}
