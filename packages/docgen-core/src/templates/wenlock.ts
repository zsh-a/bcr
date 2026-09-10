/**
 * 虚构地区「温洛克郡 Wenlock」：英国账单流派。
 * - wn_energy  Wenlock Energy：dual fuel 单——Electricity（MPAN）+ Gas（MPRN）两 section，
 *   各 standing charge（p/day × 天数）+ unit rate（p/kWh × 用量），VAT 5%，
 *   抄表读数带 e(estimated)/a(actual) 标记，tariff name + Direct Debit 提示
 * - wn_water   Weald Water：water + sewerage 分行、民用水不收 VAT（0%，带说明行）、半年账期
 * 地址字段：streetNo / streetName / city / postcode（英制 pattern）。
 */

import type { BillInput, BillTemplate, BillViewModel, ChargeSection, RenderOptions } from "../model";
import {
  buildBase,
  formatInt,
  renderSectionShell,
  renderShell,
  round2,
  type TemplateMeta,
} from "./common";
import { fnv1a, mulberry32 } from "../hash";

const WENLOCK_FIELDS = [
  { kind: "text", key: "streetNo", label: "门牌号", placeholder: "12", required: true, maxLength: 6, pattern: /^\d{1,5}[A-Z]?$/ },
  { kind: "text", key: "streetName", label: "街道名", placeholder: "Mill Lane", required: true, maxLength: 50 },
  { kind: "text", key: "city", label: "城市", placeholder: "Wenlock", required: true, maxLength: 40 },
  { kind: "text", key: "postcode", label: "邮编", placeholder: "WN4 2QA", required: true, maxLength: 8, pattern: /^[A-Z]{2}\d{1,2}\s?\d[A-Z]{2}$/ },
] as const;

const ENERGY_META: TemplateMeta = {
  docType: "wn_energy",
  regionId: "wenlock",
  kind: "power",
  utilityName: "Wenlock Energy",
  utilityNameZh: "温洛克能源",
  tagline: "Fictional dual fuel supplier",
  currency: "WNP",
  prefix: "WNE",
  periodDays: 90,
  accent: "#5a3a7a",
  locale: "en-GB",
};

const WATER_META: TemplateMeta = {
  docType: "wn_water",
  regionId: "wenlock",
  kind: "water",
  utilityName: "Weald Water",
  utilityNameZh: "威尔德水务",
  tagline: "Fictional water & sewerage company",
  currency: "WNP",
  prefix: "WLW",
  periodDays: 180,
  accent: "#1f6f6f",
  locale: "en-GB",
};

function digits(rng: () => number, n: number): string {
  return Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
}

/** MPAN：13 位分组数字（装饰性格式，非真实表号） */
function fakeMpan(rng: () => number): string {
  return `${digits(rng, 2)} ${digits(rng, 4)} ${digits(rng, 4)} ${digits(rng, 3)}`;
}

/** MPRN：10 位数字（装饰性格式） */
function fakeMprn(rng: () => number): string {
  return digits(rng, 10);
}

/** 抄表读数标记：a = actual / e = estimated（确定性派生） */
function marker(rng: () => number): "a" | "e" {
  return rng() < 0.6 ? "a" : "e";
}

