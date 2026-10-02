import { describe, expect, it } from "vitest";
import { contextMenuPosition } from "../src/contextMenuPosition";

describe("context menu viewport placement", () => {
  it("retains the pointer position when there is space", () => {
    expect(
      contextMenuPosition(
        { x: 100, y: 120 },
        { width: 224, height: 240 },
        { width: 1280, height: 800 },
      ),
    ).toMatchObject({ left: 100, top: 120 });
  });
  it("keeps menus visible near all edges", () => {
    const viewport = { width: 390, height: 700 };
    expect(
      contextMenuPosition({ x: 389, y: 699 }, { width: 224, height: 240 }, viewport),
    ).toMatchObject({ left: 158, top: 452 });
    expect(
      contextMenuPosition({ x: -20, y: -10 }, { width: 224, height: 240 }, viewport),
    ).toMatchObject({ left: 8, top: 8 });
  });
  it("limits oversized menus and never yields negative dimensions", () => {
    expect(
      contextMenuPosition(
        { x: 150, y: 100 },
        { width: 224, height: 500 },
        { width: 180, height: 160 },
      ),
    ).toEqual({ left: 8, top: 8, maxWidth: 164, maxHeight: 144 });
    expect(
      contextMenuPosition({ x: 0, y: 0 }, { width: 224, height: 500 }, { width: 4, height: 0 }),
    ).toEqual({ left: 2, top: 0, maxWidth: 0, maxHeight: 0 });
  });
});
