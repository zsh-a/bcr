import { CYCLE_COUNTRIES } from "../cycle/catalog";
import type { DebtIndicatorId, DebtUnit } from "./model";

export const DEBT_COUNTRIES = CYCLE_COUNTRIES;
export interface DebtIndicatorDefinition {
  id: DebtIndicatorId;
  name: string;
  group: string;
  description: string;
}
export const DEBT_INDICATORS: DebtIndicatorDefinition[] = [
  {
    id: "privateDebt",
    name: "非金融私人部门债务 / GDP",
    group: "杠杆",
    description:
      "居民与非金融企业的核心债务余额占 GDP 比重；企业包括公营和私营企业。并非全社会所有负债。",
  },
  {
    id: "householdDebt",
    name: "居民债务 / GDP",
    group: "杠杆",
    description: "住户及为住户服务的非营利机构的核心债务余额，占 GDP 比重。",
  },
  {
    id: "corporateDebt",
    name: "非金融企业债务 / GDP",
    group: "杠杆",
    description: "非金融企业包括公营与私营企业；保留来源的未合并部门口径。",
  },
  {
    id: "governmentDebt",
    name: "一般政府债务 / GDP",
    group: "杠杆",
    description:
      "BIS 一般政府核心债务，优先名义估值；与中央政府债务、净债务或 IMF 全工具口径不同。",
  },
  {
    id: "debtService",
    name: "私人部门偿债负担 DSR",
    group: "偿债",
    description:
      "私人非金融部门本金偿还与利息支付占收入的估计比率；主要比较本国历史变化，避免跨国绝对值排名。",
  },
  {
    id: "householdDebtService",
    name: "居民偿债负担 DSR",
    group: "偿债",
    description: "居民部门收入中用于还本付息的估计比例；各国制度和期限假设影响可比性。",
  },
  {
    id: "corporateDebtService",
    name: "企业偿债负担 DSR",
    group: "偿债",
    description: "非金融企业收入中用于还本付息的估计比例，关注相对本国历史的变化。",
  },
  {
    id: "creditGap",
    name: "信贷 / GDP 缺口",
    group: "信用",
    description:
      "BIS 私人部门信贷 / GDP 比率减单边长期趋势，单位为百分点。观察金融脆弱性，不是当季衰退判定。",
  },
  {
    id: "privateCreditStock",
    name: "私人部门本币信用余额",
    group: "信用",
    description: "BIS 经断点调整的私人非金融部门本币信用余额，保留币种；不同币种金额不直接比较。",
  },
  {
    id: "creditGrowth",
    name: "私人部门信贷同比",
    group: "信用",
    description:
      "按 BIS 断点调整本币信用余额严格计算较四季前同比，未进一步消除汇率或估值影响；并非信用脉冲。",
  },
  {
    id: "creditImpulse",
    name: "信用脉冲",
    group: "信用",
    description:
      "新增信用占名义 GDP 比例的变化；须有可比的融资流量与 GDP 分母，不能直接用债务比率差分替代。",
  },
  {
    id: "governmentInterestBurden",
    name: "财政利息支出 / 收入（GFS）",
    group: "财政",
    description:
      "IMF GFS / WDI 利息支出占收入的年度比例。各国财政覆盖范围与最新年份不同，不能视作统一的一般政府当期指标。",
  },
  {
    id: "governmentNetInterestBurden",
    name: "政府净利息支出 / 收入",
    group: "财政",
    description: "净利息支出扣除利息收入，与总利息支出单列。估计和预测逐条标注。",
  },
  {
    id: "fiscalBalance",
    name: "财政净借贷 / GDP（GFS）",
    group: "财政",
    description:
      "GFS 净借贷 / 净借入占 GDP，正值为净贷出、负值为净借入；财政覆盖范围按来源说明，与 BIS 一般政府核心债务不直接合并。",
  },
  {
    id: "socialFinancingGrowth",
    name: "中国社融存量同比",
    group: "中国融资",
    description: "人民银行可比口径社融存量同比。社融含股权等项目，不是纯债务或银行贷款。",
  },
  {
    id: "socialFinancingFlow",
    name: "中国当月新增社融",
    group: "中国融资",
    description: "当月社会融资规模增量，保留原始季节性；包含政府债券、企业融资与股权等。",
  },
  {
    id: "governmentBondFlow",
    name: "中国政府债券净融资",
    group: "中国融资",
    description: "政府债券当月净融资，是社融的组成部分，不与社融重复相加。",
  },
  {
    id: "corporateBondFlow",
    name: "中国企业债券净融资",
    group: "中国融资",
    description: "非金融企业债券当月净融资；保留原始当月值，不将年内累计值当作当月值。",
  },
  {
    id: "rmbLoanFlow",
    name: "中国实体人民币贷款增量",
    group: "中国融资",
    description: "社融口径对实体经济发放的人民币贷款当月增量，与全部金融机构贷款统计范围不同。",
  },
];
export const DEBT_UNIT_LABELS: Record<DebtUnit, string> = {
  percentGdp: "% GDP",
  percentIncome: "% 收入",
  percentRevenue: "% 财政收入",
  percent: "%",
  percentagePoints: "百分点",
  trillionLocal: "万亿",
  billionLocal: "十亿",
};
export const DEBT_FREQUENCY_LABELS = { Q: "季度", M: "月度", A: "年度" };
export const DEBT_BIS_TRANSLATION_NOTE =
  "来源：BIS；本页中文指标名称与说明为非官方翻译，不代表 BIS 认可或背书。";
