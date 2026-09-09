/**
 * 虚构地区「诺德港 Nordhavn」：北欧海港风格。
 * - nh_water  Nordhavn Waterworks 水费单（季度 90 天账期，m³）
 * - nh_power  Polaris Energy 电费单（月度，kWh，含近 6 期用量柱状图）
 */

import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  addDaysIso,
  buildBase,
  escapeHtml,
  formatInt,
  renderShell,
  round2,
  type TemplateMeta,
} from "./common";

const NORDHAVN_FIELDS = [
  { kind: "text", key: "street", label: "街道地址", placeholder: "14 Fjordgate", required: true, maxLength: 60 },
  { kind: "text", key: "city", label: "城市", placeholder: "Nordhavn", required: true, maxLength: 40 },
  { kind: "text", key: "province", label: "省份 / 郡", placeholder: "Havnmark", required: true, maxLength: 40 },
] as const;

const WATER_META: TemplateMeta = {
  docType: "nh_water",
  regionId: "nordhavn",
  kind: "water",
  utilityName: "Nordhavn Waterworks",
  utilityNameZh: "诺德港水务局",
  tagline: "Municipal water & wastewater services",
  currency: "NDK",
  prefix: "NHW",
  periodDays: 90,
  accent: "#17577a",
};

const POWER_META: TemplateMeta = {
  docType: "nh_power",
  regionId: "nordhavn",
  kind: "power",
  utilityName: "Polaris Energy",
  utilityNameZh: "北极星能源",
  tagline: "Renewable electricity for the harbour region",
  currency: "NDK",
  prefix: "NPE",
  periodDays: 30,
  accent: "#3d6b35",
};

function barcodePayload(meta: TemplateMeta, invoiceNumber: string): string {
  return invoiceNumber.replaceAll("-", "");
}

export const nhWater: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "nordhavn",
  label: "水费账单",
  kind: "water",
  fields: NORDHAVN_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const cubicMeters = 55 + Math.floor(rng() * 95);
    const previousReading = 1200 + Math.floor(rng() * 800);
    const currentReading = previousReading + cubicMeters;
    const waterCharge = round2(cubicMeters * 18.4);
    const sewerCharge = round2(cubicMeters * 9.75);
    const serviceFee = 210.0;
    const subtotal = round2(waterCharge + sewerCharge + serviceFee);
    const tax = round2(subtotal * 0.06);
    const total = round2(subtotal + tax);
    return {
      docType: WATER_META.docType,
      regionId: "nordhavn",
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
          label: "Main meter (m³)",
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
        { label: `Water supply · ${formatInt(cubicMeters)} m³ × NDK 18.40`, amount: waterCharge },
        { label: `Wastewater · ${formatInt(cubicMeters)} m³ × NDK 9.75`, amount: sewerCharge },
        { label: "Quarterly service charge", amount: serviceFee },
      ],
      subtotal,
      taxLabel: "Harbour municipal levy (6%)",
      tax,
      total,
      barcodePayload: barcodePayload(WATER_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Meter read is estimated from your historical consumption profile.",
        "A delayed payment fee of NDK 45.00 applies after the due date.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const body =
      `<div style="margin-top:26px;font-size:34px;color:#5a656c;background:#f7f6f1;` +
      `border-radius:18px;padding:34px 40px;">` +
      `Average daily consumption this quarter: <b style="color:#1b2327;">` +
      `${escapeHtml(avgDaily(vm))} m³/day</b>` +
      ` · next scheduled meter read in about 90 days.</div>`;
    return renderShell(vm, WATER_META, body, opts);
  },
};

function avgDaily(vm: BillViewModel): string {
  const row = vm.meterRows[0];
  if (row === undefined) return "0.00";
  const m3 = Number(row.usage.replace(/[^\d.]/g, ""));
  return (m3 / vm.periodDays).toFixed(2);
}

export const nhPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "nordhavn",
  label: "电费账单",
  kind: "power",
  fields: NORDHAVN_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 180 + Math.floor(rng() * 340);
    const previousReading = 8400 + Math.floor(rng() * 2400);
    const currentReading = previousReading + kwh;
    // 近 6 期用量：围绕本期 ±25% 波动（确定性 rng）
    const monthName = (iso: string): string =>
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        Number(iso.slice(5, 7)) - 1
      ] ?? "?";
    const bars = Array.from({ length: 6 }, (_, i) => {
      const backMonths = 5 - i;
      const iso = addDaysIso(base.billDateIso, -30 * backMonths);
      return {
        label: monthName(iso),
        value: i === 5 ? kwh : Math.round(kwh * (0.75 + rng() * 0.5)),
      };
    });
    const energyCharge = round2(kwh * 1.92);
    const gridFee = 145.0;
    const subtotal = round2(energyCharge + gridFee);
    const tax = round2(subtotal * 0.12);
    const total = round2(subtotal + tax);
    return {
      docType: POWER_META.docType,
      regionId: "nordhavn",
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
          label: "Main meter (kWh)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh`,
      bars,
      barUnit: "kWh",
      barTitle: "Consumption history",
      charges: [
        { label: `Electricity · ${formatInt(kwh)} kWh × NDK 1.92`, amount: energyCharge },
        { label: "Monthly grid connection fee", amount: gridFee },
      ],
      subtotal,
      taxLabel: "Nordhavn energy duty (12%)",
      tax,
      total,
      barcodePayload: barcodePayload(POWER_META, base.invoiceNumber),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Your electricity is 100% matched by harbour wind certificates.",
        "A delayed payment fee of NDK 45.00 applies after the due date.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, POWER_META, "", opts);
  },
};
