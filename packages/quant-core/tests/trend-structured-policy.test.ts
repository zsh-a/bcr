import { describe, expect, it, vi } from "vitest";
import {
  createTrendConfig,
  structuredPullbackResearchConfig,
  withTrendEntry,
  validateTrendConfig,
  STRUCTURED_PULLBACK_OPTIONS,
  DEFAULT_STRUCTURED_PULLBACK_POLICY,
} from "../src/trend";
import { RECORDED_V9 } from "./fixtures/trend-recorded";

describe("current structured policy choices", () => {
  it("accepts each selectable value and rejects missing, unknown or mistyped values", () => {
    const config = structuredPullbackResearchConfig(createTrendConfig());
    for (const [field, options] of Object.entries(STRUCTURED_PULLBACK_OPTIONS)) {
      expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
      for (const { value, label } of options) {
        expect(label.trim().length).toBeGreaterThan(0);
        const next = structuredClone(config);
        Object.assign(next.strategy.structuredPullback!, { [field]: value });
        validateTrendConfig(next);
      }
      for (const value of [null, undefined, true, 1, "unknown"]) {
        const next = structuredClone(config);
        Object.assign(next.strategy.structuredPullback!, { [field]: value });
        expect(() => validateTrendConfig(next)).toThrow();
      }
      const missing = structuredClone(config);
      Reflect.deleteProperty(missing.strategy.structuredPullback!, field);
      expect(() => validateTrendConfig(missing)).toThrow();
    }
  });

  it("copies defaults for each editable draft and preserves explicitly chosen policies", () => {
    const preset = structuredPullbackResearchConfig(createTrendConfig());
    const switched = withTrendEntry(createTrendConfig(), "structured-pullback");
    expect(preset.strategy.structuredPullback).toEqual(DEFAULT_STRUCTURED_PULLBACK_POLICY);
    expect(switched.strategy.structuredPullback).toEqual(DEFAULT_STRUCTURED_PULLBACK_POLICY);
    expect(preset.strategy.structuredPullback).not.toBe(DEFAULT_STRUCTURED_PULLBACK_POLICY);
    preset.strategy.structuredPullback!.confirmation = "signal-close";
    preset.strategy.structuredPullback!.keyRole = "impulse-context";
    expect(withTrendEntry(preset, "structured-pullback").strategy.structuredPullback).toEqual(
      preset.strategy.structuredPullback,
    );
    expect(switched.strategy.structuredPullback).toEqual({
      keyLevel: "either",
      shape: "any",
      candle: "none",
      confirmation: "before-breakout",
      keyRole: "pullback-retest",
    });
    expect(DEFAULT_STRUCTURED_PULLBACK_POLICY.confirmation).toBe("before-breakout");
  });

  it("keeps historical validation and v9 migration frozen if a future current preset changes", async () => {
    vi.resetModules();
    vi.doMock("../src/trend/structured-policy", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/trend/structured-policy")>();
      return {
        ...original,
        DEFAULT_STRUCTURED_PULLBACK_POLICY: {
          ...original.DEFAULT_STRUCTURED_PULLBACK_POLICY,
          confirmation: "signal-close",
          keyRole: "impulse-context",
        },
      };
    });
    try {
      const current = await import("../src/trend/config");
      const historical: typeof import("../src/trend/archive") =
        await import("../src/trend/archive");
      const preset = current.structuredPullbackResearchConfig(current.createTrendConfig());
      expect(preset.strategy.structuredPullback).toMatchObject({
        confirmation: "signal-close",
        keyRole: "impulse-context",
      });
      const bytes = JSON.stringify(RECORDED_V9);
      historical.validateRecordedTrendConfig(RECORDED_V9);
      const migrated = historical.restoreTrendDraft(RECORDED_V9);
      expect(migrated.strategy.structuredPullback).toEqual({
        ...RECORDED_V9.strategy.structuredPullback,
        confirmation: "before-breakout",
        keyRole: "pullback-retest",
      });
      expect(historical.restoreTrendDraft(preset)).toEqual(preset);
      expect(() =>
        historical.validateRecordedTrendConfig({
          ...RECORDED_V9,
          strategy: {
            ...RECORDED_V9.strategy,
            structuredPullback: migrated.strategy.structuredPullback,
          },
        }),
      ).toThrow();
      expect(JSON.stringify(RECORDED_V9)).toBe(bytes);
    } finally {
      vi.doUnmock("../src/trend/structured-policy");
      vi.resetModules();
    }
  });
});
