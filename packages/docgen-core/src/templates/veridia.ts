/**
 * 虚构地区「维里迪亚 Veridia」：美式账单流派。
 * - vd_power  Cascade Power & Light 电费单：Amount Due 大框 + 账户摘要
 *   （total = prev − payments + current）+ 12 期 kWh 柱状图 + delivery/supply/tax 明细
 *   + 撕线回单存根（空心金额框 + OCR 扫描行）
 * - vd_water  Bluehill Water District 水费单：HCF 阶梯水价 3 档分行计价
 * 地址为美式字段：streetNumber / streetName / city / state(2 字母) / zip(5 位)。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  addDaysIso,
  buildBase,
  formatInt,
  renderUsShell,
  round2,
  type TemplateMeta,
} from "./common";

const VERIDIA_FIELDS = [
  { kind: "text", key: "streetNumber", label: "门牌号", placeholder: "742", required: true, maxLength: 6, pattern: /^\d{1,5}$/ },
  { kind: "text", key: "streetName", label: "街道名", placeholder: "Birchwood Lane", required: true, maxLength: 50 },
  { kind: "text", key: "city", label: "城市", placeholder: "Bluehill", required: true, maxLength: 40 },
  { kind: "text", key: "state", label: "州（2 位缩写）", placeholder: "VD", required: true, maxLength: 2, pattern: /^[A-Z]{2}$/ },
  { kind: "text", key: "zip", label: "邮编 ZIP", placeholder: "74210", required: true, maxLength: 10, pattern: /^\d{5}(-\d{4})?$/ },
] as const;

const POWER_META: TemplateMeta = {
  docType: "vd_power",
  regionId: "veridia",
  kind: "power",
  utilityName: "Cascade Power & Light",
  utilityNameZh: "喀斯开电力照明公司",
  tagline: "Serving the Veridian valley since 1924 (fictional)",
  currency: "VDR",
  prefix: "CPL",
  periodDays: 30,
  accent: "#1b4f8a",
};

const WATER_META: TemplateMeta = {
  docType: "vd_water",
  regionId: "veridia",
  kind: "water",
  utilityName: "Bluehill Water District",
  utilityNameZh: "蓝山水务区",
  tagline: "A fictional public water district",
  currency: "VDR",
  prefix: "BWD",
  periodDays: 30,
  accent: "#2e7d6b",
};

function barcodePayload(meta: TemplateMeta, invoiceNumber: string): string {
  return invoiceNumber.replaceAll("-", "");
}

const MONTH_NAME = (iso: string): string =>
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(iso.slice(5, 7)) - 1
  ] ?? "?";

/** 美式账户摘要派生：上期余额、已收款（部分）、本期费用，total = prev − payments + current */
function accountSummary(rng: () => number, currentCharges: number) {
  const previousBalance = round2(58 + rng() * 170);
  const paymentsReceived = round2(previousBalance * (0.55 + rng() * 0.45));
  const total = round2(previousBalance - paymentsReceived + currentCharges);
  return { previousBalance, paymentsReceived, currentCharges, total };
}

export const vdPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "veridia",
  label: "电费账单",
  kind: "power",
  fields: VERIDIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 320 + Math.floor(rng() * 560);
    const previousReading = 21000 + Math.floor(rng() * 9000);
    const currentReading = previousReading + kwh;
    // 近 12 期用量：围绕本期波动（确定性 rng），最后一期 = 本期
    const bars = Array.from({ length: 12 }, (_, i) => {
      const backMonths = 11 - i;
      const iso = addDaysIso(base.billDateIso, -30 * backMonths);
      return {
        label: MONTH_NAME(iso),
        value: i === 11 ? kwh : Math.round(kwh * (0.7 + rng() * 0.6)),
      };
    });
    const delivery = round2(kwh * 0.118);
    const supply = round2(kwh * 0.094);
    const customerCharge = 12.5;
    const subtotal = round2(delivery + supply + customerCharge);
    const tax = round2(subtotal * 0.045);
    const summary = accountSummary(rng, round2(subtotal + tax));
    return {
      docType: POWER_META.docType,
      regionId: "veridia",
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
      bars,
      barUnit: "kWh",
      barTitle: "Usage history",
      charges: [
        { label: `Delivery charge · ${formatInt(kwh)} kWh × VDR 0.118`, amount: delivery },
        { label: `Supply charge · ${formatInt(kwh)} kWh × VDR 0.094`, amount: supply },
        { label: "Fixed customer charge", amount: customerCharge },
      ],
      subtotal,
      taxLabel: "State utility tax (4.5%)",
      tax,
      total: summary.total,
      accountSummary: {
        previousBalance: summary.previousBalance,
        paymentsReceived: summary.paymentsReceived,
        currentCharges: summary.currentCharges,
      },
      barcodePayload: barcodePayload(POWER_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${summary.total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Delivery covers poles, wires and meters; supply covers the energy itself.",
        "Budget billing spreads seasonal peaks across 12 equal payments.",
        "A late payment charge of 1.5% applies to balances unpaid after the due date.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderUsShell(vm, POWER_META, "", opts);
  },
};

export const vdWater: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "veridia",
  label: "水费账单",
  kind: "water",
  fields: VERIDIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const hcf = 8 + Math.floor(rng() * 34);
    const previousReading = 900 + Math.floor(rng() * 600);
    const currentReading = previousReading + hcf;
    // 3 档阶梯水价（HCF = hundred cubic feet）
    const tier1Qty = Math.min(hcf, 12);
    const tier2Qty = Math.min(Math.max(hcf - 12, 0), 16);
    const tier3Qty = Math.max(hcf - 28, 0);
    const tier1 = round2(tier1Qty * 3.82);
    const tier2 = round2(tier2Qty * 4.96);
    const tier3 = round2(tier3Qty * 6.35);
    const serviceCharge = 28.5;
    const subtotal = round2(tier1 + tier2 + tier3 + serviceCharge);
    const tax = round2(subtotal * 0.026);
    const summary = accountSummary(rng, round2(subtotal + tax));
    return {
      docType: WATER_META.docType,
      regionId: "veridia",
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
          label: "Meter (HCF)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(hcf)} HCF`,
        },
      ],
      usageSummary: `${formatInt(hcf)} HCF`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Tier 1 · ${formatInt(tier1Qty)} HCF × VDR 3.82`, amount: tier1 },
        { label: `Tier 2 · ${formatInt(tier2Qty)} HCF × VDR 4.96`, amount: tier2 },
        { label: `Tier 3 · ${formatInt(tier3Qty)} HCF × VDR 6.35`, amount: tier3 },
        { label: "Monthly service charge", amount: serviceCharge },
      ],
      subtotal,
      taxLabel: "Public utility fee (2.6%)",
      tax,
      total: summary.total,
      accountSummary: {
        previousBalance: summary.previousBalance,
        paymentsReceived: summary.paymentsReceived,
        currentCharges: summary.currentCharges,
      },
      barcodePayload: barcodePayload(WATER_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${summary.total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Conservation tiers: 0–12 HCF lifeline rate, 13–28 HCF standard, above 28 HCF peak rate.",
        "1 HCF = 100 cubic feet ≈ 748 gallons. District is fictional.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderUsShell(vm, WATER_META, "", opts);
  },
};
