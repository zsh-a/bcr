/**
 * 模板注册表：虚构地区 + 账单模板索引，以及输入 → 确定性 rng 的派生。
 */

import { fnv1a, mulberry32 } from "./hash";
import type { BillInput, BillTemplate, RegionId } from "./model";
import { ciGas, ciTelecom } from "./templates/caldera";
import { csPower, csWater } from "./templates/castellan";
import { nhPower, nhWater } from "./templates/nordhavn";
import { vdPower, vdWater } from "./templates/veridia";

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
