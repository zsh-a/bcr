import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PWA_APPS } from "../src/pwa/apps";
import { MANIFESTS } from "../src/shell/registry";

// 清单本身是纯数据，但 registry 的模块图会经 Dock 面板带到 router→Shell→theme，
// 那条链在模块顶层访问 window（node 环境直接炸）。守卫只关心 path 清单，
// 把 router 换成空实现（vitest 会把 vi.mock 提升到 import 之前生效），其余照常真实导入。
vi.mock("../src/router", () => ({
  useSelection: () => ({ file: undefined, task: undefined, select: () => {} }),
}));

/**
 * 清单守卫：pwa/apps.ts 的 PWA 安装清单与 shell/registry.ts 的 app 清单是同一套
 * 应用的两份平行事实，目前只靠人工小心保持一致。这里把机器可查的对齐钉死：
 *
 * 1. path 一一对应——守卫只对 path 不对 id/key：PWA key 与 manifest id 是两套
 *    历史命名（首页在三层分别是 key "workspace" / id "studio" / 路由 "/"，见
 *    pwa/apps.ts 顶部注释），拿 id 当对齐键只会误报。
 * 2. generate-pwa-entries.mjs 的产物（pwa/<key>/index.html 与 public 下的
 *    manifest.webmanifest）的 key/数量与 PWA 清单一致——改了 apps.ts 忘了重新
 *    生成、或移除 app 后留着旧产物，都会在这里暴露，防清单与产物悄悄漂移。
 */

const studioRoot = fileURLToPath(new URL("../", import.meta.url));

describe("PWA 安装清单与壳层 app 清单", () => {
  it("每个 PWA path 都能在壳层 MANIFESTS 找到同 path 的 manifest", () => {
    const manifestPaths = MANIFESTS.map((app) => app.path);
    for (const app of PWA_APPS) {
      if (app.path === "/") {
        // 唯一例外：首页 workspace 对应路由 "/"（壳层内部叫 "home"），壳层不为
        // 首页建 manifest；见 pwaForApp 的 home→workspace 字面映射。
        expect(app.key).toBe("workspace");
        continue;
      }
      expect(manifestPaths, `${app.key}: ${app.path} 在壳层没有同 path 的 manifest`).toContain(
        app.path,
      );
    }
  });

  it("每个 manifest path 都有对应的 PWA 安装身份，数量一致", () => {
    const pwaPaths = PWA_APPS.map((app) => app.path);
    for (const app of MANIFESTS) {
      expect(pwaPaths, `${app.id}: ${app.path} 没有对应的 PWA 安装身份`).toContain(app.path);
    }
    // 钉住数量：PWA 清单 = MANIFESTS + 首页 workspace，防止两边悄悄长歪。
    expect(PWA_APPS).toHaveLength(MANIFESTS.length + 1);
  });

  it("generate-pwa-entries 的产物 key/数量与 PWA 清单一致", () => {
    // 该脚本给每个 app 写 public 下的 manifest.webmanifest，但只给 knowledge 以外
    // 的 app 生成 pwa/<key>/index.html（knowledge 用 notes/knowledge/index.html）。
    const expectedKeys = PWA_APPS.filter((app) => app.key !== "knowledge")
      .map((app) => app.key)
      .sort();
    const generatedKeys = readdirSync(`${studioRoot}pwa`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(generatedKeys).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(existsSync(`${studioRoot}pwa/${key}/index.html`), `pwa/${key}/index.html 缺失`).toBe(
        true,
      );
    }
    for (const app of PWA_APPS) {
      expect(
        existsSync(`${studioRoot}public${app.manifestUrl}`),
        `${app.key}: public${app.manifestUrl} 缺失`,
      ).toBe(true);
    }
  });
});
