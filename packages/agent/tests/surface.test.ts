import { describe, expect, it } from "vitest";
import { createSurfaceRegistry } from "../src/surface";
const { activeSurface, activateSurface, registerSurface, surfaceRevision } =
  createSurfaceRegistry();

describe("surface ownership", () => {
  it("does not unregister a replacement when the previous owner leaves", () => {
    const first = {
      kind: "test.note",
      label: "First",
      read: () => null,
      write: async () => ({ id: "note", version: "v1" }),
    };
    const second = { ...first, label: "Second" };
    const removeFirst = registerSurface(first);
    activateSurface(first.kind);
    const removeSecond = registerSurface(second);
    try {
      removeFirst();
      expect(activeSurface()).toBe(second);
      removeFirst();
      expect(activeSurface()).toBe(second);
    } finally {
      removeSecond();
    }
    expect(activeSurface()).toBeNull();
  });

  it("notifies subscribers when an inactive surface is removed", () => {
    const remove = registerSurface({
      kind: "test.inactive",
      label: "Inactive",
      read: () => null,
      write: async () => ({ id: "note", version: "v1" }),
    });
    const before = surfaceRevision();
    remove();
    expect(surfaceRevision()).toBeGreaterThan(before);
  });
});
