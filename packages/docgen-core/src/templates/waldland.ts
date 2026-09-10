/**
 * 虚构地区「瓦尔德兰 Waldland」：德国账单流派（年度结算 Jahresabrechnung）。
 * - wl_power  Stadtwerke Falkenheim 电力年度结算：Arbeitspreis + Grundpreis +
 *   Stromsteuer + Konzessionsabgabe → netto → USt 19% → brutto，再与 11 期 Abschlag 对冲
 * - wl_gas    Falkenheim Gasversorgung 燃气年度结算：m³ × Brennwert × Zustandszahl = kWh
 *   换算块为主角，其余同骨架
 * 地址字段：strasse（含门牌号）/ plz（5 位数字）/ ort。账单内容为德语。
 * IBAN/BIC 均为 hash 派生的装饰性格式（不做 mod-97 校验，非真实银行数据）。
 */

import type {
  BillInput,
  BillTemplate,
  BillViewModel,
  RenderOptions,
  SettlementBlock,
  SettlementInstallment,
} from "../model";
import {
  addDaysIso,
  buildBase,
  escapeHtml,
  formatNumDe,
  renderDeShell,
  round2,
  type TemplateMeta,
} from "./common";

const WALDLAND_FIELDS = [
  { kind: "text", key: "strasse", label: "街道 + 门牌号", placeholder: "Falkenstraße 12", required: true, maxLength: 60 },
  { kind: "text", key: "plz", label: "邮编 PLZ", placeholder: "91240", required: true, maxLength: 5, pattern: /^\d{5}$/ },
  { kind: "text", key: "ort", label: "城市 Ort", placeholder: "Falkenheim", required: true, maxLength: 40 },
] as const;

const POWER_META: TemplateMeta = {
  docType: "wl_power",
  regionId: "waldland",
  kind: "power",
  utilityName: "Stadtwerke Falkenheim",
  utilityNameZh: "法尔肯海姆市政公用公司",
  tagline: "Fiktiver kommunaler Energieversorger",
  currency: "EUR",
  prefix: "SWF",
  periodDays: 365,
  accent: "#7a1f2b",
};

const GAS_META: TemplateMeta = {
  docType: "wl_gas",
  regionId: "waldland",
  kind: "gas",
  utilityName: "Falkenheim Gasversorgung",
  utilityNameZh: "法尔肯海姆燃气公司",
  tagline: "Fiktive Erdgasversorgung für den Landkreis Waldland",
  currency: "EUR",
  prefix: "FGV",
  periodDays: 365,
  accent: "#2c5a7a",
};

const MONTHS_DE = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
] as const;

function deMonthLabel(iso: string): string {
  return `${MONTHS_DE[Number(iso.slice(5, 7)) - 1] ?? "?"} ${iso.slice(0, 4)}`;
}

/**
 * 装饰性假 IBAN：格式 DEkk bbbb bbbb cccc cccc cc（22 字符），数字由 hash 派生。
 * 不做 mod-97 校验，不对应任何真实银行账户。
 */
function fakeIban(rng: () => number): string {
  const digits = (n: number): string =>
    Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
  return `DE${digits(2)} ${digits(4)} ${digits(4)} ${digits(4)} ${digits(4)} ${digits(2)}`;
}

/**
 * Abschlag 对冲：11 期等额月预缴，因子 0.88–1.16 使 Guthaben / Nachzahlung 都可能出现。
 * schlussbetrag = brutto − 预缴总额（负 = Guthaben）。
 */
function buildSettlement(
  rng: () => number,
  brutto: number,
  billDateIso: string,
  accountNumber: string,
  invoiceNumber: string,
): SettlementBlock {
  const factor = 0.88 + rng() * 0.28;
  const monthly = round2((brutto * factor) / 11);
  const installments: SettlementInstallment[] = Array.from({ length: 11 }, (_, i) => ({
    label: deMonthLabel(addDaysIso(billDateIso, -30 * (11 - i))),
    amount: monthly,
  }));
  const installmentsTotal = round2(monthly * 11);
  return {
    installments,
    installmentsTotal,
    schlussbetrag: round2(brutto - installmentsTotal),
    iban: fakeIban(rng),
    bic: "STWFDE21XXX", // 虚构 BIC：STWF = Stadtwerke Falkenheim（fiktiv）
    verwendungszweck: `Kdnr. ${accountNumber} Rgnr. ${invoiceNumber}`,
  };
}

