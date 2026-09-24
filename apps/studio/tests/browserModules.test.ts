import { describe, expect, it } from "vitest";
import { trackModuleRequests } from "../../../scripts/lib/modules.mjs";

describe("browser verification module tracking", () => {
  it("retains live URLs across history changes and resets only on document navigation", async () => {
    const listeners = new Map<string, (value: unknown) => void>();
    const bindings = new Map<string, () => string[]>();
    const mainFrame = {};
    await trackModuleRequests({
      on: (name: string, callback: (value: unknown) => void) => listeners.set(name, callback),
      mainFrame: () => mainFrame,
      exposeFunction: async (name: string, callback: () => string[]) => {
        bindings.set(name, callback);
      },
    });
    const request = (url: string, navigation = false, frame = mainFrame) =>
      listeners.get("request")!({
        url: () => url,
        isNavigationRequest: () => navigation,
        frame: () => frame,
      });
    const urls = () => bindings.get("__bcrTestModuleUrls")!();
    const module = "http://localhost/packages/reader-studio/src/store.ts?t=123";
    request("http://localhost/reader", true);
    request(module);
    for (let index = 0; index < 500; index++) request(`http://localhost/font-${index}.woff2`);
    expect(urls()).toContain(module);
    listeners.get("framenavigated")?.(mainFrame);
    expect(urls()).toContain(module);
    request("http://localhost/frame", true, {});
    expect(urls()).toContain(module);
    request(module);
    expect(urls().at(-1)).toBe(module);
    expect(urls().filter((url) => url === module)).toHaveLength(1);
    request("http://localhost/reader?book=next", true);
    expect(urls()).toEqual(["http://localhost/reader?book=next"]);
  });
});
