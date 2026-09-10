/**
 * 虚构地区「北境 Northland」：加拿大账单流派。
 * - nl_power  Northpine Power：Step 1 / Step 2 阶梯住宅电价 + basic/delivery + regulatory + GST 5%
 * - nl_gas    Borealis Gas：delivery + commodity + carbon charge（per m³，标志性）+ GST 5%
 * 地址字段：streetNo / streetName / city / province(2 字母) / postalCode("A1A 1A1")。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  buildBase,
  formatInt,
  renderShell,
  round2,
  type TemplateMeta,
} from "./common";

const NORTHLAND_FIELDS = [
  { kind: "text", key: "streetNo", label: "门牌号", placeholder: "142", required: true, maxLength: 6, pattern: /^\d{1,5}$/ },
  { kind: "text", key: "streetName", label: "街道名", placeholder: "Spruce Hollow Road", required: true, maxLength: 50 },
  { kind: "text", key: "city", label: "城市", placeholder: "Northpine", required: true, maxLength: 40 },
  { kind: "text", key: "province", label: "省（2 位缩写）", placeholder: "NP", required: true, maxLength: 2, pattern: /^[A-Z]{2}$/ },
  { kind: "text", key: "postalCode", label: "邮政编码", placeholder: "N4P 2K1", required: true, maxLength: 7, pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/ },
] as const;

const POWER_META: TemplateMeta = {
  docType: "nl_power",
  regionId: "northland",
  kind: "power",
  utilityName: "Northpine Power",
  utilityNameZh: "北松电力",
  tagline: "Fictional regulated electric utility",
  currency: "NLR",
  prefix: "NPP",
  periodDays: 60,
  accent: "#205c40",
  locale: "en-CA",
};

const GAS_META: TemplateMeta = {
  docType: "nl_gas",
  regionId: "northland",
  kind: "gas",
  utilityName: "Borealis Gas",
  utilityNameZh: "北极光燃气",
  tagline: "Fictional natural gas distributor",
  currency: "NLR",
  prefix: "BGS",
  periodDays: 30,
  accent: "#7a4a1f",
  locale: "en-CA",
};

export const nlPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "northland",
  label: "电费账单",
  kind: "power",
  fields: NORTHLAND_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 500 + Math.floor(rng() * 1300);
    const previousReading = 41000 + Math.floor(rng() * 12000);
    const currentReading = previousReading + kwh;
    // Step 1 / Step 2 阶梯住宅电价（双月 Step 1 额度 1350 kWh）
    const step1Qty = Math.min(kwh, 1350);
    const step2Qty = Math.max(kwh - 1350, 0);
    const basic = round2(POWER_META.periodDays * 0.42);
    const step1 = round2(step1Qty * 0.1087);
    const step2 = round2(step2Qty * 0.1618);
    const regulatory = round2(kwh * 0.0311);
    const subtotal = round2(basic + step1 + step2 + regulatory);
    const tax = round2(subtotal * 0.05);
    const total = round2(subtotal + tax);
    return {
      docType: POWER_META.docType,
      regionId: "northland",
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
        { label: `Basic charge · ${POWER_META.periodDays} days × NLR 0.42/day`, amount: basic },
        { label: `Step 1 · ${formatInt(step1Qty)} kWh × NLR 0.1087`, amount: step1 },
        { label: `Step 2 · ${formatInt(step2Qty)} kWh × NLR 0.1618`, amount: step2 },
        { label: `Regulatory charge · ${formatInt(kwh)} kWh × NLR 0.0311`, amount: regulatory },
      ],
      subtotal,
      taxLabel: "GST (5%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Step 1 applies to the first 1,350 kWh per 60-day billing period; usage above is billed at Step 2.",
        "Rates are approved by the (fictional) Northland Utilities Commission.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, POWER_META, "", opts);
  },
};

export const nlGas: BillTemplate = {
  docType: GAS_META.docType,
  regionId: "northland",
  label: "燃气账单",
  kind: "gas",
  fields: NORTHLAND_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, GAS_META);
    const m3 = 60 + Math.floor(rng() * 320);
    const previousReading = 5200 + Math.floor(rng() * 2400);
    const currentReading = previousReading + m3;
    const delivery = round2(GAS_META.periodDays * 0.52 + m3 * 0.118);
    const commodity = round2(m3 * 0.142);
    // 碳税：按每 m³ 分行（加拿大流派标志性行项目）
    const carbon = round2(m3 * 0.1535);
    const subtotal = round2(delivery + commodity + carbon);
    const tax = round2(subtotal * 0.05);
    const total = round2(subtotal + tax);
    return {
      docType: GAS_META.docType,
      regionId: "northland",
      kind: "gas",
      utilityName: GAS_META.utilityName,
      utilityNameZh: GAS_META.utilityNameZh,
      tagline: GAS_META.tagline,
      currency: GAS_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: GAS_META.periodDays,
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
        {
          label: `Delivery charge · ${GAS_META.periodDays} days × NLR 0.52/day + ${formatInt(m3)} m³ × NLR 0.118/m³`,
          amount: delivery,
        },
        { label: `Commodity charge · ${formatInt(m3)} m³ × NLR 0.142`, amount: commodity },
        { label: `Carbon charge · ${formatInt(m3)} m³ × NLR 0.1535`, amount: carbon },
      ],
      subtotal,
      taxLabel: "GST (5%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "The carbon charge recovers the (fictional) federal fuel charge on natural gas.",
        "Commodity is a flow-through cost; Borealis Gas does not mark up the gas itself.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, GAS_META, "", opts);
  },
};
