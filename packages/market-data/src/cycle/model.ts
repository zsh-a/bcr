export type CycleIndicatorId =
  | "cli"
  | "industrialProduction"
  | "retailVolume"
  | "realConsumption"
  | "unemployment"
  | "inflation"
  | "coreInflation"
  | "gdpGrowth"
  | "gdpQuarterlyAnnualized"
  | "pmiManufacturing"
  | "pmiServices"
  | "pmiNonManufacturing"
  | "pmiNewOrders"
  | "payrolls"
  | "initialClaims"
  | "cfnaima3"
  | "nfci"
  | "yieldSpread"
  | "realIncome"
  | "policyRate"
  | "realPolicyRate"
  | "realHousePrices"
  | "nominalHousePrices"
  | "housingStarts"
  | "buildingPermits"
  | "housingSalesYtd"
  | "housingStartsYtd"
  | "realEstateInvestmentYtd"
  | "retailNominal"
  | "jobOpenings"
  | "quitsRate"
  | "weeklyHours"
  | "payrollChange"
  | "unemploymentGap"
  | "loanStandards"
  | "loanDemand"
  | "corePriceIndex"
  | "priceIndex"
  | "coreInflation3m"
  | "privateDemandGrowth"
  | "inventorySalesRatio"
  | "capacityUtilization"
  | "businessConfidence"
  | "consumerConfidence";
export type CycleFrequency = "M" | "Q" | "W" | "D";
export type CycleUnit =
  | "index"
  | "percent"
  | "percentagePoints"
  | "thousandPersons"
  | "persons"
  | "billionsUsd"
  | "thousandUnits"
  | "hours"
  | "ratio";
export interface CycleSource {
  name: string;
  url: string;
  seriesCode: string;
  licenseUrl?: string;
}
export interface CycleObservation {
  period: string;
  value: number | null;
  status?: string;
}
export interface CycleSeries {
  country: string;
  indicator: CycleIndicatorId;
  frequency: CycleFrequency;
  unit: CycleUnit;
  seasonalAdjustment: "SA" | "NSA" | "notApplicable";
  source: CycleSource;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  note?: string;
  observations: CycleObservation[];
}
export interface CycleSnapshot {
  version: 1;
  fetchedAt: string;
  series: CycleSeries[];
}
export type CyclePhase = "aboveRising" | "aboveFalling" | "belowFalling" | "belowRising" | "flat";
export interface CycleSpacePoint {
  country: string;
  period: string;
  level: number;
  momentum: number;
  phase: CyclePhase;
}
