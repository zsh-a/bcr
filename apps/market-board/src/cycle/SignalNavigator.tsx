import { Button } from "@bcr/react";
import {
  CYCLE_INDICATORS,
  type CycleIndicatorId,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";

const groups: { name: string; indicators: CycleIndicatorId[] }[] = [
  {
    name: "实体与景气",
    indicators: [
      "cli",
      "industrialProduction",
      "retailVolume",
      "retailNominal",
      "realConsumption",
      "unemployment",
      "gdpGrowth",
      "gdpQuarterlyAnnualized",
      "pmiManufacturing",
      "pmiNewOrders",
      "pmiServices",
      "pmiNonManufacturing",
      "realIncome",
    ],
  },
  { name: "政策传导", indicators: ["policyRate", "realPolicyRate", "yieldSpread"] },
  {
    name: "房地产",
    indicators: [
      "realHousePrices",
      "nominalHousePrices",
      "housingStarts",
      "buildingPermits",
      "housingSalesYtd",
      "housingStartsYtd",
      "realEstateInvestmentYtd",
    ],
  },
  {
    name: "就业边际",
    indicators: [
      "payrollChange",
      "jobOpenings",
      "quitsRate",
      "weeklyHours",
      "unemploymentGap",
      "payrolls",
      "initialClaims",
    ],
  },
  { name: "贷款供需", indicators: ["loanStandards", "loanDemand"] },
  {
    name: "价格动量",
    indicators: ["coreInflation3m", "coreInflation", "inflation", "corePriceIndex", "priceIndex"],
  },
  {
    name: "增长与预期",
    indicators: [
      "privateDemandGrowth",
      "capacityUtilization",
      "inventorySalesRatio",
      "businessConfidence",
      "consumerConfidence",
    ],
  },
];
export function SignalNavigator({
  snapshot,
  countries,
  metric,
  onSelect,
}: {
  snapshot: CycleSnapshot;
  countries: string[];
  metric: CycleIndicatorId;
  onSelect: (metric: CycleIndicatorId) => void;
}) {
  const active = groups.find((group) => group.indicators.includes(metric)) ?? groups[0]!;
  const available = (indicator: CycleIndicatorId) =>
    snapshot.series.some(
      (series) => series.indicator === indicator && countries.includes(series.country),
    );
  const choices = active.indicators.filter(available);
  const quick = choices.filter((id, index) => index < 6 || id === metric);
  return (
    <div className="cycle-signal-navigator">
      <nav aria-label="周期信号类别">
        {groups
          .filter((group) => group.indicators.some(available))
          .map((group) => (
            <Button
              key={group.name}
              size="sm"
              variant="ghost"
              aria-pressed={group === active}
              onClick={() => {
                const next = group.indicators.find(available);
                if (next) onSelect(next);
              }}
            >
              {group.name}
            </Button>
          ))}
      </nav>
      <div className="cycle-signal-choices" aria-label={`${active.name}指标`}>
        {quick.map((id) => {
          const definition = CYCLE_INDICATORS.find((item) => item.id === id)!;
          const count = countries.filter((country) =>
            snapshot.series.some((series) => series.country === country && series.indicator === id),
          ).length;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={metric === id}
              onClick={() => onSelect(id)}
            >
              {definition.name}
              <small>
                {count}/{countries.length} 国
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
