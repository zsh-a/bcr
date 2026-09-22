import { describe, expect, it } from "vitest";
import { defaultWindow, fitWindow, validGeometry } from "../src/assistant/windowGeometry";

describe("assistant window geometry", () => {
  it("keeps restored and dragged windows inside a smaller viewport", () => {
    const rect = fitWindow(
      { x: 1600, y: -400, width: 900, height: 800 },
      { width: 390, height: 640 },
    );
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    expect(rect.y + rect.height).toBeLessThanOrEqual(640);
  });
  it("keeps minimum dimensions when resizing below usable bounds", () => {
    expect(
      fitWindow({ x: 50, y: 100, width: 10, height: -4 }, { width: 1440, height: 1000 }),
    ).toMatchObject({ width: 360, height: 420 });
    const rect = defaultWindow({ width: 1440, height: 1000 });
    expect(fitWindow(rect, { width: 1440, height: 1000 })).toEqual(rect);
  });
  it("rejects invalid persisted coordinates", () => {
    expect(validGeometry({ x: NaN, y: 0, width: 400, height: 600 })).toBe(false);
    expect(validGeometry({ x: 0, y: 0, width: "400", height: 600 })).toBe(false);
    expect(validGeometry(null)).toBe(false);
  });
});
