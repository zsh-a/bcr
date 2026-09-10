/**
 * 模板注册表：虚构地区 + 账单模板索引，以及输入 → 确定性 rng 的派生。
 */

import { fnv1a, mulberry32 } from "./hash";
import type { BillInput, BillTemplate, RegionId } from "./model";
import { ciGas, ciTelecom } from "./templates/caldera";
import { coGas, coPower } from "./templates/coralia";
import { csPower, csWater } from "./templates/castellan";
import { eqTelecom, eqUtilities } from "./templates/equatoria";
import { lcPower, lcWater } from "./templates/longcheng";
import { nhPower, nhWater } from "./templates/nordhavn";
import { nlGas, nlPower } from "./templates/northland";
import { vdPower, vdWater } from "./templates/veridia";
import { wlGas, wlPower } from "./templates/waldland";
import { wnEnergy, wnWater } from "./templates/wenlock";

export interface RegionDef {
  readonly id: RegionId;
  /** 中文名 */
  readonly label: string;
  readonly labelEn: string;
  /** 虚构旗帜 emoji */
  readonly flag: string;
  /** 主题色（与模板 accent 一致） */
  readonly accent: string;
  readonly description: string;
}

export const REGIONS: ReadonlyArray<RegionDef> = [
  {
    id: "nordhavn",
    label: "诺德港",
    labelEn: "Nordhavn",
    flag: "🌊",
    accent: "#17577a",
    description: "虚构的北欧海港城市 · 水 / 电",
  },
  {
    id: "caldera",
    label: "卡德拉群岛",
    labelEn: "Caldera Isles",
    flag: "🌋",
    accent: "#a8503c",
    description: "虚构的火山群岛 · 燃气 / 宽带",
  },
  {
    id: "veridia",
    label: "维里迪亚",
    labelEn: "Veridia",
    flag: "🌲",
    accent: "#1b4f8a",
    description: "虚构的美式山谷州 · 电 / 水（阶梯水价）",
  },
  {
    id: "castellan",
    label: "卡斯泰兰",
    labelEn: "Castellan",
    flag: "🏰",
    accent: "#0f6f6a",
    description: "虚构的欧式市镇群 · 电 / 水（standing charge + VAT）",
  },
  {
    id: "waldland",
    label: "瓦尔德兰",
    labelEn: "Waldland",
    flag: "🦅",
    accent: "#7a1f2b",
    description: "虚构的德国林区县 · 电力 / 燃气年度结算（Abschlag 对冲）",
  },
  {
    id: "longcheng",
    label: "龍城",
    labelEn: "Lung Shing",
    flag: "🐉",
    accent: "#14507c",
    description: "虚构的香港式海港城 · 水 / 电（双语 + 缴款回条）",
  },
  {
    id: "coralia",
    label: "珊瑚洲",
    labelEn: "Coralia",
    flag: "🪸",
    accent: "#c75b32",
    description: "虚构的澳洲式海岸州 · 电 / 气（NMI·MIRN + BPAY）",
  },
  {
    id: "northland",
    label: "北境",
    labelEn: "Northland",
    flag: "🍁",
    accent: "#205c40",
    description: "虚构的加拿大式北部省 · 电（Step 1/2）/ 气（碳税分行）",
  },
  {
    id: "equatoria",
    label: "赤道城",
    labelEn: "Equatoria",
    flag: "🌆",
    accent: "#b03040",
    description: "虚构的新加坡式城邦 · 水电合一单 / 电信（GIRO）",
  },
  {
    id: "wenlock",
    label: "温洛克郡",
    labelEn: "Wenlock",
    flag: "🧭",
    accent: "#5a3a7a",
    description: "虚构的英国式郡县 · dual fuel / 水（VAT 5% / 免 VAT）",
  },
];

export const TEMPLATES: ReadonlyArray<BillTemplate> = [
  nhWater,
  nhPower,
  ciGas,
  ciTelecom,
  vdPower,
  vdWater,
  csPower,
  csWater,
  wlPower,
  wlGas,
  lcWater,
  lcPower,
  coPower,
  coGas,
  nlPower,
  nlGas,
  eqUtilities,
  eqTelecom,
  wnEnergy,
  wnWater,
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