export const wlPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "waldland",
  label: "电力年度结算单",
  kind: "power",
  fields: WALDLAND_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 1800 + Math.floor(rng() * 2600);
    const zaehlerNr = `${4000000 + Math.floor(rng() * 999999)}`;
    const previousReading = 9000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + kwh;
    const arbeit = round2(kwh * 0.324);
    const grund = round2(12 * 9.9);
    const stromsteuer = round2(kwh * 0.0205);
    const konzession = round2(kwh * 0.0132);
    const netto = round2(arbeit + grund + stromsteuer + konzession);
    const ust = round2(netto * 0.19);
    const brutto = round2(netto + ust);
    const settlement = buildSettlement(rng, brutto, base.billDateIso, base.accountNumber, base.invoiceNumber);
    return {
      docType: POWER_META.docType,
      regionId: "waldland",
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
          label: `Stromzähler Nr. ${zaehlerNr}`,
          previous: formatNumDe(previousReading, 0),
          current: formatNumDe(currentReading, 0),
          usage: `${formatNumDe(kwh, 0)} kWh`,
        },
      ],
      usageSummary: `${formatNumDe(kwh, 0)} kWh`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Arbeitspreis · ${formatNumDe(kwh, 0)} kWh × 32,40 ct/kWh`, amount: arbeit },
        { label: "Grundpreis · 12 Monate × 9,90 €/Monat", amount: grund },
        { label: `Stromsteuer · ${formatNumDe(kwh, 0)} kWh × 2,05 ct/kWh`, amount: stromsteuer },
        { label: `Konzessionsabgabe · ${formatNumDe(kwh, 0)} kWh × 1,32 ct/kWh`, amount: konzession },
      ],
      subtotal: netto,
      taxLabel: "Umsatzsteuer 19 %",
      tax: ust,
      total: brutto,
      settlement,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${brutto.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Der neue Abschlag ab nächstem Monat wurde an Ihr aktuelles Verbrauchsverhalten angepasst.",
        "Einwände gegen diese Abrechnung richten Sie bitte innerhalb von 4 Wochen an unseren Kundenservice (fiktiv).",
        "Dieses Dokument ist ein fiktives Layout-Muster; alle Preise, Steuersätze und Bankdaten sind frei erfunden.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderDeShell(vm, POWER_META, "", opts);
  },
};

export const wlGas: BillTemplate = {
  docType: GAS_META.docType,
  regionId: "waldland",
  label: "燃气年度结算单",
  kind: "gas",
  fields: WALDLAND_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, GAS_META);
    const cubicMeters = 240 + Math.floor(rng() * 380);
    const bw = Number((11.2 + rng() * 0.4).toFixed(3)); // Brennwert kWh/m³，3 位小数
    const zz = Number((0.94 + rng() * 0.03).toFixed(4)); // Zustandszahl，4 位小数
    const kwh = Math.round(cubicMeters * bw * zz);
    const zaehlerNr = `${7000000 + Math.floor(rng() * 999999)}`;
    const previousReading = 1400 + Math.floor(rng() * 2600);
    const currentReading = previousReading + cubicMeters;
    const arbeit = round2(kwh * 0.119);
    const grund = round2(12 * 8.5);
    const erdgassteuer = round2(kwh * 0.0055);
    const netto = round2(arbeit + grund + erdgassteuer);
    const ust = round2(netto * 0.19);
    const brutto = round2(netto + ust);
    const settlement = buildSettlement(rng, brutto, base.billDateIso, base.accountNumber, base.invoiceNumber);
    return {
      docType: GAS_META.docType,
      regionId: "waldland",
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
          label: `Gaszähler Nr. ${zaehlerNr}`,
          previous: formatNumDe(previousReading, 0),
          current: formatNumDe(currentReading, 0),
          usage: `${formatNumDe(cubicMeters, 0)} m³`,
        },
      ],
      usageSummary: `${formatNumDe(cubicMeters, 0)} m³ (≈ ${formatNumDe(kwh, 0)} kWh)`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: `Arbeitspreis · ${formatNumDe(kwh, 0)} kWh × 11,90 ct/kWh`, amount: arbeit },
        { label: "Grundpreis · 12 Monate × 8,50 €/Monat", amount: grund },
        { label: `Erdgassteuer · ${formatNumDe(kwh, 0)} kWh × 0,55 ct/kWh`, amount: erdgassteuer },
      ],
      subtotal: netto,
      taxLabel: "Umsatzsteuer 19 %",
      tax: ust,
      total: brutto,
      settlement,
      conversion: { cubicMeters, brennwert: bw, zustandszahl: zz, kwh },
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${brutto.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Die thermische Energie ergibt sich aus Volumen × Brennwert × Zustandszahl (Abrechnung nach DVGW-Praxis, fiktiv).",
        "Der neue Abschlag ab nächstem Monat wurde an Ihr aktuelles Verbrauchsverhalten angepasst.",
        "Dieses Dokument ist ein fiktives Layout-Muster; alle Preise, Steuersätze und Bankdaten sind frei erfunden.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const conv = vm.conversion;
    const body =
      conv === undefined
        ? ""
        : `<div style="margin-top:54px;"><div style="font-size:30px;letter-spacing:2px;color:#5a656c;` +
          `text-transform:uppercase;margin-bottom:10px;">Thermische Abrechnung · 热值换算</div>` +
          `<div style="background:#f7f6f1;border-radius:12px;padding:26px 34px;font-size:31px;color:#333c42;line-height:2;">` +
          `<div style="display:flex;justify-content:space-between;"><span>Volumen lt. Ablesung</span>` +
          `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(conv.cubicMeters, 0))} m³</span></div>` +
          `<div style="display:flex;justify-content:space-between;"><span>× Brennwert</span>` +
          `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(conv.brennwert, 3))} kWh/m³</span></div>` +
          `<div style="display:flex;justify-content:space-between;"><span>× Zustandszahl</span>` +
          `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(conv.zustandszahl, 4))}</span></div>` +
          `<div style="display:flex;justify-content:space-between;border-top:2px solid #1b2327;padding-top:10px;font-weight:700;">` +
          `<span>= Thermische Energie</span>` +
          `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(conv.kwh, 0))} kWh</span></div></div></div>`;
    return renderDeShell(vm, GAS_META, body, opts);
  },
};
