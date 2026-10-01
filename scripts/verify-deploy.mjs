/* 部署冒烟：构建清单引用到的每个资产都必须是资产，而不是 SPA 兜底页。
 *
 * 上线事故形态：缺失/改名的资产被 not_found_handling 兜成 200 + text/html，
 * 浏览器按 CSS/JS 预载拿到 HTML，启动即「Unable to preload CSS」。本地静态服
 * 没有这层兜底语义，CI 的既有套件测不到；本脚本对着真实部署面断言：
 *   1. 首页是 HTML；
 *   2. /build-manifest.json 是 JSON，且其 file/css/assets 引用的每个资产都返回
 *      正确 content-type——资产绝不是 text/html（兜底伪装一票否决）。清单是
 *      Service Worker 预缓存的事实源，也覆盖惰性分块的引用（事故所在层）。
 *   3. 部署传播有延迟，整体重试至多 90s。
 *
 * 用法：node scripts/verify-deploy.mjs https://bcr-studio.example.workers.dev
 */
import assert from "node:assert/strict";

const origin = process.argv[2] ?? process.env.DEPLOY_URL;
if (!origin) {
  console.error("usage: node scripts/verify-deploy.mjs <origin>");
  process.exit(2);
}

const TYPES = {
  js: ["javascript"],
  mjs: ["javascript"],
  css: ["text/css"],
  json: ["application/json"],
  wasm: ["application/wasm"],
  webmanifest: ["application/manifest"],
};

function referencedAssets(manifest) {
  const urls = new Set();
  for (const entry of Object.values(manifest)) {
    if (entry === null || typeof entry !== "object") continue;
    for (const field of ["file", "css", "assets"]) {
      for (const value of Array.isArray(entry[field]) ? entry[field] : [entry[field]]) {
        // 清单值是相对站点根的路径（如 assets/foo.js、notes/sw.js、sw.js）；
        // 含 .. 的是构建期源路径，不是产物。
        if (typeof value !== "string" || value.includes("..")) continue;
        urls.add(`/${value.replace(/^\//, "")}`);
      }
    }
  }
  return [...urls];
}

async function checkOnce() {
  const problems = [];
  const index = await fetch(`${origin}/`, { redirect: "follow" });
  const indexType = index.headers.get("content-type") ?? "";
  if (!index.ok || !indexType.includes("text/html"))
    problems.push(`/ -> ${index.status} ${indexType}`);

  const manifestResponse = await fetch(`${origin}/build-manifest.json`, { redirect: "follow" });
  const manifestType = manifestResponse.headers.get("content-type") ?? "";
  if (!manifestResponse.ok || manifestType.includes("text/html")) {
    problems.push(`/build-manifest.json -> ${manifestResponse.status} ${manifestType}`);
    return problems;
  }
  const manifest = await manifestResponse.json();
  const assets = referencedAssets(manifest);
  assert(assets.length > 0, "构建清单没有任何资产引用——清单形态变了，请更新本脚本");
  const targets = assets;
  for (let from = 0; from < targets.length; from += 24) {
    const batch = targets.slice(from, from + 24);
    const found = await Promise.all(
      batch.map(async (path) => {
        const response = await fetch(`${origin}${path}`, { method: "HEAD", redirect: "follow" });
        const type = response.headers.get("content-type") ?? "";
        const expected = TYPES[path.split(".").pop()] ?? [];
        if (!response.ok) return `${path} -> ${response.status}`;
        if (type.includes("text/html")) return `${path} -> 兜底 HTML 伪装（${type}）`;
        if (expected.length > 0 && !expected.some((want) => type.includes(want)))
          return `${path} -> ${type}`;
        return null;
      }),
    );
    problems.push(...found.filter((problem) => problem !== null));
    if (problems.length > 20) break;
  }
  return problems;
}

let problems = ["部署尚未就绪"];
const deadline = Date.now() + 90_000;
while (problems.length > 0 && Date.now() < deadline) {
  problems = await checkOnce().catch((reason) => [`探测失败：${String(reason)}`]);
  if (problems.length > 0) await new Promise((resolve) => setTimeout(resolve, 3_000));
}
if (problems.length > 0) {
  console.error(`deployed asset verification FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`deployed asset verification PASSED: ${origin}`);
