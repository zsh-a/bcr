import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { evaluate, gymModel } from "../src/index";

describe("fixed-use economics", () => {
  it("distinguishes equality from the first strictly cheaper integer visit", () => {
    const result = evaluate(gymModel());
    expect(result.breakEven).toEqual({
      equalAt: "40",
      firstNoMore: "40",
      firstCheaper: "41",
      reason: null,
    });
    expect(result.scenarios[0]).toMatchObject({
      visits: "52",
      total: "2400",
      alternative: "3120",
      savings: "720",
    });
  });
  it("recalculates prices and accounts for per-use extra costs", () => {
    const model = gymModel();
    model.parameters.fixed.value = "3000";
    expect(evaluate(model).breakEven.firstCheaper).toBe("51");
    model.parameters.variable.value = "10";
    expect(evaluate(model).breakEven.firstCheaper).toBe("61");
  });
  it("uses decimal input and does not depend on the global Decimal precision", () => {
    const previous = Decimal.precision;
    Decimal.set({ precision: 4 });
    try {
      const model = gymModel();
      model.parameters.fixed.value = "0.3";
      model.parameters.alternative.value = "0.1";
      expect(evaluate(model).breakEven.equalAt).toBe("3");
      expect(evaluate(model).breakEven.firstCheaper).toBe("4");
    } finally {
      Decimal.set({ precision: previous });
    }
  });
  it("handles fractional thresholds and zero attendance without Infinity", () => {
    const model = gymModel();
    model.parameters.variable.value = "2";
    model.scenarios[0]!.attendance = "0";
    const result = evaluate(model);
    expect(result.breakEven.firstNoMore).toBe("42");
    expect(result.breakEven.firstCheaper).toBe("42");
    expect(result.scenarios[0]).toMatchObject({ visits: "0", average: null, total: "2400" });
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });
  it("models no break-even, always equal, and zero fixed cost", () => {
    const model = gymModel();
    model.parameters.variable.value = "60";
    expect(evaluate(model).breakEven.firstCheaper).toBeNull();
    model.parameters.fixed.value = "0";
    expect(evaluate(model).breakEven.firstNoMore).toBe("1");
    model.parameters.variable.value = "0";
    expect(evaluate(model).breakEven.firstCheaper).toBe("1");
  });
  it("preserves expected fractional attendance and bounds curve size", () => {
    const model = gymModel();
    model.scenarios[0]!.attendance = "0.8";
    expect(evaluate(model).scenarios[0]!.visits).toBe("41.6");
    model.parameters.alternative.value = "0.000000000001";
    expect(evaluate(model).curve.length).toBeLessThanOrEqual(102);
  });
  it.each(["", "NaN", "1e3", "-2", "0.0000000000001"])(
    "rejects malformed precision input %s",
    (input) => {
      const model = gymModel();
      model.parameters.fixed.value = input;
      expect(() => evaluate(model)).toThrow();
    },
  );
  it("rejects invalid periods, attendance and duplicate scenario identities", () => {
    const model = gymModel();
    model.parameters.weeks.value = "0";
    expect(() => evaluate(model)).toThrow("周期");
    model.parameters.weeks.value = "52";
    model.scenarios[0]!.attendance = "1.1";
    expect(() => evaluate(model)).toThrow("出勤率");
    model.scenarios[0]!.attendance = "1";
    model.scenarios[1]!.id = model.scenarios[0]!.id;
    expect(() => evaluate(model)).toThrow("身份");
  });
});
