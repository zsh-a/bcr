/**
 * 虚构地区「卡斯泰兰 Castellan」：欧式账单流派（极简双栏、细线、大留白）。
 * - cs_power  Lumen Energie 电费单：standing charge（日费×天数）+ unit rate + VAT 分行
 * - cs_water  Aqueduc Municipal 水费单：供水 / 污水处理分开计价 + VAT（季度账期）
 * 地址为欧式字段：street / city / postcode（数字+字母混合，如 "4812 EX"）。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  buildBase,
  formatInt,
  renderEuShell,
  round2,
  type TemplateMeta,
} from "./common";

const CASTELLAN_FIELDS = [
  { kind: "text", key: "street", label: "街道地址", placeholder: "24 Rue des Tilleuls", required: true, maxLength: 60 },
  { kind: "text", key: "city", label: "城市", placeholder: "Castelbrun", required: true, maxLength: 40 },
  { kind: "text", key: "postcode", label: "邮编", placeholder: "4812 EX", required: true, maxLength: 8, pattern: /^\d{4}\s?[A-Z]{2}$/ },
] as const;

const POWER_META: TemplateMeta = {
  docType: "cs_power",
  regionId: "castellan",
  kind: "power",
  utilityName: "Lumen Energie",
  utilityNameZh: "流明能源",
  tagline: "Énergie simple et claire (fictional supplier)",
  currency: "CFR",
  prefix: "LME",
  periodDays: 30,
  accent: "#0f6f6a",
};

const WATER_META: TemplateMeta = {
  docType: "cs_water",
  regionId: "castellan",
  kind: "water",
  utilityName: "Aqueduc Municipal",
  utilityNameZh: "市政水务局",
  tagline: "Régie municipale de l'eau (fictional)",
  currency: "CFR",
  prefix: "AQM",
  periodDays: 90,
  accent: "#3f5f8a",
};

export const csPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "castellan",
  label: "电费账单",
  kind: "power",
  fields: CASTELLAN_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 140 + Math.floor(rng() * 300);
    const previousReading = 15600 + Math.floor(rng() * 5200);
    const currentReading = previousReading + kwh;
    // 欧式构成：standing charge（日费 × 天数）+ unit rate（用量 × 单价）+ VAT
    const standing = round2(POWER_META.periodDays * 0.62);
    const usage = round2(kwh * 0.284);
    const subtotal = round2(standing + usage);
    const tax = round2(subtotal * 0.085);
    const total = round2(subtotal + tax);
    return {
      docType: POWER_META.docType,
      regionId: "castellan",
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
          label: "Meter (kWh)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Standing charge · ${POWER_META.periodDays} days × CFR 0.62/day`, amount: standing },
        { label: `Electricity · ${formatInt(kwh)} kWh × CFR 0.284/kWh`, amount: usage },
      ],
      subtotal,
      taxLabel: "VAT at 8.5%",
      tax,
      total,
      barcodePayload: `${POWER_META.prefix}${base.invoiceNumber.replaceAll("-", "")}`,
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Direct Debit guarantee: you are notified of any change 5 working days in advance.",
        "Standing charge is a fixed daily amount that applies even with zero usage.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderEuShell(vm, POWER_META, "", opts);
  },
};

export const csWater: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "castellan",
  label: "水费账单",
  kind: "water",
  fields: CASTELLAN_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const cubicMeters = 18 + Math.floor(rng() * 40);
    const previousReading = 640 + Math.floor(rng() * 320);
    const currentReading = previousReading + cubicMeters;
    // 供水与污水处理（sewerage）分开计价
    const water = round2(cubicMeters * 1.94);
    const sewerage = round2(cubicMeters * 1.36);
    const subtotal = round2(water + sewerage);
    const tax = round2(subtotal * 0.055);
    const total = round2(subtotal + tax);
    return {
      docType: WATER_META.docType,
      regionId: "castellan",
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
          usage: `${formatInt(cubicMeters)} m³`,
        },
      ],
      usageSummary: `${formatInt(cubicMeters)} m³`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Water supply · ${formatInt(cubicMeters)} m³ × CFR 1.94/m³`, amount: water },
        { label: `Sewerage · ${formatInt(cubicMeters)} m³ × CFR 1.36/m³`, amount: sewerage },
      ],
      subtotal,
      taxLabel: "VAT at 5.5%",
      tax,
      total,
      barcodePayload: `${WATER_META.prefix}${base.invoiceNumber.replaceAll("-", "")}`,
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Sewerage is charged on 100% of metered water for unmetered drainage areas.",
        "Quarterly billing; meter is read twice a year, estimates in between.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderEuShell(vm, WATER_META, "", opts);
  },
};
