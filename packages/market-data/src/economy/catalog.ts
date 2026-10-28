import { CYCLE_INDICATORS } from "../cycle/catalog";
import { DEBT_INDICATORS } from "../debt/catalog";
import { MACRO_INDICATORS } from "../macro/catalog";
import type { EconomicDomain, EconomicMetric, EconomicSeries, EconomicTheme } from "./model";

const labor = new Set([
  "unemployment",
  "payrolls",
  "initialClaims",
  "jobOpenings",
  "quitsRate",
  "weeklyHours",
  "payrollChange",
  "unemploymentGap",
]);
const prices = new Set([
  "inflation",
  "coreInflation",
  "corePriceIndex",
  "priceIndex",
  "coreInflation3m",
]);
const confidence = new Set([
  "cli",
  "pmiManufacturing",
  "pmiServices",
  "pmiNonManufacturing",
  "pmiNewOrders",
  "businessConfidence",
  "consumerConfidence",
]);
const credit = new Set([
  "policyRate",
  "realPolicyRate",
  "yieldSpread",
  "nfci",
  "loanStandards",
  "loanDemand",
  "realHousePrices",
  "nominalHousePrices",
  "housingStarts",
  "buildingPermits",
  "housingSalesYtd",
  "housingStartsYtd",
  "realEstateInvestmentYtd",
]);
function theme(domain: EconomicDomain, id: string): EconomicTheme {
  if (domain === "debt") return "credit";
  if (labor.has(id)) return "labor";
  if (prices.has(id)) return "prices";
  if (confidence.has(id)) return "confidence";
  return domain === "cycle" && credit.has(id) ? "credit" : "growth";
}
const zero = new Set([
  "growth",
  "inflation",
  "coreInflation",
  "gdpGrowth",
  "gdpQuarterlyAnnualized",
  "cfnaima3",
  "nfci",
  "yieldSpread",
  "realPolicyRate",
  "realHousePrices",
  "nominalHousePrices",
  "housingSalesYtd",
  "housingStartsYtd",
  "realEstateInvestmentYtd",
  "retailNominal",
  "payrollChange",
  "unemploymentGap",
  "loanStandards",
  "loanDemand",
  "coreInflation3m",
  "privateDemandGrowth",
  "creditGap",
  "creditGrowth",
  "creditImpulse",
  "fiscalBalance",
  "socialFinancingGrowth",
  "socialFinancingFlow",
  "governmentBondFlow",
  "corporateBondFlow",
  "rmbLoanFlow",
]);
function baseline(domain: EconomicDomain, id: string): number | null {
  if (domain === "cycle" && ["cli", "businessConfidence", "consumerConfidence"].includes(id))
    return 100;
  if (domain === "cycle" && id.startsWith("pmi")) return 50;
  if (zero.has(id)) return 0;
  if (domain === "cycle" && CYCLE_INDICATORS.find((item) => item.id === id)?.indexGrowth) return 0;
  return null;
}
export function createEconomicMetrics(series: EconomicSeries[]): EconomicMetric[] {
  const coverage = new Map<string, Set<string>>();
  for (const item of series) {
    const countries = coverage.get(item.metricId) ?? new Set<string>();
    countries.add(item.country);
    coverage.set(item.metricId, countries);
  }
  const definitions = [
    ...MACRO_INDICATORS.map((item) => ({
      ...item,
      domain: "annual" as const,
      name: `${item.name} · 年度`,
    })),
    ...CYCLE_INDICATORS.map((item) => ({ ...item, domain: "cycle" as const })),
    ...DEBT_INDICATORS.map((item) => ({ ...item, domain: "debt" as const })),
  ];
  return definitions.flatMap((item) => {
    const id = `${item.domain}:${item.id}`,
      countries = coverage.get(id);
    return countries
      ? [
          {
            id,
            domain: item.domain,
            name: item.name,
            description: item.description,
            theme: theme(item.domain, item.id),
            baseline: baseline(item.domain, item.id),
            countries: [...countries].sort(),
          },
        ]
      : [];
  });
}
