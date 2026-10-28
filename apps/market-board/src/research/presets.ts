import type { EconomicRepository } from "@bcr/market-data/economy";
import type { ResearchPreset, ResearchState } from "./state";

export const RESEARCH_PRESETS: {
  id: ResearchPreset;
  name: string;
  hint: string;
  metrics: string[];
}[] = [
  {
    id: "overview",
    name: "经济全景",
    hint: "增长、价格、就业与金融条件，同一时间坐标。",
    metrics: [
      "cycle:gdpGrowth",
      "cycle:inflation",
      "cycle:policyRate",
      "debt:creditGrowth",
      "cycle:unemployment",
      "cycle:cli",
      "cycle:realHousePrices",
      "debt:debtService",
    ],
  },
  {
    id: "growth",
    name: "增长与需求",
    hint: "实际产出、生产与消费交叉验证，名义口径分别注明。",
    metrics: [
      "cycle:gdpGrowth",
      "cycle:industrialProduction",
      "cycle:retailVolume",
      "cycle:retailNominal",
      "cycle:realConsumption",
      "cycle:privateDemandGrowth",
      "cycle:inventorySalesRatio",
      "cycle:capacityUtilization",
    ],
  },
  {
    id: "prices",
    name: "通胀与政策",
    hint: "同比、短期动量与政策工具分别观察。",
    metrics: [
      "cycle:inflation",
      "cycle:coreInflation",
      "cycle:coreInflation3m",
      "cycle:policyRate",
      "cycle:realPolicyRate",
      "cycle:yieldSpread",
    ],
  },
  {
    id: "credit",
    name: "信用与地产",
    hint: "融资变化、杠杆和偿债负担，与住房活动一起看。",
    metrics: [
      "debt:creditGrowth",
      "debt:privateDebt",
      "debt:debtService",
      "cycle:realHousePrices",
      "cycle:loanStandards",
      "cycle:loanDemand",
      "debt:socialFinancingGrowth",
      "cycle:housingSalesYtd",
      "cycle:housingStartsYtd",
      "cycle:realEstateInvestmentYtd",
      "cycle:housingStarts",
      "cycle:buildingPermits",
    ],
  },
  {
    id: "labor",
    name: "就业与收入",
    hint: "就业水平与边际变化保留各自单位和调查范围。",
    metrics: [
      "cycle:unemployment",
      "cycle:payrollChange",
      "cycle:initialClaims",
      "cycle:jobOpenings",
      "cycle:quitsRate",
      "cycle:weeklyHours",
      "cycle:unemploymentGap",
      "cycle:realIncome",
    ],
  },
  {
    id: "confidence",
    name: "景气与预期",
    hint: "领先景气、订单与信心共同观察；基准各不相同。",
    metrics: [
      "cycle:cli",
      "cycle:businessConfidence",
      "cycle:consumerConfidence",
      "cycle:pmiManufacturing",
      "cycle:pmiNewOrders",
      "cycle:pmiNonManufacturing",
    ],
  },
  {
    id: "history",
    name: "长期背景",
    hint: "年度全球比较，结合历史事件观察结构变化。",
    metrics: [
      "annual:gdp",
      "annual:growth",
      "annual:inflation",
      "annual:gdpPerCapita",
      "annual:unemployment",
      "annual:trade",
      "debt:governmentDebt",
      "debt:governmentInterestBurden",
    ],
  },
];

export const MATRIX_METRICS = [
  ["annual:gdp", "GDP 规模", "年度"],
  ["cycle:gdpGrowth", "实际增长", "季度同比"],
  ["cycle:inflation", "CPI", "月度同比"],
  ["cycle:unemployment", "失业率", "月度"],
  ["cycle:policyRate", "政策利率", "月度"],
  ["debt:privateDebt", "私人债务", "占 GDP"],
] as const;

export function researchMetrics(repository: EconomicRepository, state: ResearchState) {
  const preset = RESEARCH_PRESETS.find((item) => item.id === state.preset)!;
  const supported = (id: string) =>
    repository.metrics.some(
      (metric) =>
        metric.id === id &&
        (state.focus
          ? metric.countries.includes(state.focus)
          : state.countries.some((country) => metric.countries.includes(country))),
    );
  let base = preset.metrics.filter(supported).slice(0, 8);
  if (!base.length)
    base = RESEARCH_PRESETS.find((item) => item.id === "history")!
      .metrics.filter(supported)
      .slice(0, 6);
  return [...new Set([...base, ...state.pins])].flatMap((id) => {
    const metric = repository.metrics.find((item) => item.id === id);
    return metric ? [metric] : [];
  });
}
