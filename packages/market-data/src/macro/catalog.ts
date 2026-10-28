import type { MacroIndicator } from "./model";

export const MACRO_START_YEAR = 1980;
export const MACRO_END_YEAR = 2025;
export const MACRO_SOURCE = "World Bank: World Development Indicators";
export const MACRO_SOURCE_URL =
  "https://databank.worldbank.org/source/world-development-indicators";
export const MACRO_LICENSE_URL = "https://data.worldbank.org/summary-terms-of-use";

export const MACRO_INDICATORS: MacroIndicator[] = [
  {
    id: "growth",
    name: "实际 GDP 增速",
    shortName: "GDP 增速",
    code: "NY.GDP.MKTP.KD.ZG",
    unit: "percent",
    description: "按不变价计算的 GDP 年度增长率，单位为 %。衡量实际产出变化，不含价格变化。",
  },
  {
    id: "inflation",
    name: "CPI 年度通胀率",
    shortName: "CPI 通胀",
    code: "FP.CPI.TOTL.ZG",
    unit: "percent",
    description:
      "消费者价格指数的年度变化率，单位为 %。这是年度指标，不等同于某个月同比或年末同比。",
  },
  {
    id: "gdp",
    name: "名义 GDP",
    shortName: "GDP 总量",
    code: "NY.GDP.MKTP.CD",
    unit: "usd",
    description: "按当期价格和汇率折算的 GDP，单位为现价美元；其变化同时受产出、价格和汇率影响。",
  },
  {
    id: "gdpPerCapita",
    name: "人均 GDP",
    shortName: "人均 GDP",
    code: "NY.GDP.PCAP.CD",
    unit: "usd",
    description:
      "名义 GDP 除以年中人口，单位为现价美元。未作购买力平价调整，不宜直接解释为实际生活水平。",
  },
  {
    id: "unemployment",
    name: "失业率",
    shortName: "失业率",
    code: "SL.UEM.TOTL.ZS",
    unit: "percent",
    description: "失业人口占劳动力的比例，单位为 %；采用 ILO 模型估计，不等同于各国登记失业率。",
  },
  {
    id: "trade",
    name: "贸易占 GDP 比重",
    shortName: "贸易开放度",
    code: "NE.TRD.GNFS.ZS",
    unit: "percent",
    description: "商品与服务进出口总额占 GDP 的比例，单位为 %；可超过 100%。",
  },
];

/** Common names override CLDR labels where a short display name is clearer. */
export const MACRO_COUNTRY_NAMES: Readonly<Record<string, string>> = {
  CHN: "中国",
  USA: "美国",
  JPN: "日本",
  DEU: "德国",
  GBR: "英国",
  FRA: "法国",
  IND: "印度",
  BRA: "巴西",
  CAN: "加拿大",
  AUS: "澳大利亚",
  KOR: "韩国",
  RUS: "俄罗斯",
  ITA: "意大利",
  ESP: "西班牙",
  MEX: "墨西哥",
  IDN: "印度尼西亚",
  TUR: "土耳其",
  ZAF: "南非",
  SAU: "沙特阿拉伯",
  ARG: "阿根廷",
  SGP: "新加坡",
  CHE: "瑞士",
  HKG: "中国香港",
  MAC: "中国澳门",
  VNM: "越南",
  THA: "泰国",
  MYS: "马来西亚",
  PHL: "菲律宾",
  NZL: "新西兰",
  IRN: "伊朗",
  EGY: "埃及",
  NGA: "尼日利亚",
};
