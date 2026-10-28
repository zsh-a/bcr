export type DebtIndicatorId =
  | "householdDebt"
  | "corporateDebt"
  | "governmentDebt"
  | "privateDebt"
  | "debtService"
  | "householdDebtService"
  | "corporateDebtService"
  | "creditGap"
  | "privateCreditStock"
  | "creditGrowth"
  | "creditImpulse"
  | "governmentInterestBurden"
  | "governmentNetInterestBurden"
  | "fiscalBalance"
  | "socialFinancingGrowth"
  | "socialFinancingFlow"
  | "governmentBondFlow"
  | "corporateBondFlow"
  | "rmbLoanFlow";
export type DebtFrequency = "Q" | "M" | "A";
export type DebtUnit =
  | "percentGdp"
  | "percentIncome"
  | "percentRevenue"
  | "percent"
  | "percentagePoints"
  | "trillionLocal"
  | "billionLocal";
export interface DebtSource {
  name: string;
  url: string;
  seriesCode: string;
  licenseUrl: string;
}
export interface DebtObservation {
  period: string;
  value: number | null;
  status?: string;
}
export interface DebtSeries {
  country: string;
  indicator: DebtIndicatorId;
  frequency: DebtFrequency;
  unit: DebtUnit;
  currency: string | null;
  seasonalAdjustment: "SA" | "NSA" | "notApplicable";
  valuation: "nominal" | "market" | "notApplicable";
  source: DebtSource;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  note: string;
  observations: DebtObservation[];
}
export interface DebtSnapshot {
  version: 1;
  fetchedAt: string;
  series: DebtSeries[];
}
export interface DebtPhasePoint {
  country: string;
  period: string;
  gap: number;
  serviceDeviation: number;
  service: number;
  baseline: number;
  baselineCount: number;
}
