/**
 * 虚构地区「赤道城 Equatoria」：新加坡账单流派。
 * - eq_utilities  Equatoria Utilities：水电合一单——Electricity / Water / Refuse removal
 *   三 section 各自计价再汇总；水费内含 Water Conservation Tax + Waterborne Fee 分行；
 *   GST 9% 外加；GIRO 付款提示
 * - eq_telecom    Straits Telecom：宽带/移动月租 + IDD 用量 itemized，GST 9% 外加
 * 地址字段：blockStreet（Blk 128 …）/ unitNo（#12-34）/ postalCode（6 位）。
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

const EQUATORIA_FIELDS = [
  { kind: "text", key: "blockStreet", label: "座号 + 街道", placeholder: "Blk 128 Equator Avenue", required: true, maxLength: 60 },
  { kind: "text", key: "unitNo", label: "单位号", placeholder: "#12-34", required: true, maxLength: 8, pattern: /^#\d{2}-\d{2}$/ },
  { kind: "text", key: "postalCode", label: "邮编", placeholder: "560128", required: true, maxLength: 6, pattern: /^\d{6}$/ },
] as const;

const UTIL_META: TemplateMeta = {
  docType: "eq_utilities",
  regionId: "equatoria",
  kind: "power",
  utilityName: "Equatoria Utilities",
  utilityNameZh: "赤道城公用事业",
  tagline: "Fictional combined utilities billing service",
  currency: "EQD",
  prefix: "EQU",
  periodDays: 30,
  accent: "#b03040",
  locale: "en-SG",
};

const TELECOM_META: TemplateMeta = {
  docType: "eq_telecom",
  regionId: "equatoria",
  kind: "telecom",
  utilityName: "Straits Telecom",
  utilityNameZh: "海峡电信",
  tagline: "Fictional fibre & mobile operator",
  currency: "EQD",
  prefix: "STT",
  periodDays: 30,
  accent: "#0e7c86",
  locale: "en-SG",
};

export const eqUtilities: BillTemplate = {
  docType: UTIL_META.docType,
  regionId: "equatoria",
  label: "水电合一账单",
  kind: "power",
  fields: EQUATORIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, UTIL_META);
    const kwh = 200 + Math.floor(rng() * 500);
    const m3 = 8 + Math.floor(rng() * 37);
    const prevKwh = 18000 + Math.floor(rng() * 9000);
    const prevM3 = 700 + Math.floor(rng() * 500);
    // Electricity section
    const elec = round2(kwh * 0.291);
    const elecSection: ChargeSection = {
      title: "Electricity · 电力",
      lines: [{ label: `Electricity usage · ${formatInt(kwh)} kWh × EQD 0.2910/kWh`, amount: elec }],
      sectionTotal: elec,
    };
    // Water section：水费内含 Water Conservation Tax + Waterborne Fee 分行
    const water = round2(m3 * 1.52);
    const conservationTax = round2(water * 0.35);
    const waterborne = round2(m3 * 0.92);
    const waterSection: ChargeSection = {
      title: "Water · 水务",
      lines: [
        { label: `Water usage · ${formatInt(m3)} m³ × EQD 1.5200/m³`, amount: water },
        { label: "Water Conservation Tax (35% of water usage)", amount: conservationTax },
        { label: `Waterborne Fee · ${formatInt(m3)} m³ × EQD 0.9200/m³`, amount: waterborne },
      ],
      sectionTotal: round2(water + conservationTax + waterborne),
    };
    // Refuse removal section
    const refuse = 9.18;
    const refuseSection: ChargeSection = {
      title: "Refuse removal · 垃圾清运",
      lines: [{ label: "Refuse removal · 1 household", amount: refuse }],
      sectionTotal: refuse,
    };
    const sections = [elecSection, waterSection, refuseSection];
    const charges = sections.flatMap((s) => s.lines);
    const subtotal = round2(sections.reduce((sum, s) => sum + s.sectionTotal, 0));
    const tax = round2(subtotal * 0.09);
    const total = round2(subtotal + tax);
    return {
      docType: UTIL_META.docType,
      regionId: "equatoria",
      kind: "power",
      utilityName: UTIL_META.utilityName,
      utilityNameZh: UTIL_META.utilityNameZh,
      tagline: UTIL_META.tagline,
      currency: UTIL_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: UTIL_META.periodDays,
      meterRows: [
        {
          label: "Electricity meter (kWh)",
          previous: formatInt(prevKwh),
          current: formatInt(prevKwh + kwh),
          usage: `${formatInt(kwh)} kWh`,
        },
        {
          label: "Water meter (m³)",
          previous: formatInt(prevM3),
          current: formatInt(prevM3 + m3),
          usage: `${formatInt(m3)} m³`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh + ${formatInt(m3)} m³`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges,
      sections,
      subtotal,
      taxLabel: "GST (9%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Water Conservation Tax and Waterborne Fee are collected on behalf of the (fictional) national water agency.",
        "GST is charged at the prevailing 9% rate on all sections.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderSectionShell(vm, UTIL_META, "", opts, { flavor: "sg" });
  },
};

export const eqTelecom: BillTemplate = {
  docType: TELECOM_META.docType,
  regionId: "equatoria",
  label: "电信账单",
  kind: "telecom",
  fields: EQUATORIA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, TELECOM_META);
    const iddMinutes = 10 + Math.floor(rng() * 180);
    const broadband = 42.8;
    const mobile = 18.0;
    const idd = round2(iddMinutes * 0.22);
    const subtotal = round2(broadband + mobile + idd);
    const tax = round2(subtotal * 0.09);
    const total = round2(subtotal + tax);
    return {
      docType: TELECOM_META.docType,
      regionId: "equatoria",
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
      usageSummary: `${formatInt(iddMinutes)} IDD mins`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: "Fibre broadband 1Gbps · monthly subscription", amount: broadband },
        { label: "Mobile line · 40 GB plan", amount: mobile },
        { label: `IDD voice usage · ${formatInt(iddMinutes)} mins × EQD 0.22`, amount: idd },
      ],
      subtotal,
      taxLabel: "GST (9%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Pay by GIRO for a fuss-free experience (fictional).",
        "Itemised IDD calls are available in the companion app.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderShell(vm, TELECOM_META, "", opts);
  },
};
