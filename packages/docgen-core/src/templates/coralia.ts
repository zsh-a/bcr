/**
 * 虚构地区「珊瑚洲 Coralia」：澳洲账单流派。
 * - co_power  Coral Coast Energy：NMI 表号、supply charge（c/day）+ usage（c/kWh）、
 *   GST 10% 内含（金额按 ex-GST 拆分，taxLabel 注明 included）、6 期柱图、BPAY 块
 * - co_gas    Southern Cross Gas：MIRN 表号、MJ 单位、同结构
 * 地址字段：streetNo / streetName / suburb / state(3 字母) / postcode(4 位)。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import { fnv1a, mulberry32 } from "../hash";
import {
  addDaysIso,
  buildBase,
  formatInt,
  renderAuShell,
  round2,
  type TemplateMeta,
} from "./common";

const CORALIA_FIELDS = [
  { kind: "text", key: "streetNo", label: "门牌号", placeholder: "14", required: true, maxLength: 6, pattern: /^\d{1,5}$/ },
  { kind: "text", key: "streetName", label: "街道名", placeholder: "Banksia Street", required: true, maxLength: 50 },
  { kind: "text", key: "suburb", label: "Suburb", placeholder: "Coral Cove", required: true, maxLength: 40 },
  { kind: "text", key: "state", label: "州（3 位缩写）", placeholder: "CQL", required: true, maxLength: 3, pattern: /^[A-Z]{3}$/ },
  { kind: "text", key: "postcode", label: "邮编", placeholder: "4820", required: true, maxLength: 4, pattern: /^\d{4}$/ },
] as const;

const POWER_META: TemplateMeta = {
  docType: "co_power",
  regionId: "coralia",
  kind: "power",
  utilityName: "Coral Coast Energy",
  utilityNameZh: "珊瑚岸能源",
  tagline: "Fictional energy retailer of the Coralia coast",
  currency: "CRD",
  prefix: "CCE",
  periodDays: 90,
  accent: "#c75b32",
  locale: "en-AU",
};

const GAS_META: TemplateMeta = {
  docType: "co_gas",
  regionId: "coralia",
  kind: "gas",
  utilityName: "Southern Cross Gas",
  utilityNameZh: "南十字燃气",
  tagline: "Fictional piped gas retailer",
  currency: "CRD",
  prefix: "SCG",
  periodDays: 90,
  accent: "#31576e",
  locale: "en-AU",
};

const MONTH_AU = (iso: string): string =>
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(iso.slice(5, 7)) - 1
  ] ?? "?";

function digits(rng: () => number, n: number): string {
  return Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
}

/** BPAY 参数由单号 hash 确定性派生（虚构，非真实 biller） */
function bpayBillerCode(vm: BillViewModel): string {
  return digits(mulberry32(fnv1a(`bpay::${vm.invoiceNumber}`)), 5);
}
function bpayRef(vm: BillViewModel): string {
  return `${vm.accountNumber}${digits(mulberry32(fnv1a(`bpayref::${vm.invoiceNumber}`)), 3)}`;
}

/** AU 计费拆分：展示价为含税（GST incl.）费率，金额按 ex-GST 入账，tax = subtotal × 10% */
function auSplit(inclAmount: number): number {
  return round2(inclAmount / 1.1);
}

export const coPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "coralia",
  label: "电费账单",
  kind: "power",
  fields: CORALIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 400 + Math.floor(rng() * 1200);
    const previousReading = 32000 + Math.floor(rng() * 15000);
    const currentReading = previousReading + kwh;
    const nmi = `30${digits(rng, 8)}`;
    const supplyEx = auSplit((POWER_META.periodDays * 98.5) / 100);
    const usageEx = auSplit((kwh * 28.6) / 100);
    const subtotal = round2(supplyEx + usageEx);
    const tax = round2(subtotal * 0.1);
    const total = round2(subtotal + tax);
    // 近 6 期用量柱状图
    const bars = Array.from({ length: 6 }, (_, i) => {
      const back = 5 - i;
      return {
        label: MONTH_AU(addDaysIso(base.billDateIso, -30 * back)),
        value: i === 5 ? kwh : Math.round(kwh * (0.7 + rng() * 0.6)),
      };
    });
    return {
      docType: POWER_META.docType,
      regionId: "coralia",
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
          label: `NMI ${nmi} · meter read (kWh)`,
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
        { label: `Supply charge · ${POWER_META.periodDays} days × 98.5c/day (GST incl. rate)`, amount: supplyEx },
        { label: `Usage · ${formatInt(kwh)} kWh × 28.6c/kWh (GST incl. rate)`, amount: usageEx },
      ],
      subtotal,
      taxLabel: "GST 10% (included in total)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Rates shown include GST; amounts are billed ex-GST with GST totalled separately.",
        "Pay via BPAY, card or direct debit (all fictional).",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderAuShell(vm, POWER_META, "", opts, {
      billerCode: bpayBillerCode(vm),
      ref: bpayRef(vm),
      meterIdLabel: vm.meterRows[0]?.label.split(" ·")[0] ?? "",
    });
  },
};

export const coGas: BillTemplate = {
  docType: GAS_META.docType,
  regionId: "coralia",
  label: "燃气账单",
  kind: "gas",
  fields: CORALIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, GAS_META);
    const mj = 3000 + Math.floor(rng() * 9000);
    const previousReading = 41000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + mj;
    const mirn = `53${digits(rng, 8)}`;
    const supplyEx = auSplit((GAS_META.periodDays * 78.9) / 100);
    const usageEx = auSplit((mj * 3.42) / 100);
    const subtotal = round2(supplyEx + usageEx);
    const tax = round2(subtotal * 0.1);
    const total = round2(subtotal + tax);
    return {
      docType: GAS_META.docType,
      regionId: "coralia",
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
          label: `MIRN ${mirn} · meter read (MJ)`,
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(mj)} MJ`,
        },
      ],
      usageSummary: `${formatInt(mj)} MJ`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Supply charge · ${GAS_META.periodDays} days × 78.9c/day (GST incl. rate)`, amount: supplyEx },
        { label: `Usage · ${formatInt(mj)} MJ × 3.42c/MJ (GST incl. rate)`, amount: usageEx },
      ],
      subtotal,
      taxLabel: "GST 10% (included in total)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Gas is measured in megajoules (MJ); 1 MJ ≈ 0.278 kWh.",
        "Pay via BPAY, card or direct debit (all fictional).",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderAuShell(vm, GAS_META, "", opts, {
      billerCode: bpayBillerCode(vm),
      ref: bpayRef(vm),
      meterIdLabel: vm.meterRows[0]?.label.split(" ·")[0] ?? "",
    });
  },
};
