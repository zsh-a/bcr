import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createThemeStore, themePreference } from "../src/theme/store";

describe("appearance preference", () => {
  it("validates persisted preferences", () => {
    expect(themePreference("dark")).toBe("dark");
    expect(themePreference("light")).toBe("light");
    for (const value of [null, "system", "invalid", {}])
      expect(themePreference(value)).toBe("system");
  });
  it("follows system changes only in system mode and restores cross-tab preferences", () => {
    let dark = false,
      saved = "system";
    const apply = vi.fn();
    const store = createThemeStore({
      read: () => saved,
      write: (value) => {
        saved = value;
      },
      systemDark: () => dark,
      apply,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const first = store.getSnapshot();
    store.systemChanged();
    expect(store.getSnapshot()).toBe(first);
    dark = true;
    store.systemChanged();
    expect(store.getSnapshot().resolved).toBe("dark");
    store.set("light");
    store.systemChanged();
    expect(store.getSnapshot().resolved).toBe("light");
    expect(saved).toBe("light");
    saved = "dark";
    store.storageChanged();
    expect(store.getSnapshot().preference).toBe("dark");
    unsubscribe();
    listener.mockClear();
    store.set("system");
    expect(listener).not.toHaveBeenCalled();
    expect(apply).toHaveBeenLastCalledWith("dark");
  });
  it("stays usable with blocked storage, reports failed saves and preserves the session choice", () => {
    const store = createThemeStore({
      read: () => {
        throw Error("blocked");
      },
      write: () => {
        throw Error("blocked");
      },
      systemDark: () => false,
      apply: vi.fn(),
    });
    expect(store.getSnapshot().resolved).toBe("light");
    store.set("dark");
    store.systemChanged();
    expect(store.getSnapshot()).toMatchObject({ preference: "dark", resolved: "dark" });
    expect(store.getSnapshot().error).toContain("无法保存");
  });
});

function luminance(hex: string) {
  return hex
    .slice(1)
    .match(/../gu)!
    .map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}
const css = readFileSync(
  new URL("../../../packages/react/src/tokens.css", import.meta.url),
  "utf8",
);
for (const [theme, block] of [
  ["dark", css.split(":root {")[1]!.split("}")[0]!],
  ["light", css.split(':root[data-theme="light"] {')[1]!.split("}")[0]!],
]) {
  const colors = Object.fromEntries(
    [...block!.matchAll(/--color-([\w-]+): (#[\da-f]{6});/gu)].map((match) => [match[1], match[2]]),
  );
  describe(`${theme} theme contrast`, () => {
    for (const foreground of [
      "text",
      "muted",
      "faint",
      "accent",
      "success",
      "danger",
      "info",
      "amber",
    ]) {
      it(`${foreground} is readable on every surface`, () => {
        for (const background of ["bg", "surface", "raised", "overlay"]) {
          const a = luminance(colors[foreground]!),
            b = luminance(colors[background]!);
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            background,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
    it("has a readable primary button label", () => {
      const a = luminance(colors["primary"] ?? colors["accent"]!),
        b = luminance(colors["on-primary"]!);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
