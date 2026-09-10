/**
 * 真实地区「德国 Germany」：暖气费分摊结算单
 * （Heiz- und Hausnebenkostenabrechnung，供熱與附屬費年度分攤結算）。
 * 版式复刻参考件：顶部居中字标 + 红色标题、地址/账期双栏、粉色费用回顾框、
 * 红条信息框（Energiekostenentlastung / EWPBG）、五列成本分摊表
 * （Gesamtkosten → Gesamteinheiten → Preis je Einheit → Ihre Einheiten → Ihre Kosten）、
 * 抄表值表与 "Seite 1/3" 页脚。
 * 分摊勾稽：30% Grundkosten（按 m²）+ 70% Verbrauchskosten（按 kWh）= Ihre Heizkosten；
 * Kaltwasser / Betriebs / Direkt 各组小计 = 对应 charge 行；四组合计 = 应付总额。
 * 无增值税（Umsatzsteuer nicht ausgewiesen）。所有机构 / 金额 / 表号均为虚构。
 */

import type {
  AllocationRow,
  BillInput,
  BillTemplate,
  BillViewModel,
  RenderOptions,
} from "../model";
import {
  addDaysIso,
  buildBase,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  escapeHtml,
  formatMoneyDe,
  formatNumDe,
  round2,
  type TemplateMeta,
} from "./common";

const GERMANY_FIELDS = [
  {
    kind: "text",
    key: "strasse",
    label: "街道 + 门牌号",
    placeholder: "Hauptstraße 12",
    required: true,
    maxLength: 60,
  },
  {
    kind: "text",
    key: "plz",
    label: "邮编 PLZ",
    placeholder: "10115",
    required: true,
    maxLength: 5,
    pattern: /^\d{5}$/,
  },
  {
    kind: "text",
    key: "ort",
    label: "城市 Ort",
    placeholder: "Berlin",
    required: true,
    maxLength: 40,
  },
] as const;

const HEIZ_META: TemplateMeta = {
  docType: "wl_heizkosten",
  regionId: "germany",
  kind: "gas",
  utilityName: "Falkenmess Wärmeabrechnung GmbH",
  utilityNameZh: "法尔肯计量供暖结算公司",
  tagline: "Fiktiver Abrechnungsdienst für Heiz- und Hausnebenkosten",
  currency: "EUR",
  prefix: "FWM",
  periodDays: 184,
  accent: "#e2001a",
};

const NAVY = "#1c2b4a";
const RED = "#e2001a";
const PINK_BG = "#f8e9eb";
const PINK_LINE = "#edd0d4";

