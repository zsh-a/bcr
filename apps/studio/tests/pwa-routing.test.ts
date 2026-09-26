import { describe, expect, it } from "vitest";
import { PWA_APPS, pwaAtPath } from "../src/pwa/apps";
import { pwaRewrite } from "../src/pwa/routing";

describe("independent PWA routing", () => {
  it("keeps published Reader and Notes identities distinct and stable", () => {
    expect(PWA_APPS.find((app) => app.key === "reader")?.id).toBe("/reader");
    expect(PWA_APPS.find((app) => app.key === "knowledge")?.id).toBe("/notes/");
    expect(new Set(PWA_APPS.map((app) => app.id)).size).toBe(PWA_APPS.length);
    for (const app of PWA_APPS) {
      expect(app.startUrl.startsWith(app.scope)).toBe(true);
      expect(PWA_APPS.some((other) => other !== app && app.scope.startsWith(other.scope))).toBe(
        false,
      );
    }
  });
  it("round-trips canonical selections without leaking out of the installed app", () => {
    for (const app of PWA_APPS.filter((item) => item.key !== "knowledge")) {
      const rewrite = pwaRewrite(app);
      const url = new URL(`${app.startUrl}?file=abc&note=n-1#selection`, "https://bcr.example");
      rewrite.input?.({ url });
      expect(url.pathname).toBe(app.path);
      rewrite.output?.({ url });
      expect(url.href).toBe(`https://bcr.example${app.startUrl}?file=abc&note=n-1#selection`);
      expect(pwaAtPath(`${app.scope.slice(0, -1)}-other/`)).toBeUndefined();
    }
  });
  it("keeps workspace routes in its scope, while dedicated apps hand off other tools", () => {
    const workspace = pwaRewrite(PWA_APPS.find((app) => app.key === "workspace")!);
    const url = new URL("https://bcr.example/knowledge?note=n-1");
    workspace.output?.({ url });
    expect(url.pathname).toBe("/pwa/workspace/knowledge");
    workspace.input?.({ url });
    expect(url.pathname).toBe("/knowledge");
    const markets = pwaRewrite(PWA_APPS.find((app) => app.key === "markets")!);
    markets.output?.({ url });
    expect(url.pathname).toBe("/knowledge");
  });
});
