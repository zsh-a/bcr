/**
 * 模板注册表：真实地区 + 账单模板索引，以及输入 → 确定性 rng 的派生。
 * 地区 / 货币 / 品牌按真实参考件对齐；单号、用量与金额均为示例数据。
 */

import { fnv1a, mulberry32 } from "./hash";
import type { BillInput, BillTemplate, RegionId } from "./model";
import { auAglGas, auEnergyAustraliaPower } from "./templates/au-bills";
import { caBcHydroPower, caEnmaxPower, caHydroOnePower } from "./templates/ca-bills";
import { wlHeizkosten } from "./templates/de-bills";
import { hkElectricityPower, hkWaterBill } from "./templates/hk-bills";
import { sgSingtelTelecom } from "./templates/sg-bills";
import { ukBritishGasGas, ukEonNextPower, ukThamesWaterWater } from "./templates/uk-bills";

export interface RegionDef {
  readonly id: RegionId;
  /** 中文名 */
  readonly label: string;
  readonly labelEn: string;
  readonly flag: string;
  /** 主题色（与模板 accent 一致） */
  readonly accent: string;
  readonly description: string;
}

export const REGIONS: ReadonlyArray<RegionDef> = [
  {
    id: "australia",
    label: "澳大利亚",
    labelEn: "Australia",
    flag: "🇦🇺",
    accent: "#0072bc",
    description: "燃气 / 电费账单（GST 10% 内含 + BPAY）",
  },
  {
    id: "canada",
    label: "加拿大",
    labelEn: "Canada",
    flag: "🇨🇦",
    accent: "#0057b8",
    description: "电费账单（Step 1/2 阶梯 · GST/HST · 多服务合并单）",
  },
  {
    id: "hongkong",
    label: "中国香港",
    labelEn: "Hong Kong",
    flag: "🇭🇰",
    accent: "#14507c",
    description: "双语电费单 / 水费单（分级收费 + 缴款回条）",
  },
  {
    id: "singapore",
    label: "新加坡",
    labelEn: "Singapore",
    flag: "🇸🇬",
    accent: "#e2262e",
    description: "电信账单（分服务 section · GST 9% · GIRO）",
  },
  {
    id: "uk",
    label: "英国",
    labelEn: "United Kingdom",
    flag: "🇬🇧",
    accent: "#003a70",
    description: "燃气 / 电费 / 水费账单（VAT 5% / 免 VAT · Direct Debit）",
  },
  {
    id: "germany",
    label: "德国",
    labelEn: "Germany",
    flag: "🇩🇪",
    accent: "#e2001a",
    description: "暖气费分摊年度结算单（Heizkostenabrechnung）",
  },
];

export const TEMPLATES: ReadonlyArray<BillTemplate> = [
  auAglGas,
  auEnergyAustraliaPower,
  caBcHydroPower,
  caEnmaxPower,
  caHydroOnePower,
  hkElectricityPower,
  hkWaterBill,
  sgSingtelTelecom,
  ukBritishGasGas,
  ukEonNextPower,
  ukThamesWaterWater,
  wlHeizkosten,
];

export function listTemplates(regionId?: RegionId): ReadonlyArray<BillTemplate> {
  if (regionId === undefined) return TEMPLATES;
  return TEMPLATES.filter((t) => t.regionId === regionId);
}

export function getTemplate(docType: string): BillTemplate | undefined {
  return TEMPLATES.find((t) => t.docType === docType);
}

/**
 * 输入 → 确定性 PRNG：seed 只含 docType + name + address（键序规范化），
 * 不含账单日期——同一客户信息改日期，用量与编号保持稳定。
 */
export function rngForInput(input: BillInput): () => number {
  const address = Object.keys(input.address)
    .sort()
    .map((key) => `${key}=${input.address[key] ?? ""}`)
    .join("|");
  return mulberry32(fnv1a(`${input.docType}::${input.name}::${address}`));
}
