import type { CycleIndicatorId, CyclePhase } from "./model";

export const CYCLE_COUNTRIES = [
  { id: "CHN", iso2: "CN", name: "中国", englishName: "China", region: "东亚" },
  { id: "USA", iso2: "US", name: "美国", englishName: "United States", region: "北美" },
  { id: "JPN", iso2: "JP", name: "日本", englishName: "Japan", region: "东亚" },
  { id: "DEU", iso2: "DE", name: "德国", englishName: "Germany", region: "欧洲" },
  { id: "GBR", iso2: "GB", name: "英国", englishName: "United Kingdom", region: "欧洲" },
];
export interface CycleIndicatorDefinition {
  id: CycleIndicatorId;
  name: string;
  pillar: string;
  description: string;
  indexGrowth?: boolean;
}
export const CYCLE_INDICATORS: CycleIndicatorDefinition[] = [
  {
    id: "cli",
    name: "综合领先指标 CLI",
    pillar: "领先景气",
    description: "OECD 振幅调整领先指标，100 为长期趋势基准。低于 100 不等于 GDP 负增长。",
  },
  {
    id: "industrialProduction",
    name: "工业生产",
    pillar: "生产",
    indexGrowth: true,
    description: "指数序列转换为同比；来源直接提供的同比保留原值。季调和统计范围差异见各序列说明。",
  },
  {
    id: "retailVolume",
    name: "实际零售",
    pillar: "需求",
    indexGrowth: true,
    description: "按实际零售量指数计算同比，未用名义零售冒充实际需求。",
  },
  {
    id: "realConsumption",
    name: "实际个人消费",
    pillar: "需求",
    indexGrowth: true,
    description: "美国实际 PCE，包含服务消费；与商品零售的范围不同，单独展示。",
  },
  {
    id: "unemployment",
    name: "月度失业率",
    pillar: "就业",
    description: "展示原始失业率及近期变化。不同调查范围不可直接用于判断国家经济强弱。",
  },
  {
    id: "inflation",
    name: "月度 CPI 同比",
    pillar: "物价",
    description: "消费者价格指数同比变化率，作为物价背景，不直接判定经济衰退。",
  },
  {
    id: "coreInflation",
    name: "核心 CPI 同比",
    pillar: "物价",
    description: "剔除相应食品与能源项目后的价格变化，具体排除范围见来源。",
  },
  {
    id: "gdpGrowth",
    name: "季度实际 GDP 同比",
    pillar: "实体核对",
    description: "OECD 季度实际 GDP 较上年同季变化率，保留各国官方季调说明。",
  },
  {
    id: "gdpQuarterlyAnnualized",
    name: "美国 GDP 季调折年率",
    pillar: "实体核对",
    description: "美国实际 GDP 较前季变化的季调折年率（SAAR），与同比单独展示。",
  },
  {
    id: "pmiManufacturing",
    name: "制造业 PMI",
    pillar: "订单与调查",
    description: "50 为月度调查扩张与收缩分界，不是 GDP 增速。",
  },
  {
    id: "pmiNewOrders",
    name: "PMI 新订单",
    pillar: "订单与调查",
    description: "观察需求是否向企业订单传导，结合方向和生产验证。",
  },
  {
    id: "pmiServices",
    name: "服务业活动",
    pillar: "订单与调查",
    description: "纯服务业调查活动指标，不能与包含建筑业的非制造业活动混用。",
  },
  {
    id: "pmiNonManufacturing",
    name: "非制造业商务活动",
    pillar: "订单与调查",
    description: "中国官方非制造业商务活动包含建筑业与服务业，不是纯服务业 PMI。",
  },
  {
    id: "payrolls",
    name: "非农就业",
    pillar: "就业",
    indexGrowth: true,
    description: "美国非农就业人数同比，原始人数及其单位保留在数据资源中。",
  },
  {
    id: "initialClaims",
    name: "首次申领失业金",
    pillar: "就业",
    description: "美国周度初请人数，短期波动较大，不能单独作为衰退判定。",
  },
  {
    id: "cfnaima3",
    name: "CFNAI 三月均值",
    pillar: "同步景气",
    description: "美国综合活动相对历史趋势的偏离，零并非 GDP 零增长。",
  },
  {
    id: "nfci",
    name: "金融条件 NFCI",
    pillar: "金融条件",
    description: "美国金融条件相对历史均值，正值偏紧、负值偏松。",
  },
  {
    id: "yieldSpread",
    name: "10年－3个月利差",
    pillar: "金融条件",
    description: "美国国债期限利差，单位为百分点；预警未来风险，不判定当前衰退。",
  },
  {
    id: "realIncome",
    name: "实际收入（扣转移）",
    pillar: "需求",
    indexGrowth: true,
    description: "美国扣除转移支付后的实际个人收入，观察市场收入与购买力变化。",
  },
  {
    id: "policyRate",
    name: "政策参考利率（BIS）",
    pillar: "政策传导",
    description:
      "BIS 为各经济体选定的月末政策参考利率。中国采用一年期 LPR 等历史工具，德国对应欧元区；工具切换及缺口见国别说明。",
  },
  {
    id: "realPolicyRate",
    name: "事后实际利率近似",
    pillar: "政策传导",
    description:
      "月末政策参考利率减同期 CPI 同比，严格同月计算；不是预期实际利率、自然利率或政策松紧的统一阈值。",
  },
  {
    id: "realHousePrices",
    name: "实际住宅价格同比",
    pillar: "房地产",
    description:
      "BIS 经 CPI 调整的住宅价格同比；各国地域、新旧住宅和历史衔接口径有差异，见国别说明。",
  },
  {
    id: "nominalHousePrices",
    name: "名义住宅价格同比",
    pillar: "房地产",
    description:
      "BIS 名义住宅价格同比，与实际房价分开。中国等序列的地域和新旧房口径不同，不代表统一全国房价。",
  },
  {
    id: "housingStarts",
    name: "美国住宅开工",
    pillar: "房地产",
    description: "美国私人住宅新开工数量，千套、季调折年水平；不是当月实际开工套数。",
  },
  {
    id: "buildingPermits",
    name: "美国住宅建筑许可",
    pillar: "房地产",
    description: "美国私人住宅建筑许可，千套、季调折年水平；与实际开工和完工分开。",
  },
  {
    id: "housingSalesYtd",
    name: "中国商品房销售累计同比",
    pillar: "房地产",
    description: "年初至本月累计商品房销售面积同比，不是单月销售增速。",
  },
  {
    id: "housingStartsYtd",
    name: "中国房屋新开工累计同比",
    pillar: "房地产",
    description: "年初至本月累计房屋新开工面积同比，不是单月开工，也不等同美国住宅套数。",
  },
  {
    id: "realEstateInvestmentYtd",
    name: "中国房地产投资累计同比",
    pillar: "房地产",
    description: "年初至本月累计房地产开发投资同比，保留名义及累计口径。",
  },
  {
    id: "retailNominal",
    name: "中国社零名义同比",
    pillar: "需求",
    description: "社会消费品零售总额当月名义同比，不标记为实际消费；1—2月合并值不伪装为2月单月。",
  },
  {
    id: "jobOpenings",
    name: "美国职位空缺率",
    pillar: "就业边际",
    description: "BLS JOLTS 非农职位空缺率，季调；与失业率一起观察劳动需求变化。",
  },
  {
    id: "quitsRate",
    name: "美国主动离职率",
    pillar: "就业边际",
    description: "BLS JOLTS 主动离职率，季调；与裁员和总离职率不同。",
  },
  {
    id: "weeklyHours",
    name: "美国平均每周工时",
    pillar: "就业边际",
    description: "私人非农部门所有雇员的平均每周工时，季调；保留实际起始覆盖，不向前补历史。",
  },
  {
    id: "payrollChange",
    name: "美国非农月增量",
    pillar: "就业边际",
    description: "同一季调非农人数序列的本月减上月，千人；缺少任一月份时留空，不从同比反推。",
  },
  {
    id: "unemploymentGap",
    name: "美国失业率较低点抬升",
    pillar: "就业边际",
    description:
      "当前失业率三月均值减近12个月三月均值最低值，使用当前修订历史值；非实时萨姆指标，不设跨国统一衰退阈值。",
  },
  {
    id: "loanStandards",
    name: "美国企业贷款标准收紧",
    pillar: "贷款供需",
    description: "国内银行对大中型企业工商贷款标准收紧的净比例；正值表示净收紧，不是贷款增速。",
  },
  {
    id: "loanDemand",
    name: "美国企业贷款需求增强",
    pillar: "贷款供需",
    description:
      "国内银行报告大中型企业工商贷款需求增强的净比例；正值表示净需求增强，与标准收紧分别观察。",
  },
  {
    id: "corePriceIndex",
    name: "美国季调核心 CPI 指数",
    pillar: "通胀动量",
    description: "剔除食品与能源的季调价格指数，保留原始基期；用于计算短期价格动量，不是通胀率。",
  },
  {
    id: "priceIndex",
    name: "美国季调 CPI 指数",
    pillar: "通胀动量",
    description: "美国全项目季调价格指数，与未季调 CPI 同比口径分开。",
  },
  {
    id: "coreInflation3m",
    name: "美国核心 CPI 三月折年率",
    pillar: "通胀动量",
    description:
      "按季调核心价格指数计算：(本月 / 三个月前)^4 − 1；需要四个连续有效月，短期波动较大。",
  },
  {
    id: "privateDemandGrowth",
    name: "美国实际私人最终需求增速",
    pillar: "增长质量",
    description: "实际私人国内最终购买增速，按来源季调折年口径，剔除政府、净出口和库存变动的干扰。",
  },
  {
    id: "inventorySalesRatio",
    name: "美国库存销售比",
    pillar: "增长质量",
    description:
      "美国工商库存与销售额的比率，季调；库存变化可能反映备货或需求不足，需要与销售共同判断。",
  },
  {
    id: "capacityUtilization",
    name: "产能利用率",
    pillar: "增长质量",
    description: "按来源保留行业范围及频率，不同国家工业覆盖不可直接视为完全同口径。",
  },
  {
    id: "businessConfidence",
    name: "企业信心 BCI",
    pillar: "预期",
    description: "OECD 标准化企业信心指标，生产、订单和成品库存调查；基准与 PMI 的50分界不同。",
  },
  {
    id: "consumerConfidence",
    name: "消费者信心 CCI",
    pillar: "预期",
    description:
      "OECD 标准化消费者信心指标，观察家庭消费与储蓄预期；与 CLI 高度相关时不重复加权评分。",
  },
];
export const CYCLE_PHASE_LABELS: Record<CyclePhase, string> = {
  aboveRising: "高于趋势 · 改善",
  aboveFalling: "高于趋势 · 放缓",
  belowFalling: "低于趋势 · 走弱",
  belowRising: "低于趋势 · 修复",
  flat: "动量持平",
};
