import { describe, expect, it } from "vitest";
import {
  parseTrendResearchReview,
  researchParameterSlice,
  type TrendResearchReview,
} from "../src/trend";

function fixture(): TrendResearchReview {
  const parameters = (n: number, stop = 2) => ({
    "strategy.breakoutBars": n,
    "strategy.stopAtr": stop,
  });
  const row = (candidate: string, trades = 20) => ({
    window: "dev",
    candidate,
    costScenario: "base" as const,
    netReturn: 0,
    dailyDrawdown: -0.1,
    trades,
    netExpectancy: trades ? 0 : null,
    profitFactor: null,
    meanNetR: null,
    dailySharpe: null,
    dailyMean95CI: null,
  });
  return {
    kind: "trend-research-review",
    version: 1,
    title: "test",
    engine: "test",
    assumptions: {
      capitalMode: "total-account-equal-sleeves",
      accountCapital: 10000,
      sleeveCapital: 10000,
      feeBps: 5,
      slippageBps: 2,
      stressFeeBps: 10,
      stressSlippageBps: 4,
    },
    selected: "n20",
    selectionRule: "fixed",
    identity: Object.fromEntries(
      [
        "planSha256",
        "manifestSha256",
        "selectionSha256",
        "rawResultsSha256",
        "evaluationSha256",
      ].map((key) => [key, "a".repeat(64)]),
    ),
    symbols: ["BTCUSDT"],
    windows: [{ id: "dev", role: "development", start: "2023-01-01", end: "2024-01-01" }],
    candidates: [
      { id: "n20", parameters: parameters(20) },
      { id: "n10", parameters: parameters(10) },
      { id: "n40", parameters: parameters(40) },
      { id: "confounded", parameters: parameters(30, 3) },
    ],
    rows: [row("n20"), row("n10", 0), row("confounded")],
    verdict: { status: "unbound", stage: "unbound", scope: "descriptive-only", cell: null },
    findings: [],
    limitations: [],
    qualificationReasons: [],
    auditScope: "test",
  };
}
describe("research review contract", () => {
  it("keeps real zero returns, zero trades and missing runs distinct, with exact one-factor controls", () => {
    const review = parseTrendResearchReview(fixture());
    const points = researchParameterSlice(review, "n20", "strategy.breakoutBars", "dev", "base");
    expect(points.map((p) => p.value)).toEqual([10, 20, 40]);
    expect(points[0]!.row?.trades).toBe(0);
    expect(points[1]!.row?.netReturn).toBe(0);
    expect(points[2]!.row).toBeNull();
    expect(
      researchParameterSlice(review, "n20", "strategy.breakoutBars", "dev", "stress").every(
        (p) => p.row === null,
      ),
    ).toBe(true);
    expect(review.selected).toBe("n20");
  });
  it("rejects inconsistent verdicts, unknown identities, duplicate and nonfinite results", () => {
    const cases = [
      (r: TrendResearchReview) => {
        r.verdict.status = "pass";
      },
      (r: TrendResearchReview) => {
        r.rows[0]!.netReturn = NaN;
      },
      (r: TrendResearchReview) => {
        r.rows.push(r.rows[0]!);
      },
      (r: TrendResearchReview) => {
        r.rows[0]!.candidate = "unknown";
      },
      (r: TrendResearchReview) => {
        r.identity.planSha256 = "no hash";
      },
      (r: TrendResearchReview) => {
        r.rows[0]!.dailyMean95CI = [1, -1];
      },
    ];
    for (const mutate of cases) {
      const review = fixture();
      mutate(review);
      expect(() => parseTrendResearchReview(review)).toThrow();
    }
  });
  it("does not relabel a failed development gate as a validation pass", () => {
    const review = fixture();
    review.verdict = {
      status: "fail",
      stage: "development",
      scope: "development-base-only",
      cell: "dev",
    };
    review.findings = [
      {
        code: "positive",
        label: "positive",
        status: "fail",
        actual: -0.1,
        threshold: ">0",
        evidence: "stage:dev",
      },
    ];
    expect(parseTrendResearchReview(review).verdict.status).toBe("fail");
    review.verdict.status = "pass";
    expect(() => parseTrendResearchReview(review)).toThrow(/矛盾/);
  });
});