export const wnEnergy: BillTemplate = {
  docType: ENERGY_META.docType,
  regionId: "wenlock",
  label: "电气双燃料账单",
  kind: "power",
  fields: WENLOCK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, ENERGY_META);
    const days = ENERGY_META.periodDays;
    // Electricity section
    const kwh = 600 + Math.floor(rng() * 800);
    const elecPrev = 12000 + Math.floor(rng() * 8000);
    const elecStanding = round2(days * 0.486);
    const elecUnit = round2(kwh * 0.263);
    const elecTotal = round2(elecStanding + elecUnit);
    // Gas section（m³ 换算 kWh 显示在摘要里）
    const gasM3 = 120 + Math.floor(rng() * 300);
    const gasKwh = Math.round(gasM3 * 11.1);
    const gasPrev = 4300 + Math.floor(rng() * 2000);
    const gasStanding = round2(days * 0.312);
    const gasUnit = round2(gasKwh * 0.071);
    const gasTotal = round2(gasStanding + gasUnit);
    const elecSection: ChargeSection = {
      title: "Electricity · 电力",
      subtitle: `MPAN ${fakeMpan(rng)}`,
      lines: [
        { label: `Electricity standing charge · ${days} days × 48.6p/day`, amount: elecStanding },
        { label: `Electricity unit rate · ${formatInt(kwh)} kWh × 26.3p/kWh`, amount: elecUnit },
      ],
      sectionTotal: elecTotal,
    };
    const gasSection: ChargeSection = {
      title: "Gas · 燃气",
      subtitle: `MPRN ${fakeMprn(rng)}`,
      lines: [
        { label: `Gas standing charge · ${days} days × 31.2p/day`, amount: gasStanding },
        { label: `Gas unit rate · ${formatInt(gasKwh)} kWh × 7.1p/kWh`, amount: gasUnit },
      ],
      sectionTotal: gasTotal,
    };
    const sections = [elecSection, gasSection];
    const charges = sections.flatMap((s) => s.lines);
    const subtotal = round2(elecTotal + gasTotal);
    const tax = round2(subtotal * 0.05);
    const total = round2(subtotal + tax);
    return {
      docType: ENERGY_META.docType,
      regionId: "wenlock",
      kind: "power",
      utilityName: ENERGY_META.utilityName,
      utilityNameZh: ENERGY_META.utilityNameZh,
      tagline: ENERGY_META.tagline,
      currency: ENERGY_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: ENERGY_META.periodDays,
      meterRows: [
        {
          label: "Electricity meter",
          previous: `${formatInt(elecPrev)} ${marker(rng)}`,
          current: `${formatInt(elecPrev + kwh)} ${marker(rng)}`,
          usage: `${formatInt(kwh)} kWh`,
        },
        {
          label: "Gas meter",
          previous: `${formatInt(gasPrev)} ${marker(rng)}`,
          current: `${formatInt(gasPrev + gasM3)} ${marker(rng)}`,
          usage: `${formatInt(gasM3)} m³`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh elec + ${formatInt(gasKwh)} kWh gas`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges,
      sections,
      subtotal,
      taxLabel: "VAT at 5%",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Readings marked 'a' are actual; 'e' are estimated.",
        "Domestic energy is charged VAT at the reduced 5% rate.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderSectionShell(vm, ENERGY_META, "", opts, {
      flavor: "uk",
      tariffLine: "Tariff: Standard Variable (fictional)",
    });
  },
};

export const wnWater: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "wenlock",
  label: "水费账单",
  kind: "water",
  fields: WENLOCK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const m3 = 40 + Math.floor(rng() * 120);
    const previousReading = 900 + Math.floor(rng() * 600);
    const currentReading = previousReading + m3;
    const water = round2(m3 * 1.86);
    const sewerage = round2(m3 * 1.21);
    const subtotal = round2(water + sewerage);
    // 民用水不收 VAT（0%）
    const tax = 0;
    const total = subtotal;
    return {
      docType: WATER_META.docType,
      regionId: "wenlock",
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
          label: "Meter (m³)",
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
        { label: `Water · ${formatInt(m3)} m³ × WNP 1.86/m³`, amount: water },
        { label: `Sewerage · ${formatInt(m3)} m³ × WNP 1.21/m³`, amount: sewerage },
      ],
      subtotal,
      taxLabel: "VAT — domestic water & sewerage are zero-rated (0%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Domestic water and sewerage charges carry no VAT — that is why this bill has no tax line.",
        "This is a half-yearly bill covering 180 days.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, WATER_META, "", opts);
  },
};
