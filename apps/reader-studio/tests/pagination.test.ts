import { describe, expect, it } from "vitest";
import { pageAtOffset, pageCount, paginationGeometry } from "../src/pagination";

describe("viewport pagination", () => {
  it("counts occupied columns without a phantom final page", () => {
    expect(paginationGeometry(680, 1456, 48, 2)).toEqual({ totalPages: 1, spreads: 1 });
    expect(paginationGeometry(2136, 1456, 48, 2)).toEqual({ totalPages: 3, spreads: 2 });
    expect(paginationGeometry(1408, 1456, 48, 2)).toEqual({ totalPages: 2, spreads: 1 });
  });
  it("does not create phantom pages from subpixel rounding", () => {
    expect(pageCount(375, 375)).toBe(1);
    expect(pageCount(750.5, 375)).toBe(2);
    expect(pageCount(1125, 375)).toBe(3);
    expect(pageCount(0, 0)).toBe(1);
  });
  it("snaps and clamps offsets including overscroll", () => {
    expect(pageAtOffset(-32, 375, 4)).toBe(0);
    expect(pageAtOffset(374.5, 375, 4)).toBe(1);
    expect(pageAtOffset(9999, 375, 4)).toBe(3);
  });
});
