/**
 * 虚构地区「龍城 Lung Shing」：香港账单流派（双语 EN + 繁中）。
 * - lc_water  龍城水務 Lung Shing Water Services：季度、四级分级水价（首级免费）+ 排污费分行、
 *   底部缴款回条（商户编号 + 条码 + 类 FPS 伪 QR + 缴款限期）
 * - lc_power  龍城電力 Lung Shing Electric：双月账期、分级电量电价 + 燃料调整费分行
 * 地址字段：flat（Flat A, 12/F）/ estate（屋邨）/ district。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import { fnv1a } from "../hash";
import {
  addDaysIso,
  buildBase,
  formatInt,
  renderHkShell,
  round2,
  type TemplateMeta,
} from "./common";

const LONGCHENG_FIELDS = [
  { kind: "text", key: "flat", label: "单位", placeholder: "Flat A, 12/F", required: true, maxLength: 40 },
  { kind: "text", key: "estate", label: "屋邨 / 屋苑", placeholder: "Lung Wah Estate, Block 3", required: true, maxLength: 60 },
  { kind: "text", key: "district", label: "地区", placeholder: "Lung Shing East", required: true, maxLength: 40 },
] as const;

const WATER_META: TemplateMeta = {
  docType: "lc_water",
  regionId: "longcheng",
  kind: "water",
  utilityName: "Lung Shing Water Services",
  utilityNameZh: "龍城水務",
  tagline: "Fictional municipal water supplies",
  currency: "LKD",
  prefix: "LSW",
  periodDays: 90,
  accent: "#14507c",
  locale: "en-HK",
};

const POWER_META: TemplateMeta = {
  docType: "lc_power",
  regionId: "longcheng",
  kind: "power",
  utilityName: "Lung Shing Electric",
  utilityNameZh: "龍城電力",
  tagline: "Fictional power utility of Lung Shing",
  currency: "LKD",
  prefix: "LSE",
  periodDays: 60,
  accent: "#b3701a",
  locale: "en-HK",
};

export const lcWater: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "longcheng",
  label: "水费单",
  kind: "water",
  fields: LONGCHENG_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const m3 = 30 + Math.floor(rng() * 90);
    const previousReading = 4200 + Math.floor(rng() * 3000);
    const currentReading = previousReading + m3;
    // 四级分级水价：首级 12 m³ 免费，逐级加价
    const t1 = Math.min(m3, 12);
    const t2 = Math.min(Math.max(m3 - 12, 0), 30);
    const t3 = Math.min(Math.max(m3 - 42, 0), 19);
    const t4 = Math.max(m3 - 61, 0);
    const a1 = 0;
    const a2 = round2(t2 * 4.16);
    const a3 = round2(t3 * 6.45);
    const a4 = round2(t4 * 9.05);
    // 排污费：按用水量 70% 计
    const sewage = round2(m3 * 0.7 * 2.92);
    const subtotal = round2(a1 + a2 + a3 + a4 + sewage);
    const total = subtotal; // 水费无税项
    return {
      docType: WATER_META.docType,
      regionId: "longcheng",
      kind: "water",
      utilityName: WATER_META.utilityName,
      utilityNameZh: WATER_META.utilityNameZh,
      tagline: WATER_META.tagline,
      currency: WATER_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: WATER_META.periodDays,
      meterRows: [
        {
          label: "水錶 Water meter",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(m3)} m³`,
        },
      ],
      usageSummary: `${formatInt(m3)} m³`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Tier 1 第一級（免費）· ${formatInt(t1)} m³ × LKD 0.00`, amount: a1 },
        { label: `Tier 2 第二級 · ${formatInt(t2)} m³ × LKD 4.16`, amount: a2 },
        { label: `Tier 3 第三級 · ${formatInt(t3)} m³ × LKD 6.45`, amount: a3 },
        { label: `Tier 4 第四級 · ${formatInt(t4)} m³ × LKD 9.05`, amount: a4 },
        { label: `Sewage charge 排污費 · ${formatInt(m3)} m³ × 70% × LKD 2.92`, amount: sewage },
      ],
      subtotal,
      taxLabel: "No tax 無稅項",
      tax: 0,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "第一級用水量免費。Tier 1 consumption is free of charge.",
        "逾期繳費將加收附加費。A surcharge applies to overdue accounts.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    // 商户编号：缴费灵风格 2 位数字（虚构）
    return renderHkShell(vm, WATER_META, "", opts, { merchantNo: "82" });
  },
};

export const lcPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "longcheng",
  label: "电费单",
  kind: "power",
  fields: LONGCHENG_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 300 + Math.floor(rng() * 900);
    const previousReading = 21400 + Math.floor(rng() * 9000);
    const currentReading = previousReading + kwh;
    // 分级电量电价（双月）：400 / 400 / 400 / 超出
    const b1 = Math.min(kwh, 400);
    const b2 = Math.min(Math.max(kwh - 400, 0), 400);
    const b3 = Math.min(Math.max(kwh - 800, 0), 400);
    const b4 = Math.max(kwh - 1200, 0);
    const a1 = round2(b1 * 0.93);
    const a2 = round2(b2 * 1.08);
    const a3 = round2(b3 * 1.24);
    const a4 = round2(b4 * 1.42);
    // 燃料调整费：按每度电 46.0 仙
    const fuel = round2(kwh * 0.46);
    const others = 0; // 其他收費（本期无）
    const subtotal = round2(a1 + a2 + a3 + a4 + fuel + others);
    const total = subtotal;
    // 平均每日用電量柱图：近 12 期（双月账期，跨年），值 = 各期用量 / 60 天
    const bars = Array.from({ length: 12 }, (_, i) => {
      const back = 11 - i;
      const iso = addDaysIso(base.billDateIso, -60 * back);
      const periodKwh = i === 11 ? kwh : Math.round(kwh * (0.65 + rng() * 0.7));
      return {
        label: `${iso.slice(5, 7)}/${iso.slice(2, 4)}`,
        value: Math.round((periodKwh / 60) * 10) / 10,
      };
    });
    return {
      docType: POWER_META.docType,
      regionId: "longcheng",
      kind: "power",
      utilityName: POWER_META.utilityName,
      utilityNameZh: POWER_META.utilityNameZh,
      tagline: POWER_META.tagline,
      currency: POWER_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: POWER_META.periodDays,
      meterRows: [
        {
          label: "電錶 Electricity meter",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh`,
      bars,
      barUnit: "度/日 kWh/day",
      barTitle: "平均每日用電量",
      charges: [
        { label: `Block 1 第一級收費 · ${formatInt(b1)} kWh × LKD 0.93`, amount: a1 },
        { label: `Block 2 第二級收費 · ${formatInt(b2)} kWh × LKD 1.08`, amount: a2 },
        { label: `Block 3 第三級收費 · ${formatInt(b3)} kWh × LKD 1.24`, amount: a3 },
        { label: `Block 4 第四級收費 · ${formatInt(b4)} kWh × LKD 1.42`, amount: a4 },
        { label: `Fuel cost adjustment 燃料調整費 · ${formatInt(kwh)} kWh × 46.0 仙`, amount: fuel },
        { label: "Other charges 其他收費", amount: others },
      ],
      subtotal,
      taxLabel: "No tax 無稅項",
      tax: 0,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "燃料調整費按實報實銷原則每月調整。The fuel cost adjustment is reconciled monthly at cost.",
        "本賬單涵蓋兩個月用電量。This bill covers a two-month consumption period.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const energy = round2(
      vm.charges.filter((c) => c.label.startsWith("Block")).reduce((s, c) => s + c.amount, 0),
    );
    const fuel = vm.charges.find((c) => c.label.includes("Fuel cost adjustment"))?.amount ?? 0;
    const others = vm.charges.find((c) => c.label.startsWith("Other charges"))?.amount ?? 0;
    // 按金：hash 确定性派生（显示项，不计入应缴总数）
    const deposit = round2(400 + (fnv1a(`deposit::${vm.accountNumber}`) % 90000) / 100);
    return renderHkShell(vm, POWER_META, "", opts, {
      merchantNo: "17",
      accountBarcode: true,
      formula: { energy, fuel, others },
      deposit,
      stubOcr: true,
    });
  },
};
