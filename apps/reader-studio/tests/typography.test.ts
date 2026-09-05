import { describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS } from "../src/model";
import {
  normalizeReaderTypography,
  readerFontStack,
  readerTypographyStyle,
  READER_TYPOGRAPHY_PRESETS,
} from "../src/readerTypography";

describe("reader typography", () => {
  it("uses an explicit Latin face before the Chinese face and system fallback", () => {
    expect(readerFontStack(DEFAULT_READER_SETTINGS)).toMatch(
      /^"IBM Plex Sans", "Noto Sans SC Variable"/,
    );
    expect(readerFontStack({ fontFamily: "kai", latinFontFamily: "atkinson" })).toMatch(
      /^"Atkinson Hyperlegible Next Variable", "LXGW WenKai"/,
    );
  });
  it("maps layout controls to both reader layouts without synthetic WenKai weights", () => {
    const style = readerTypographyStyle({
      ...DEFAULT_READER_SETTINGS,
      fontFamily: "kai",
      fontWeight: 500,
      fontSize: 21,
      lineLength: 34,
    });
    expect(style["--reader-reader-font-weight"]).toBe(400);
    expect(style["--reader-line-length"]).toBe("714px");
    expect(style["--reader-paragraph-spacing"]).toBe("0.65em");
  });
  it("repairs malformed numeric settings while retaining unrelated preferences", () => {
    const normalized = normalizeReaderTypography({
      ...DEFAULT_READER_SETTINGS,
      theme: "night",
      fontWeight: 900,
      fontSize: NaN,
      lineHeight: Infinity,
      paragraphSpacing: -2,
      lineLength: 100,
    });
    expect(normalized).toMatchObject({
      theme: "night",
      fontWeight: 400,
      fontSize: 20,
      lineHeight: 1.7,
      paragraphSpacing: 0.3,
      lineLength: 44,
    });
  });
  it("offers coherent regular-weight longform, literature and technical presets", () => {
    expect(READER_TYPOGRAPHY_PRESETS).toHaveLength(4);
    for (const preset of READER_TYPOGRAPHY_PRESETS) {
      const settings = { ...DEFAULT_READER_SETTINGS, ...preset.settings };
      expect(normalizeReaderTypography(settings)).toEqual(settings);
      expect(settings.fontWeight).toBe(400);
    }
  });
});