/** "2026-07-01" → "01.07.2026"（DD.MM.YYYY，德式显示，不依赖 ICU） */
function formatDateDe(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

const MONTH_INDEX_EN: Readonly<Record<string, string>> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

/** buildBase 的英文显示日期 "09 Sep 2026" → "09.09.2026"（仅用于页面显示） */
function deDateFromEn(en: string): string {
  const parts = en.split(" ");
  const day = parts[0] ?? "??";
  const month = MONTH_INDEX_EN[parts[1] ?? ""] ?? "??";
  const year = parts[2] ?? "????";
  return `${day}.${month}.${year}`;
}

/** 水印层（与 common.ts 中 watermarkLayer 同一图案，仅供本模板内置渲染使用） */
function watermarkLayer(): string {
  const phrase = "FICTIONAL SAMPLE · 虚构文档 · 仅供学习";
  const line = `<div style="white-space:nowrap;">${Array.from({ length: 6 }, () => escapeHtml(phrase)).join("&#160;&#160;&#160;&#160;")}</div>`;
  const block = Array.from({ length: 24 }, () => line).join("");
  return (
    `<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:60;">` +
    `<div style="position:absolute;left:-900px;top:-700px;width:4400px;height:5200px;` +
    `transform:rotate(-18deg);font-size:62px;font-weight:700;letter-spacing:6px;` +
    `line-height:230px;color:rgba(178,44,44,0.075);">${block}</div>` +
    `</div>`
  );
}

/** 字标：深藏青小写 wordmark + 红色下划弧线（内联 SVG，对应参考件的 logo 区） */
function logoBlock(): string {
  const swoosh =
    `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="48" viewBox="0 0 380 48">` +
    `<path d="M8 10 C96 38 158 42 186 32 C182 22 176 14 168 8 C186 14 196 22 198 32 ` +
    `C226 42 288 38 372 10 C312 46 236 52 198 42 C160 52 84 46 8 10 Z" fill="${RED}"/></svg>`;
  return (
    `<div style="text-align:center;">` +
    `<div style="font-size:66px;font-weight:800;letter-spacing:-2px;color:${NAVY};line-height:1;">falkenmess</div>` +
    `${swoosh}</div>`
  );
}

/** 分摊表（Ihr Anteil an den Gesamtkosten）：五列数值 + × / = 连接符，emphasis 行加粗 */
function allocationTableHtml(vm: BillViewModel): string {
  const cell = "padding:11px 8px;white-space:nowrap;";
  const rows = (vm.allocation ?? [])
    .map((row, index, all) => {
      const bold = row.emphasis === true;
      const isLast = index === all.length - 1;
      const sep1 = row.totalUnits !== "" && row.pricePerUnit !== "" ? "=" : "";
      const sep2 = row.pricePerUnit !== "" && row.ownUnits !== "" ? "×" : "";
      const sep3 = row.ownUnits !== "" && row.ownCost !== "" ? "=" : "";
      const lastStyle = isLast ? `border-top:3px solid ${NAVY};` : "";
      return (
        `<tr style="font-size:${isLast ? 31 : 28}px;font-weight:${bold ? 700 : 400};` +
        `color:${bold ? NAVY : "#333c42"};">` +
        `<td style="${cell}text-align:left;padding-left:24px;white-space:normal;${lastStyle}">${escapeHtml(row.label)}</td>` +
        `<td style="${cell}text-align:right;font-variant-numeric:tabular-nums;${lastStyle}">${escapeHtml(row.totalCost)}</td>` +
        `<td style="${cell}text-align:right;${lastStyle}">${escapeHtml(row.totalUnits)}</td>` +
        `<td style="${cell}text-align:center;color:#8a9298;${lastStyle}">${sep1}</td>` +
        `<td style="${cell}text-align:right;font-variant-numeric:tabular-nums;${lastStyle}">${escapeHtml(row.pricePerUnit)}</td>` +
        `<td style="${cell}text-align:center;color:#8a9298;${lastStyle}">${sep2}</td>` +
        `<td style="${cell}text-align:right;font-variant-numeric:tabular-nums;${lastStyle}">${escapeHtml(row.ownUnits)}</td>` +
        `<td style="${cell}text-align:center;color:#8a9298;${lastStyle}">${sep3}</td>` +
        `<td style="${cell}text-align:right;font-variant-numeric:tabular-nums;padding-right:24px;${lastStyle}">${escapeHtml(row.ownCost)}</td></tr>`
      );
    })
    .join("");
  const headCell = `padding:10px 8px;font-weight:600;border-bottom:2px solid ${NAVY};line-height:1.35;`;
  return (
    `<table style="width:100%;border-collapse:collapse;margin-top:20px;">` +
    `<tr style="font-size:22px;color:#6b7280;">` +
    `<th style="${headCell}text-align:left;padding-left:24px;"></th>` +
    `<th style="${headCell}text-align:right;">Gesamtkosten<br/>in EUR</th>` +
    `<th style="${headCell}text-align:right;">Gesamteinheiten (2)</th>` +
    `<th style="${headCell}"></th>` +
    `<th style="${headCell}text-align:right;">Preis je Einheit</th>` +
    `<th style="${headCell}"></th>` +
    `<th style="${headCell}text-align:right;">Ihre Einheiten (3)</th>` +
    `<th style="${headCell}"></th>` +
    `<th style="${headCell}text-align:right;padding-right:24px;">Ihre Kosten<br/>in EUR</th></tr>` +
    rows +
    `</table>`
  );
}

/** 抄表值表（Ihre Ablesewerte）：Gerätenummer / Raum / Datum / alt / neu / Verbrauch */
function meterReadingsHtml(vm: BillViewModel): string {
  const headCell = "padding:10px 8px;font-weight:600;border-bottom:2px solid #9aa2ad;";
  const rows = vm.meterRows
    .map(
      (row) =>
        `<tr style="font-size:29px;color:${NAVY};">` +
        `<td style="padding:16px 8px 16px 24px;font-weight:700;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:16px 8px;">K</td>` +
        `<td style="padding:16px 8px;text-align:right;">${escapeHtml(vm.periodEnd)}</td>` +
        `<td style="padding:16px 8px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.previous)}</td>` +
        `<td style="padding:16px 8px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.current)}</td>` +
        `<td style="padding:16px 24px 16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(row.usage)}</td></tr>`,
    )
    .join("");
  return (
    `<table style="width:100%;border-collapse:collapse;margin-top:20px;">` +
    `<tr style="font-size:22px;color:#6b7280;">` +
    `<th style="${headCell}text-align:left;padding-left:24px;">Gerätenummer/<br/>Stala</th>` +
    `<th style="${headCell}text-align:left;">Raum</th>` +
    `<th style="${headCell}text-align:right;">Datum</th>` +
    `<th style="${headCell}text-align:right;">Ablesewert<br/>alt</th>` +
    `<th style="${headCell}text-align:right;">Ablesewert<br/>neu</th>` +
    `<th style="${headCell}text-align:right;padding-right:24px;">Verbrauch</th></tr>` +
    rows +
    `<tr><td colspan="6" style="padding:14px 8px 0 24px;font-size:30px;font-weight:700;color:${NAVY};">Verbrauch (Kilowatt-Stunden)</td></tr>` +
    `</table>`
  );
}

/** 红色方块 + 加粗节标题（参考件的 red square bullet 风格） */
function sectionHeading(title: string): string {
  return (
    `<div style="display:flex;align-items:center;">` +
    `<span style="display:inline-block;width:20px;height:20px;background:${RED};margin-right:18px;flex:none;"></span>` +
    `<span style="font-size:40px;font-weight:800;color:${NAVY};">${escapeHtml(title)}</span></div>`
  );
}

export const wlHeizkosten: BillTemplate = {
  docType: HEIZ_META.docType,
  regionId: "germany",
  label: "暖气费年度结算 · Techem 版式",
  kind: "gas",
  fields: GERMANY_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, HEIZ_META);
    // 结算周期自行推导：期末 = 出账日 − 70 天，期初 = 期末 − 183 天（共 184 天，如 01.05.–31.10.）
    const periodEndIso = addDaysIso(base.billDateIso, -70);
    const periodStartIso = addDaysIso(periodEndIso, -(HEIZ_META.periodDays - 1));

    const ownKwh = 3800 + Math.floor(rng() * 2200); // Ihr Wärmeverbrauch
    const ownM2 = round2(48 + rng() * 24); // Nutzfläche der Wohnung
    const buildingM2 = round2(600 + rng() * 220); // Gesamtnutzfläche des Objektes
    const buildingKwh = round2(34000 + rng() * 14000); // Gesamtverbrauch des Objektes
    const buildingM3 = round2(420 + rng() * 80); // Gesamtwassermenge des Objektes
    const ownM3 = round2(75 + rng() * 35); // Ihr Wasserverbrauch

    // Heizkosten：30% Grundkosten（按面积）+ 70% Verbrauchskosten（按 kWh）
    const heizTotal = round2(8500 + rng() * 3500);
    const grundTotal = round2(heizTotal * 0.3);
    const verbTotal = round2(heizTotal - grundTotal);
    const grundOwn = round2((grundTotal / buildingM2) * ownM2);
    const verbOwn = round2((verbTotal / buildingKwh) * ownKwh);
    const heizOwn = round2(grundOwn + verbOwn);

    // Kaltwasserkosten：Grundgebühr + Abwasser kalt + Gerätemiete（均按 m³ 分摊）
    const kwTotal = round2(1900 + rng() * 700);
    const kwGrundTotal = round2(kwTotal * 0.58);
    const kwAbwasserTotal = round2(kwTotal * 0.38);
    const kwMieteTotal = round2(kwTotal - kwGrundTotal - kwAbwasserTotal);
    const kwGrundOwn = round2((kwGrundTotal / buildingM3) * ownM3);
    const kwAbwasserOwn = round2((kwAbwasserTotal / buildingM3) * ownM3);
    const kwMieteOwn = round2((kwMieteTotal / buildingM3) * ownM3);
    const kwOwn = round2(kwGrundOwn + kwAbwasserOwn + kwMieteOwn);

    // Betriebskosten：Niederschlagswasser（按 m³ 分摊）
    const betrTotal = round2(90 + rng() * 60);
    const betrOwn = round2((betrTotal / buildingM3) * ownM3);

    // Direktkosten：Nutzerwechselkosten（直接向该住户收取）
    const direktOwn = round2(15 + rng() * 30);

    const subtotal = round2(heizOwn + kwOwn + betrOwn + direktOwn);
    const total = subtotal;

    // EWPBG 能源补贴信息框金额（楼级总燃料费 → 政府承担额 → 该户减免额）
    const brennstoffGesamt = round2(heizTotal * (0.75 + rng() * 0.2));
    const uebernommen = round2(brennstoffGesamt * (0.07 + rng() * 0.04));
    const entlastung = round2(heizOwn * (0.06 + rng() * 0.04));

    const meterNr = `${87000000 + Math.floor(rng() * 99999)}`;

    const allocation: AllocationRow[] = [
      {
        label: "Heizkosten",
        totalCost: formatNumDe(heizTotal),
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: "",
        emphasis: true,
      },
      {
        label: "30% Grundkosten",
        totalCost: formatNumDe(grundTotal),
        totalUnits: `${formatNumDe(buildingM2, 3)} m² Nutzfläche`,
        pricePerUnit: formatNumDe(grundTotal / buildingM2, 6),
        ownUnits: `${formatNumDe(ownM2, 3)} m²`,
        ownCost: formatNumDe(grundOwn),
      },
      {
        label: "70% Verbrauchskosten",
        totalCost: formatNumDe(verbTotal),
        totalUnits: `${formatNumDe(buildingKwh, 3)} Kilowatt-Stunden`,
        pricePerUnit: formatNumDe(verbTotal / buildingKwh, 6),
        ownUnits: formatNumDe(ownKwh, 3),
        ownCost: formatNumDe(verbOwn),
      },
      {
        label: "Ihre Heizkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(heizOwn),
        emphasis: true,
      },
      {
        label: "Kaltwasserkosten",
        totalCost: formatNumDe(kwTotal),
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: "",
        emphasis: true,
      },
      {
        label: "Grundgebühr Kaltwasser",
        totalCost: formatNumDe(kwGrundTotal),
        totalUnits: `${formatNumDe(buildingM3, 3)} Kubikmeter`,
        pricePerUnit: formatNumDe(kwGrundTotal / buildingM3, 6),
        ownUnits: formatNumDe(ownM3, 3),
        ownCost: formatNumDe(kwGrundOwn),
      },
      {
        label: "Abwasser Kalt",
        totalCost: formatNumDe(kwAbwasserTotal),
        totalUnits: `${formatNumDe(buildingM3, 3)} Kubikmeter`,
        pricePerUnit: formatNumDe(kwAbwasserTotal / buildingM3, 6),
        ownUnits: formatNumDe(ownM3, 3),
        ownCost: formatNumDe(kwAbwasserOwn),
      },
      {
        label: "Gerätemiete Kaltwasser",
        totalCost: formatNumDe(kwMieteTotal),
        totalUnits: `${formatNumDe(buildingM3, 3)} Kubikmeter`,
        pricePerUnit: formatNumDe(kwMieteTotal / buildingM3, 6),
        ownUnits: formatNumDe(ownM3, 3),
        ownCost: formatNumDe(kwMieteOwn),
      },
      {
        label: "Ihre Kaltwasserkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(kwOwn),
        emphasis: true,
      },
      {
        label: "Betriebskosten",
        totalCost: formatNumDe(betrTotal),
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: "",
        emphasis: true,
      },
      {
        label: "Niederschlagswasser",
        totalCost: formatNumDe(betrTotal),
        totalUnits: `${formatNumDe(buildingM3, 3)} Kubikmeter`,
        pricePerUnit: formatNumDe(betrTotal / buildingM3, 6),
        ownUnits: formatNumDe(ownM3, 3),
        ownCost: formatNumDe(betrOwn),
      },
      {
        label: "Ihre Betriebskosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(betrOwn),
        emphasis: true,
      },
      {
        label: "Direktkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: "",
        emphasis: true,
      },
      {
        label: "Nutzerwechselkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(direktOwn),
      },
      {
        label: "Ihre Direktkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(direktOwn),
        emphasis: true,
      },
      {
        label: "Ihr Anteil an den Gesamtkosten",
        totalCost: "",
        totalUnits: "",
        pricePerUnit: "",
        ownUnits: "",
        ownCost: formatNumDe(total),
        emphasis: true,
      },
    ];

    return {
      docType: HEIZ_META.docType,
      regionId: "germany",
      kind: "gas",
      utilityName: HEIZ_META.utilityName,
      utilityNameZh: HEIZ_META.utilityNameZh,
      tagline: HEIZ_META.tagline,
      currency: HEIZ_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: formatDateDe(periodStartIso),
      periodEnd: formatDateDe(periodEndIso),
      periodDays: HEIZ_META.periodDays,
      meterRows: [
        {
          label: `Wärmezähler ${meterNr} · Wärme`,
          previous: formatNumDe(0, 3),
          current: formatNumDe(ownKwh, 3),
          usage: formatNumDe(ownKwh, 3),
        },
      ],
      usageSummary: `${formatNumDe(ownKwh, 0)} kWh · ${HEIZ_META.periodDays} Tage`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        { label: "Ihre Heizkosten", amount: heizOwn },
        { label: "Ihre Kaltwasserkosten", amount: kwOwn },
        { label: "Ihre Betriebskosten", amount: betrOwn },
        { label: "Ihre Direktkosten", amount: direktOwn },
      ],
      subtotal,
      taxLabel: "Umsatzsteuer nicht ausgewiesen",
      tax: 0,
      total,
      allocation,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        `In dieser Abrechnung sind Heiz- und Brennstoffkosten in Höhe von ${formatMoneyDe(brennstoffGesamt)} angefallen. ` +
          `Der Bund hat für diese Liegenschaft folgende Kosten übernommen: Im Rahmen des ` +
          `Erdgas-Wärme-Preisbremsengesetzes (EWPBG): ${formatMoneyDe(uebernommen)}. ` +
          `Dieser Betrag wurde in der Heizkostenabrechnung verrechnet.`,
        `Ihr individueller Anteil an der Entlastung gemäß EWPBG beträgt ${formatMoneyDe(entlastung)}. ` +
          `Dieser Anteil wurde schon bei Ihren Heizkosten berücksichtigt.`,
        `Dieses Dokument ist ein fiktives Layout-Muster; alle Kostenstellen, Preise und Entlastungsbeträge sind frei erfunden.`,
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const createdDe = deDateFromEn(vm.billDate);
    const periodYear = `${vm.periodStart.slice(6, 10)}/${Number(vm.periodStart.slice(6, 10)) + 1}`;
    const addressHtml = vm.addressLines
      .map(
        (line) =>
          `<div style="font-size:32px;color:${NAVY};line-height:1.55;">${escapeHtml(line)}</div>`,
      )
      .join("");
    const recapRows = vm.charges
      .map(
        (line) =>
          `<div style="display:flex;justify-content:space-between;padding:15px 30px;background:${PINK_BG};` +
          `border-bottom:2px solid ${PINK_LINE};font-size:30px;color:${NAVY};">` +
          `<span>${escapeHtml(line.label)}</span>` +
          `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(line.amount))} EUR</span></div>`,
      )
      .join("");
    const notesHtml = vm.notes
      .map(
        (note) =>
          `<p style="margin:0 0 14px;font-size:27px;color:#333c42;line-height:1.65;text-align:justify;">${escapeHtml(note)}</p>`,
      )
      .join("");
    return (
      `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
      `background:#ffffff;color:${NAVY};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
      `<div style="position:absolute;inset:0;padding:96px 110px;display:flex;flex-direction:column;box-sizing:border-box;">` +
      // 1. 页眉：地址（左） + 居中字标 + 红色标题 / 元信息（右）
      `<div style="position:relative;">` +
      `<div style="position:absolute;left:50%;top:0;transform:translateX(-50%);">${logoBlock()}</div>` +
      `<div style="display:flex;justify-content:space-between;">` +
      `<div style="width:900px;flex:none;">` +
      `<div style="font-size:46px;font-weight:800;color:${NAVY};">${escapeHtml(vm.customerName)}</div>` +
      `${addressHtml}` +
      `<div style="margin-top:64px;">` +
      `<div style="font-size:30px;font-weight:700;">Ihr Nutzungszeitraum</div>` +
      `<div style="font-size:30px;margin-top:6px;">${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}</div></div>` +
      `<div style="margin-top:52px;">` +
      `<div style="font-size:30px;font-weight:700;">Abrechnungszeitraum</div>` +
      `<div style="font-size:30px;margin-top:6px;">${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}</div></div>` +
      `</div>` +
      `<div style="width:720px;flex:none;padding-top:120px;">` +
      `<div style="font-size:42px;font-weight:800;color:${RED};line-height:1.35;">` +
      `Heiz- und Hausnebenkosten-<br/>abrechnung ${escapeHtml(periodYear)}</div>` +
      `<div style="margin-top:56px;font-size:30px;line-height:1.5;">` +
      `<div style="font-weight:700;">Erstellt am</div><div>${escapeHtml(createdDe)}</div></div>` +
      `<div style="margin-top:44px;font-size:30px;line-height:1.5;">` +
      `<div style="font-weight:700;">Ihre Nutzer-Nr.</div><div>${escapeHtml(vm.accountNumber)}</div></div>` +
      `<div style="margin-top:44px;font-size:30px;line-height:1.5;">` +
      `<div style="font-weight:700;">Abrechnungs-Nr.</div><div>${escapeHtml(vm.invoiceNumber)}</div></div>` +
      `</div></div></div>` +
      // 4. 右侧粉色费用回顾框
      `<div style="display:flex;justify-content:flex-end;margin-top:56px;">` +
      `<div style="width:940px;border:2px solid ${PINK_LINE};">` +
      recapRows +
      `<div style="display:flex;justify-content:space-between;padding:17px 30px;background:${PINK_BG};` +
      `font-size:31px;font-weight:800;color:${NAVY};">` +
      `<span>Ihr Anteil an den Gesamtkosten</span>` +
      `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatNumDe(vm.total))} EUR</span></div>` +
      `</div></div>` +
      // 5. 红条信息框：Energiekostenentlastung（EWPBG）
      `<div style="margin-top:56px;border-left:10px solid ${RED};border-top:2px solid ${PINK_LINE};` +
      `border-bottom:2px solid ${PINK_LINE};padding:24px 36px;">` +
      `<div style="font-size:34px;font-weight:800;color:${NAVY};margin-bottom:12px;">Information zur Energiekostenentlastung</div>` +
      `${notesHtml}</div>` +
      // 6. 分摊表
      `<div style="margin-top:60px;">${sectionHeading("Ihr Anteil an den Gesamtkosten (1)")}${allocationTableHtml(vm)}</div>` +
      // 7. 抄表值
      `<div style="margin-top:56px;">${sectionHeading("Ihre Ablesewerte")}${meterReadingsHtml(vm)}</div>` +
      // 8. 续页提示
      `<div style="margin-top:48px;font-size:32px;font-weight:700;color:${RED};">Fortsetzung auf der Folgeseite</div>` +
      // 9. 脚注框 + 页码
      `<div style="margin-top:44px;border:2px solid #9aa2ad;padding:20px 30px;font-size:25px;color:#4a5560;line-height:1.8;">` +
      `<div>(1)&#160; Die Gesamtkosten können Sie der nachfolgenden Kostenaufstellung des gesamten Objektes entnehmen</div>` +
      `<div>(2)&#160; Gesamteinheiten des Objektes</div>` +
      `<div>(3)&#160; Siehe Erläuterungen</div></div>` +
      `<div style="display:flex;justify-content:flex-end;margin-top:18px;font-size:26px;color:#6b7280;">Seite 1/3</div>` +
      // 10. 免责声明页脚
      `<div style="margin-top:auto;padding-top:26px;border-top:1px solid #d9d6ce;font-size:25px;color:#a2a9ae;line-height:1.7;">` +
      `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
      ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
      `</div>` +
      (opts.watermark ? watermarkLayer() : "") +
      `</div>`
    );
  },
};
