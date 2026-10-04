import { expect, test } from "bun:test";
import { costs } from "../example/model.js";

test("the gym-card example distinguishes equality from the first strictly cheaper visit", () => {
  const prices = { annualPrice: 1800, visitPrice: 50 };
  expect(costs({ ...prices, visits: 35 }).comparison).toBe("per-visit-cheaper");
  expect(costs({ ...prices, visits: 36 })).toMatchObject({
    annualTotal: 1800,
    payPerVisitTotal: 1800,
    average: 50,
    breakEven: 36,
    firstCheaperVisit: 37,
    comparison: "equal",
  });
  expect(costs({ ...prices, visits: 37 }).comparison).toBe("annual-cheaper");
  expect(costs({ annualPrice: 1680, visitPrice: 50, visits: 34 })).toMatchObject({
    firstCheaperVisit: 34,
    comparison: "annual-cheaper",
  });
});
