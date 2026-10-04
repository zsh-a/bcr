import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureBrowser } from "@remotion/renderer";

export function browserCache() {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "bcr", "remotion-4.0.532");
}
/** Called only in a worker or the explicit browser installation command. */
export async function prepareBrowser() {
  const cache = browserCache();
  mkdirSync(cache, { recursive: true });
  if (!existsSync(join(cache, "package.json")))
    writeFileSync(join(cache, "package.json"), '{"private":true}');
  const cwd = process.cwd();
  try {
    process.chdir(cache);
    const browser = await ensureBrowser({
      browserExecutable: process.env.BCR_RUNNER_BROWSER ?? null,
      logLevel: "error",
    });
    if (!("path" in browser)) throw new Error("浏览器尚未就绪");
    return browser.path;
  } finally {
    process.chdir(cwd);
  }
}
