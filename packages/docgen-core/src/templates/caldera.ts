/**
 * 虚构地区「卡德拉群岛 Caldera Isles」：火山群岛风格。
 * - ci_gas     Caldera Gas & Heat 燃气账单（月度，m³，含碳排放附加费）
 * - ci_telecom Isles Telecom 宽带账单（月度，GB 用量）
 * 地址字段与 nordhavn 不同：街道拆 number/name，且有 postcode。
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  buildBase,
  escapeHtml,
  formatInt,
  renderShell,
  round2,
  type TemplateMeta,
} from "./common";

const CALDERA_FIELDS = [
  { kind: "text", key: "streetNumber", label: "门牌号", placeholder: "12", required: true, maxLength: 6, pattern: /^\d{1,4}[A-Z]?$/ },
  { kind: "text", key: "streetName", label: "街道名", placeholder: "Cinder Lane", required: true, maxLength: 50 },
  { kind: "text", key: "town", label: "城镇", placeholder: "Port Ember", required: true, maxLength: 40 },
  { kind: "text", key: "postcode", label: "邮编", placeholder: "CE14 2PA", required: true, maxLength: 9, pattern: /^[A-Z]{2}\d{2}\s?\d[A-Z]{2}$/ },
] as const;

const GAS_META: TemplateMeta = {
  docType: "ci_gas",
  regionId: "caldera",
  kind: "gas",
  utilityName: "Caldera Gas & Heat",
  utilityNameZh: "卡德拉燃气热力公司",
  tagline: "Geothermal-blended gas for the isles",
  currency: "CID",
  prefix: "CGH",
  periodDays: 30,
  accent: "#a8503c",
};

const TELECOM_META: TemplateMeta = {
  docType: "ci_telecom",
  regionId: "caldera",
  kind: "telecom",
  utilityName: "Isles Telecom",
  utilityNameZh: "群岛电信",
  tagline: "Submarine fibre broadband & voice",
  currency: "CID",
  prefix: "ITL",
  periodDays: 30,
  accent: "#4c4f8f",
};

function barcodePayload(meta: TemplateMeta, invoiceNumber: string): string {
  return invoiceNumber.replaceAll("-", "");
}

export const ciGas: BillTemplate = {
  docType: GAS_META.docType,
  regionId: "caldera",
  label: "燃气账单",
  kind: "gas",
  fields: CALDERA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, GAS_META);
    const cubicMeters = 38 + Math.floor(rng() * 150);
    const kwhEquivalent = Math.round(cubicMeters * 10.83);
    const previousReading = 3100 + Math.floor(rng() * 900);
    const currentReading = previousReading + cubicMeters;
    const gasCharge = round2(cubicMeters * 3.85);
    const supplyFee = 96.0;
    const carbonLevy = round2((gasCharge + supplyFee) * 0.04);
    const subtotal = round2(gasCharge + supplyFee + carbonLevy);
    const tax = round2(subtotal * 0.05);
    const total = round2(subtotal + tax);
    return {
      docType: GAS_META.docType,
      regionId: "caldera",
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
          label: "Gas meter (m³)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(cubicMeters)} m³`,
        },
      ],
      usageSummary: `${formatInt(cubicMeters)} m³ (≈ ${formatInt(kwhEquivalent)} kWh)`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Gas energy · ${formatInt(cubicMeters)} m³ × CID 3.85`, amount: gasCharge },
        { label: "Monthly supply charge", amount: supplyFee },
        { label: "Islands carbon levy (4%)", amount: carbonLevy },
      ],
      subtotal,
      taxLabel: "Caldera goods & services tax (5%)",
      tax,
      total,
      barcodePayload: barcodePayload(GAS_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Gas is blended with 30% geothermal process heat from the Caldera caldera plant.",
        "Smell gas? Call the 24h fictional emergency line 0800 555 0133 immediately.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, GAS_META, "", opts);
  },
};

export const ciTelecom: BillTemplate = {
  docType: TELECOM_META.docType,
  regionId: "caldera",
  label: "宽带账单",
  kind: "telecom",
  fields: CALDERA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, TELECOM_META);
    const dataGb = 320 + Math.floor(rng() * 660);
    const planCharge = 349.0;
    const rentalCharge = 45.0;
    const subtotal = round2(planCharge + rentalCharge);
    const tax = round2(subtotal * 0.15);
    const total = round2(subtotal + tax);
    return {
      docType: TELECOM_META.docType,
      regionId: "caldera",
      kind: "telecom",
      utilityName: TELECOM_META.utilityName,
      utilityNameZh: TELECOM_META.utilityNameZh,
      tagline: TELECOM_META.tagline,
      currency: TELECOM_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: TELECOM_META.periodDays,
      meterRows: [],
      usageSummary: `${formatInt(dataGb)} GB data`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: "Harbour Fibre 500 plan (monthly)", amount: planCharge },
        { label: "Wi-Fi gateway rental", amount: rentalCharge },
      ],
      subtotal,
      taxLabel: "Isles communications VAT (15%)",
      tax,
      total,
      barcodePayload: barcodePayload(TELECOM_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Unlimited fair-use policy: no overage charge applies to residential plans.",
        "Service credits apply automatically after outages longer than 24 hours.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const body =
      `<div style="margin-top:16px;background:#f7f6f1;border-radius:22px;padding:44px 54px;">` +
      `<div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;">Data usage · 流量用量</div>` +
      `<div style="font-size:56px;font-weight:700;margin-top:14px;">${escapeHtml(vm.usageSummary)}</div>` +
      `<div style="font-size:32px;color:#5a656c;margin-top:10px;">Unlimited fair-use plan — no overage charges. 不限量合理使用，无超额费用。</div></div>`;
    return renderShell(vm, TELECOM_META, body, opts);
  },
};
