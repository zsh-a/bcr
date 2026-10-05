import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureBrowser } from "@remotion/renderer";

export function browserCache() {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "bcr", "remotion-4.0.532");
}

function isWslGpuEnvironment() {
  return process.platform === "linux" && existsSync("/dev/dxg") && existsSync("/mnt/wslg/runtime-dir/wayland-0");
}

function prepareWslGpuEnvironment() {
  if (!isWslGpuEnvironment()) return false;
  process.env.DISPLAY ??= ":0";
  process.env.WAYLAND_DISPLAY ??= "wayland-0";
  process.env.XDG_RUNTIME_DIR ??= `/run/user/${process.getuid?.() ?? 1000}`;
  process.env.GALLIUM_DRIVER ??= "d3d12";
  process.env.MESA_D3D12_DEFAULT_ADAPTER_NAME ??= "NVIDIA";
  process.env.BCR_RUNNER_GPU_WEBGL_WINDOWED = "1";
  return true;
}

/** Called only in a worker or the explicit browser installation command. */
export async function prepareBrowser(options: { gpuWebgl?: boolean } = {}) {
  const cache = browserCache();
  mkdirSync(cache, { recursive: true });
  if (!existsSync(join(cache, "package.json")))
    writeFileSync(join(cache, "package.json"), '{"private":true}');
  const gpuWebgl = options.gpuWebgl === true;
  const wslGpu = gpuWebgl && prepareWslGpuEnvironment();
  const configuredBrowser = process.env.BCR_RUNNER_BROWSER ?? null;
  const browserExecutable =
    configuredBrowser ?? (gpuWebgl && existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : null);
  if (gpuWebgl && !browserExecutable)
    throw new Error("GPU WebGL 需要 Chrome for Testing 或系统 Chromium，请设置 BCR_RUNNER_BROWSER");
  if (gpuWebgl) process.env.BCR_RUNNER_BROWSER = browserExecutable!;
  const cwd = process.cwd();
  try {
    process.chdir(cache);
    const browser = await ensureBrowser({
      browserExecutable,
      chromeMode: gpuWebgl ? "chrome-for-testing" : "headless-shell",
      logLevel: "error",
    });
    if (!("path" in browser)) throw new Error("浏览器尚未就绪");
    if (gpuWebgl && wslGpu && browser.path !== "/usr/bin/chromium" && !configuredBrowser)
      throw new Error("WSL GPU WebGL 需要使用 /usr/bin/chromium，请设置 BCR_RUNNER_BROWSER 指向 Chrome for Testing");
    return browser.path;
  } finally {
    process.chdir(cwd);
  }
}
