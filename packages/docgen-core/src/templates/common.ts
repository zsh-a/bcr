/**
 * 模板公共层：日期 / 金额格式化、A4 画布外壳（2481×3509 = A4@300DPI）、
 * 页眉 logo 区、金额汇总框、付款区（Code128 + 伪 QR）、水印层。
 * 所有机构 / 地名 / 货币均为虚构。渲染输出完全自包含（内联 CSS/SVG，系统字体栈）。
 */

import { code128Svg } from "../barcode";
import { fnv1a, mulberry32 } from "../hash";
import type { BillInput, BillKind, BillViewModel, RegionId, RenderOptions } from "../model";
import { pseudoQrSvg } from "../pseudoqr";

export const CANVAS_WIDTH = 2481;
export const CANVAS_HEIGHT = 3509;

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "2026-09-09" → "09 Sep 2026"（不依赖 ICU，输出完全确定） */
export function formatDateEn(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS_EN[Number(m) - 1] ?? "???";
  return `${d} ${month} ${y}`;
}

/** 以 UTC 做日期算术，避免本地时区导致的偏移 */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
  );
}

export function isoToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 虚构货币格式化，如 "NDK 1,234.56" */
export function formatMoney(currency: string, amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

/** 指定 locale 的货币格式化（各地区账单按其本地排版习惯） */
export function formatMoneyLocale(locale: string, currency: string, amount: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

/** 德语数字格式：千分位点、小数逗号、€ 后缀（de-DE locale） */
export function formatMoneyDe(amount: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatNumDe(n: number, decimals = 2): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 地址行排版（按地区习惯合并）：
 * streetNumber/streetNo + streetName 合并为一行；
 * 美式 "City, ST 12345"；加拿大 "City, PR A1A 1A1"；澳洲 "Suburb CQL 4820"；
 * 德式 "91240 Falkenheim"；其余字段各自成行。
 */
export function formatAddressLines(address: Record<string, string>): string[] {
  const values = Object.entries(address).filter(([, v]) => v.trim().length > 0);
  const get = (key: string): string | undefined => {
    const v = address[key]?.trim();
    return v !== undefined && v.length > 0 ? v : undefined;
  };
  const lines: string[] = [];
  let pendingNumber: string | null = null;
  const consumed = new Set<string>();
  for (const [key, value] of values) {
    if (consumed.has(key)) continue;
    if (key === "streetNumber" || key === "streetNo") {
      pendingNumber = value.trim();
      continue;
    }
    if (key === "streetName" && pendingNumber !== null) {
      lines.push(`${pendingNumber} ${value.trim()}`);
      pendingNumber = null;
      continue;
    }
    if (pendingNumber !== null) {
      lines.push(pendingNumber);
      pendingNumber = null;
    }
    // 美式：city, state zip
    if (key === "city" && get("state") !== undefined) {
      const zip = get("zip");
      lines.push(`${value.trim()}, ${get("state") ?? ""}${zip !== undefined ? ` ${zip}` : ""}`);
      consumed.add("state");
      consumed.add("zip");
      continue;
    }
    // 加拿大：city, province postalCode
    if (key === "city" && get("province") !== undefined) {
      const pc = get("postalCode");
      lines.push(`${value.trim()}, ${get("province") ?? ""}${pc !== undefined ? ` ${pc}` : ""}`);
      consumed.add("province");
      consumed.add("postalCode");
      continue;
    }
    // 澳洲：suburb state postcode
    if (key === "suburb" && get("state") !== undefined) {
      const pc = get("postcode");
      lines.push(`${value.trim()} ${get("state") ?? ""}${pc !== undefined ? ` ${pc}` : ""}`);
      consumed.add("state");
      consumed.add("postcode");
      continue;
    }
    // 德式：plz ort
    if (key === "plz" && get("ort") !== undefined) {
      lines.push(`${value.trim()} ${get("ort") ?? ""}`);
      consumed.add("ort");
      continue;
    }
    lines.push(value.trim());
  }
  if (pendingNumber !== null) lines.push(pendingNumber);
  return lines;
}

export interface TemplateMeta {
  readonly docType: string;
  readonly regionId: RegionId;
  readonly kind: BillKind;
  readonly utilityName: string;
  readonly utilityNameZh: string;
  readonly tagline: string;
  readonly currency: string;
  /** 单号 / 条码前缀，如 "NHW" */
  readonly prefix: string;
  readonly periodDays: number;
  readonly accent: string;
  /** 金额排版的 locale（默认 en-US；德国模板走 formatMoneyDe 不使用此字段） */
  readonly locale?: string;
}

/** 按 meta.locale 格式化金额（缺省 en-US） */
export function fmtMeta(meta: TemplateMeta, amount: number): string {
  return formatMoneyLocale(meta.locale ?? "en-US", meta.currency, amount);
}

export interface BaseVm {
  readonly billDateIso: string;
  readonly accountNumber: string;
  readonly invoiceNumber: string;
  readonly addressLines: ReadonlyArray<string>;
  readonly billDate: string;
  readonly dueDate: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * 账单公共派生：单号 / 户号 / 日期区间。
 * dueDate = billDate + 21 天；账期 = billDate 往前推 periodDays 天（留 4 天出账缓冲）。
 * 编号 seed 只依赖 (docType, name, address)——不含日期，改日期不会改用量。
 */
export function buildBase(input: BillInput, meta: TemplateMeta): BaseVm {
  const billDateIso = input.billDate ?? isoToday();
  const seedKey = `${meta.docType}::${input.name}::${JSON.stringify(input.address)}`;
  const h = fnv1a(seedKey);
  const accountNumber = `${1000000000 + (h % 8999999999)}`;
  const serial = `${10000 + (h >>> 7) % 89999}`;
  const yyMM = `${billDateIso.slice(2, 4)}${billDateIso.slice(5, 7)}`;
  const invoiceNumber = `${meta.prefix}-${yyMM}-${serial}`;
  const dueIso = addDaysIso(billDateIso, 21);
  const periodEndIso = addDaysIso(billDateIso, -4);
  const periodStartIso = addDaysIso(periodEndIso, -(meta.periodDays - 1));
  const addressLines = formatAddressLines(input.address);
  return {
    billDateIso,
    accountNumber,
    invoiceNumber,
    addressLines,
    billDate: formatDateEn(billDateIso),
    dueDate: formatDateEn(dueIso),
    periodStart: formatDateEn(periodStartIso),
    periodEnd: formatDateEn(periodEndIso),
  };
}

/** 抄表/用量记录表（meterRows 为空时返回空串） */
export function meterTableHtml(vm: BillViewModel): string {
  if (vm.meterRows.length === 0) return "";
  return (
    `<table style="width:100%;border-collapse:collapse;margin-top:16px;">` +
    `<tr style="font-size:30px;color:#8a9298;text-transform:uppercase;letter-spacing:2px;">` +
    `<th style="text-align:left;padding:14px 0;font-weight:600;">Meter</th>` +
    `<th style="text-align:right;padding:14px 0;font-weight:600;">Previous</th>` +
    `<th style="text-align:right;padding:14px 0;font-weight:600;">Current</th>` +
    `<th style="text-align:right;padding:14px 0;font-weight:600;">Usage</th></tr>` +
    vm.meterRows
      .map(
        (row) =>
          `<tr style="font-size:38px;color:#1b2327;">` +
          `<td style="padding:18px 0;border-bottom:2px solid #e7e4dc;">${escapeHtml(row.label)}</td>` +
          `<td style="padding:18px 0;border-bottom:2px solid #e7e4dc;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.previous)}</td>` +
          `<td style="padding:18px 0;border-bottom:2px solid #e7e4dc;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.current)}</td>` +
          `<td style="padding:18px 0;border-bottom:2px solid #e7e4dc;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(row.usage)}</td></tr>`,
      )
      .join("") +
    `</table>`
  );
}

/** 用量柱状图（纯 HTML/CSS div；bars 为空时返回空串）。maxHeight 供不同流派调节 */
export function barsHtml(vm: BillViewModel, meta: TemplateMeta, maxHeight = 380): string {
  if (vm.bars.length === 0) return "";
  const max = Math.max(...vm.bars.map((b) => b.value), 1);
  const valueFont = vm.bars.length > 8 ? 22 : 28;
  const bars = vm.bars
    .map((bar) => {
      const height = Math.max(20, Math.round((bar.value / max) * maxHeight));
      return (
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${maxHeight + 80}px;">` +
        `<div style="font-size:${valueFont}px;color:#5a656c;margin-bottom:8px;">${formatInt(bar.value)}</div>` +
        `<div style="width:78%;height:${height}px;background:${meta.accent};border-radius:12px 12px 0 0;"></div>` +
        `<div style="font-size:${valueFont}px;color:#8a9298;margin-top:12px;">${escapeHtml(bar.label)}</div></div>`
      );
    })
    .join("");
  return (
    `<div style="margin-top:70px;background:#f7f6f1;border-radius:22px;padding:48px 54px;">` +
    `<div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:26px;">` +
    `${escapeHtml(vm.barTitle)} · 近 ${vm.bars.length} 期用量（${escapeHtml(vm.barUnit)}）</div>` +
    `<div style="display:flex;gap:${vm.bars.length > 8 ? 14 : 26}px;align-items:flex-end;">${bars}</div></div>`
  );
}

/** 虚构 logo：底色圆角块 + 内联 SVG 图形（按账单类型区分） */
function logoGlyph(kind: BillKind): string {
  switch (kind) {
    case "water":
      return `<path d="M50 12 C50 12 20 52 20 74 a30 30 0 0 0 60 0 C80 52 50 12 50 12 Z" fill="#ffffff" opacity="0.95"/>`;
    case "power":
      return `<polygon points="56,8 24,58 46,58 40,92 76,42 54,42" fill="#ffffff" opacity="0.95"/>`;
    case "gas":
      return `<path d="M50 8 C62 26 78 40 78 62 a28 28 0 0 1 -56 0 C22 40 38 30 50 8 Z" fill="#ffffff" opacity="0.95"/>`;
    case "telecom":
      return `<g stroke="#ffffff" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.95"><path d="M22 44 a40 40 0 0 1 56 0"/><path d="M33 60 a24 24 0 0 1 34 0"/><circle cx="50" cy="76" r="7" fill="#ffffff" stroke="none"/></g>`;
  }
}

function logoBlock(meta: TemplateMeta): string {
  return (
    `<div style="width:190px;height:190px;border-radius:38px;background:${meta.accent};` +
    `display:flex;align-items:center;justify-content:center;flex:none;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120">${logoGlyph(meta.kind)}</svg>` +
    `</div>`
  );
}

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

function chargesSection(vm: BillViewModel): string {
  const rows = vm.charges
    .map(
      (line) =>
        `<tr><td style="padding:22px 0;border-bottom:2px solid #e7e4dc;font-size:38px;color:#333c42;">${escapeHtml(line.label)}</td>` +
        `<td style="padding:22px 0;border-bottom:2px solid #e7e4dc;font-size:38px;text-align:right;color:#1b2327;` +
        `font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, line.amount))}</td></tr>`,
    )
    .join("");
  const summaryRow = (label: string, value: string, strong: boolean): string =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;` +
    `${strong ? "margin-top:18px;padding-top:18px;border-top:3px solid #1b2327;" : "margin-top:10px;"}">` +
    `<span style="font-size:${strong ? 44 : 36}px;${strong ? "font-weight:700;" : "color:#5a656c;"}">${label}</span>` +
    `<span style="font-size:${strong ? 52 : 38}px;font-weight:${strong ? 800 : 500};` +
    `font-variant-numeric:tabular-nums;">${value}</span></div>`;
  return (
    `<div style="display:flex;gap:110px;margin-top:90px;">` +
    `<div style="flex:1;"><div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;` +
    `margin-bottom:14px;">Charge details · 费用明细</div>` +
    `<table style="width:100%;border-collapse:collapse;">${rows}</table></div>` +
    `<div style="width:760px;flex:none;background:#f2f0e9;border-radius:22px;padding:48px 54px;align-self:flex-start;">` +
    `<div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;">Summary · 汇总</div>` +
    summaryRow("Subtotal", formatMoney(vm.currency, vm.subtotal), false) +
    summaryRow(escapeHtml(vm.taxLabel), formatMoney(vm.currency, vm.tax), false) +
    summaryRow("Total due", formatMoney(vm.currency, vm.total), true) +
    `<div style="margin-top:22px;font-size:32px;color:#5a656c;">Please pay by ${escapeHtml(vm.dueDate)}</div>` +
    `</div></div>`
  );
}

function paymentStrip(vm: BillViewModel, meta: TemplateMeta): string {
  const barcode = code128Svg(vm.barcodePayload, { moduleWidth: 4, height: 150 });
  const qr = pseudoQrSvg(vm.qrSeed, { module: 9 });
  return (
    `<div style="margin-top:96px;border-top:4px solid ${meta.accent};padding-top:44px;` +
    `display:flex;justify-content:space-between;align-items:flex-end;">` +
    `<div><div style="font-size:32px;color:#5a656c;margin-bottom:16px;">` +
    `Payment reference · 付款参考：<b style="color:#1b2327;">${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>${barcode}</div>` +
    `<div style="font-size:30px;letter-spacing:8px;color:#333c42;margin-top:10px;">${escapeHtml(vm.barcodePayload)}</div></div>` +
    `<div style="text-align:center;"><div>${qr}</div>` +
    `<div style="font-size:28px;color:#8a9298;margin-top:10px;">Scan to pay (decorative)</div></div>` +
    `</div>`
  );
}

/**
 * 账单外壳：页眉（logo + 机构名 / 单号块）、客户地址块、模板正文、
 * 费用汇总、付款区、脚注、可选水印。bodyHtml 由各模板提供。
 */
export function renderShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:38px;color:#333c42;line-height:1.5;">${escapeHtml(line)}</div>`)
    .join("");
  const meterSection = meterTableHtml(vm);
  const barSection = barsHtml(vm, meta);
  const notes =
    vm.notes.length === 0
      ? ""
      : `<ul style="margin:70px 0 0;padding-left:46px;font-size:30px;color:#8a9298;line-height:1.7;">` +
        vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("") +
        `</ul>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#fdfdfa;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:36px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:130px 140px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:44px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:74px;font-weight:800;letter-spacing:-1px;line-height:1.1;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:40px;color:#5a656c;margin-top:6px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="text-align:right;font-size:34px;color:#333c42;line-height:1.75;">` +
    `<div style="font-size:44px;font-weight:800;letter-spacing:4px;color:${meta.accent};">` +
    `${vm.kind.toUpperCase()} BILL</div>` +
    `<div>Invoice <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>Account <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Bill date ${escapeHtml(vm.billDate)}</div>` +
    `<div>Due date <b>${escapeHtml(vm.dueDate)}</b></div></div></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:70px;">` +
    `<div><div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:12px;">Bill to · 账单寄送</div>` +
    `<div style="font-size:56px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:36px;color:#333c42;line-height:1.8;">` +
    `<div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;">Billing period · 账期</div>` +
    `<div>${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}</div>` +
    `<div style="color:#5a656c;">${vm.periodDays} days · ${escapeHtml(vm.usageSummary)}</div></div></div>` +
    `<div style="margin-top:56px;">${meterSection}${bodyHtml}</div>` +
    barSection +
    chargesSection(vm) +
    paymentStrip(vm, meta) +
    notes +
    `<div style="margin-top:auto;padding-top:60px;border-top:2px solid #e7e4dc;font-size:28px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 美式流派（US-style） ================= */

/** OCR 扫描行：由确定性 hash 派生的一长串等宽数字（装饰用，模拟回单底部机读行） */
function ocrScanLine(vm: BillViewModel): string {
  const rng = mulberry32(fnv1a(`ocr::${vm.barcodePayload}::${vm.total.toFixed(2)}`));
  const digits = (n: number): string =>
    Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
  const cents = `${Math.round(vm.total * 100)}`.padStart(8, "0");
  return `${vm.accountNumber}${digits(6)} ${vm.barcodePayload}${digits(4)} ${cents}${digits(10)}`;
}

/** 美式账户摘要条：Previous / Payments / Current / Total Due（勾稽：total = prev − payments + current） */
function usAccountSummary(vm: BillViewModel, meta: TemplateMeta): string {
  const s = vm.accountSummary;
  if (s === undefined) return "";
  const cell = (label: string, value: number, strong: boolean, negative = false): string =>
    `<div style="flex:1;padding:30px 34px;${strong ? `background:${meta.accent};color:#ffffff;border-radius:0 0 14px 0;` : ""}">` +
    `<div style="font-size:28px;letter-spacing:2px;text-transform:uppercase;${strong ? "color:rgba(255,255,255,0.85);" : "color:#8a9298;"}">${label}</div>` +
    `<div style="font-size:${strong ? 46 : 40}px;font-weight:${strong ? 800 : 600};margin-top:8px;font-variant-numeric:tabular-nums;">` +
    `${negative ? "−" : ""}${escapeHtml(formatMoney(vm.currency, value))}</div></div>`;
  return (
    `<div style="display:flex;margin-top:60px;border:3px solid #d8d4ca;border-radius:16px;overflow:hidden;">` +
    cell("Previous balance", s.previousBalance, false) +
    cell("Payments received", s.paymentsReceived, false, true) +
    cell("Current charges", s.currentCharges, false) +
    cell("Total due", vm.total, true) +
    `</div>`
  );
}

/** 美式费用明细：全宽表 + 底行合计（无独立汇总卡片，汇总在顶部大框里） */
function usChargesTable(vm: BillViewModel, meta: TemplateMeta): string {
  const rows = vm.charges
    .map(
      (line) =>
        `<tr><td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:36px;color:#333c42;">${escapeHtml(line.label)}</td>` +
        `<td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:36px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, line.amount))}</td></tr>`,
    )
    .join("");
  return (
    `<div style="margin-top:70px;"><div style="font-size:34px;letter-spacing:3px;color:${meta.accent};` +
    `text-transform:uppercase;margin-bottom:12px;font-weight:700;">Current charges · 本期费用明细</div>` +
    `<table style="width:100%;border-collapse:collapse;">${rows}` +
    `<tr><td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:36px;color:#333c42;">${escapeHtml(vm.taxLabel)}</td>` +
    `<td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:36px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, vm.tax))}</td></tr>` +
    `<tr><td style="padding:24px 0;font-size:40px;font-weight:800;">Total current charges</td>` +
    `<td style="padding:24px 0;font-size:40px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, vm.subtotal + vm.tax))}</td></tr>` +
    `</table></div>`
  );
}

/** 美式撕线回单存根：dashed perforation + 空心金额填写框 + 条码 + OCR 扫描行 */
function remittanceStub(vm: BillViewModel, meta: TemplateMeta): string {
  const barcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 110 });
  return (
    `<div style="margin-top:60px;">` +
    `<div style="border-top:4px dashed #9aa29b;position:relative;padding-top:8px;">` +
    `<span style="position:absolute;left:-30px;top:-30px;font-size:44px;color:#9aa29b;">✂</span>` +
    `<div style="text-align:center;font-size:28px;letter-spacing:6px;color:#8a9298;text-transform:uppercase;">Detach and return with payment · 撕线以下随付款寄回</div></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;">` +
    `<div style="font-size:32px;color:#333c42;line-height:1.8;">` +
    `<div style="font-weight:700;color:${meta.accent};">${escapeHtml(vm.utilityName)}</div>` +
    `<div>Account <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Invoice ${escapeHtml(vm.invoiceNumber)}</div>` +
    `<div>Due by <b>${escapeHtml(vm.dueDate)}</b></div></div>` +
    `<div style="text-align:center;">` +
    `<div style="font-size:28px;letter-spacing:2px;color:#8a9298;text-transform:uppercase;">Amount enclosed</div>` +
    `<div style="width:460px;height:96px;border:4px solid #1b2327;border-radius:8px;margin-top:10px;` +
    `display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:700;` +
    `font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, vm.total))}</div></div>` +
    `<div style="text-align:center;"><div>${barcode}</div></div></div>` +
    `<div style="margin-top:34px;font-family:'Courier New',monospace;font-size:34px;letter-spacing:3px;color:#333c42;">` +
    `${escapeHtml(ocrScanLine(vm))}</div>` +
    `</div>`
  );
}

/**
 * 美式流派外壳：顶部右侧大号 Amount Due 汇总框 + 账户摘要条 + 用量图 +
 * 明细表 + 底部撕线回单存根。与通用外壳是明显的结构差异（非换皮）。
 */
export function renderUsShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:36px;color:#333c42;line-height:1.5;">${escapeHtml(line)}</div>`)
    .join("");
  const notes =
    vm.notes.length === 0
      ? ""
      : `<ul style="margin:56px 0 0;padding-left:46px;font-size:28px;color:#8a9298;line-height:1.7;">` +
        vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("") +
        `</ul>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:28px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:110px 130px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:40px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:66px;font-weight:800;letter-spacing:-1px;line-height:1.1;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:38px;color:#5a656c;margin-top:6px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="border:4px solid ${meta.accent};border-radius:18px;padding:34px 48px;text-align:center;flex:none;">` +
    `<div style="font-size:30px;letter-spacing:5px;color:#5a656c;text-transform:uppercase;">Amount due</div>` +
    `<div style="font-size:88px;font-weight:800;color:${meta.accent};font-variant-numeric:tabular-nums;line-height:1.15;">${escapeHtml(formatMoney(vm.currency, vm.total))}</div>` +
    `<div style="font-size:32px;color:#333c42;margin-top:6px;">Due by ${escapeHtml(vm.dueDate)}</div></div></div>` +
    usAccountSummary(vm, meta) +
    `<div style="display:flex;justify-content:space-between;margin-top:56px;">` +
    `<div><div style="font-size:32px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:10px;">Service for · 客户</div>` +
    `<div style="font-size:50px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:34px;color:#333c42;line-height:1.8;">` +
    `<div>Invoice <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>Account <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Bill date ${escapeHtml(vm.billDate)}</div>` +
    `<div style="color:#5a656c;">${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)} · ${escapeHtml(vm.usageSummary)}</div></div></div>` +
    `<div style="margin-top:40px;">${meterTableHtml(vm)}${bodyHtml}</div>` +
    barsHtml(vm, meta, 300) +
    usChargesTable(vm, meta) +
    notes +
    `<div style="margin-top:auto;">` +
    `<div style="padding-top:40px;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    remittanceStub(vm, meta) +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 欧式流派（EU-style 极简） ================= */

/** 细线分割行 */
function euRule(meta: TemplateMeta): string {
  return `<div style="height:2px;background:${meta.accent};opacity:0.55;"></div>`;
}

function euMetaLine(label: string, value: string): string {
  return (
    `<div style="display:flex;justify-content:space-between;padding:16px 0;` +
    `border-bottom:1px solid #e3e1d9;font-size:32px;color:#333c42;">` +
    `<span style="color:#8a9298;">${label}</span><span>${value}</span></div>`
  );
}

/**
 * 欧式流派外壳：极简双栏、细线分割、大留白、standing charge / unit rate / VAT
 * 分行计价，Direct Debit 提示行。窄栏布局、无大面积色块。
 */
export function renderEuShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:34px;color:#333c42;line-height:1.6;">${escapeHtml(line)}</div>`)
    .join("");
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;padding:22px 0;border-bottom:1px solid #e3e1d9;">` +
        `<span style="font-size:34px;color:#333c42;">${escapeHtml(line.label)}</span>` +
        `<span style="font-size:34px;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, line.amount))}</span></div>`,
    )
    .join("");
  const qr = pseudoQrSvg(vm.qrSeed, { module: 7 });
  const notes =
    vm.notes.length === 0
      ? ""
      : `<ul style="margin:64px 0 0;padding-left:42px;font-size:28px;color:#8a9298;line-height:1.8;">` +
        vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("") +
        `</ul>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:150px 180px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:center;">` +
    `<div style="display:flex;gap:30px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:56px;font-weight:600;letter-spacing:0;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:32px;color:#8a9298;margin-top:4px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="font-size:34px;color:#5a656c;text-transform:lowercase;letter-spacing:2px;">${vm.kind === "water" ? "water bill" : vm.kind === "power" ? "electricity bill" : `${vm.kind} bill`}</div></div>` +
    `<div style="margin-top:44px;">${euRule(meta)}</div>` +
    `<div style="display:flex;gap:130px;margin-top:64px;">` +
    `<div style="flex:1.2;">` +
    `<div style="font-size:30px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:14px;">Customer · 客户</div>` +
    `<div style="font-size:48px;font-weight:600;">${escapeHtml(vm.customerName)}</div>${addressHtml}` +
    `<div style="margin-top:48px;">` +
    euMetaLine("Bill number", `<b>${escapeHtml(vm.invoiceNumber)}</b>`) +
    euMetaLine("Account", escapeHtml(vm.accountNumber)) +
    euMetaLine("Bill date", escapeHtml(vm.billDate)) +
    euMetaLine("Billing period", `${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}`) +
    `</div></div>` +
    `<div style="flex:1;">` +
    `<div style="font-size:30px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;">Total to pay · 应付总额</div>` +
    `<div style="font-size:104px;font-weight:300;color:#1b2327;font-variant-numeric:tabular-nums;line-height:1.2;margin-top:10px;">${escapeHtml(formatMoney(vm.currency, vm.total))}</div>` +
    `<div style="font-size:32px;color:#5a656c;margin-top:8px;">Payment due by ${escapeHtml(vm.dueDate)}</div>` +
    `<div style="margin-top:40px;padding:30px 34px;border:2px solid #e3e1d9;border-radius:14px;font-size:32px;color:#333c42;line-height:1.6;">` +
    `You pay by <b>Direct Debit</b> — no action needed, we collect on ${escapeHtml(vm.dueDate)}. 已通过直接扣款支付，无需操作。</div>` +
    `</div></div>` +
    `<div style="margin-top:70px;"><div style="font-size:30px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:8px;">How we worked it out · 费用构成</div>` +
    `${chargeRows}` +
    `<div style="display:flex;justify-content:space-between;padding:22px 0;border-bottom:1px solid #e3e1d9;">` +
    `<span style="font-size:34px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:34px;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, vm.tax))}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:26px 0;margin-top:4px;">` +
    `<span style="font-size:40px;font-weight:700;">Total this bill</span>` +
    `<span style="font-size:44px;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(vm.currency, vm.total))}</span></div>` +
    `${euRule(meta)}</div>` +
    `<div style="margin-top:48px;">${meterTableHtml(vm)}${bodyHtml}</div>` +
    `<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;">` +
    `<div style="font-size:28px;color:#8a9298;line-height:1.8;">` +
    `Questions about this bill? Quote your account number. 咨询请报户号。<br/>` +
    `Pay online with the reference code shown here.</div>` +
    `<div style="text-align:center;"><div>${qr}</div>` +
    `<div style="font-size:26px;color:#a2a9ae;margin-top:8px;">Payment reference (decorative)</div></div></div>` +
    notes +
    `<div style="margin-top:48px;padding-top:32px;border-top:1px solid #e3e1d9;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 德国流派（DE-style 年度结算 Jahresabrechnung） ================= */

/** 德式密表行 */
function deRow(label: string, value: string, opts?: { bold?: boolean; topBorder?: boolean; color?: string }): string {
  return (
    `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:16px 0;` +
    `border-bottom:1px solid #d9d6ce;${opts?.topBorder === true ? "border-top:3px solid #1b2327;" : ""}">` +
    `<span style="font-size:33px;${opts?.bold === true ? "font-weight:700;" : "color:#333c42;"}">${label}</span>` +
    `<span style="font-size:${opts?.bold === true ? 40 : 33}px;font-weight:${opts?.bold === true ? 800 : 500};` +
    `font-variant-numeric:tabular-nums;${opts?.color !== undefined ? `color:${opts.color};` : ""}">${value}</span></div>`
  );
}

/** Zählerstände 表：Zählernummer / Ablesedatum / alt / neu / Verbrauch（德式抄表表头） */
function deMeterTable(vm: BillViewModel, unit: string): string {
  const rows = vm.meterRows
    .map(
      (row) =>
        `<tr style="font-size:30px;color:#1b2327;">` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;text-align:right;">${escapeHtml(vm.periodStart)}</td>` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.previous)}</td>` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;text-align:right;">${escapeHtml(vm.periodEnd)}</td>` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.current)}</td>` +
        `<td style="padding:14px 0;border-bottom:1px solid #d9d6ce;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(row.usage)}</td></tr>`,
    )
    .join("");
  return (
    `<div style="margin-top:54px;"><div style="font-size:30px;letter-spacing:2px;color:#5a656c;` +
    `text-transform:uppercase;margin-bottom:10px;">Zählerstände · 抄表记录（${unit}）</div>` +
    `<table style="width:100%;border-collapse:collapse;">` +
    `<tr style="font-size:26px;color:#8a9298;text-transform:uppercase;letter-spacing:1px;">` +
    `<th style="text-align:left;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Zähler</th>` +
    `<th style="text-align:right;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Ablesedatum alt</th>` +
    `<th style="text-align:right;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Zählerstand alt</th>` +
    `<th style="text-align:right;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Ablesedatum neu</th>` +
    `<th style="text-align:right;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Zählerstand neu</th>` +
    `<th style="text-align:right;padding:10px 0;font-weight:600;border-bottom:2px solid #1b2327;">Verbrauch</th></tr>` +
    rows +
    `</table></div>`
  );
}

/** Abschlag 对冲块：11 期预缴汇总 + 明细网格 + Schlussbetrag（Guthaben/Nachzahlung 随符号切换） */
function deSettlementBlock(vm: BillViewModel, meta: TemplateMeta): string {
  const s = vm.settlement;
  if (s === undefined) return "";
  const monthly = s.installments[0]?.amount ?? 0;
  const grid = s.installments
    .map(
      (inst) =>
        `<div style="display:flex;justify-content:space-between;padding:8px 18px;border-bottom:1px solid #eceae3;` +
        `font-size:27px;color:#5a656c;"><span>${escapeHtml(inst.label)}</span>` +
        `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatMoneyDe(inst.amount))}</span></div>`,
    )
    .join("");
  const isCredit = s.schlussbetrag < 0;
  const label = isCredit ? "Guthaben zu Ihren Gunsten" : "Nachzahlung fällig";
  return (
    `<div style="margin-top:54px;"><div style="font-size:30px;letter-spacing:2px;color:#5a656c;` +
    `text-transform:uppercase;margin-bottom:10px;">Verrechnung Ihrer Abschläge · 预缴对冲</div>` +
    deRow(`${s.installments.length} Abschläge à ${escapeHtml(formatMoneyDe(monthly))}`, `− ${escapeHtml(formatMoneyDe(s.installmentsTotal))}`, {}) +
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 36px;margin-top:14px;background:#f7f6f1;` +
    `border-radius:12px;padding:16px 18px;">${grid}</div>` +
    `<div style="margin-top:22px;padding:26px 34px;border:3px solid ${isCredit ? "#2e7d4f" : meta.accent};border-radius:14px;` +
    `display:flex;justify-content:space-between;align-items:center;">` +
    `<div><div style="font-size:42px;font-weight:800;color:${isCredit ? "#2e7d4f" : meta.accent};">${label}</div>` +
    `<div style="font-size:28px;color:#5a656c;margin-top:4px;">Schlussbetrag = Gesamtbetrag brutto − Summe Abschläge</div></div>` +
    `<div style="font-size:58px;font-weight:800;font-variant-numeric:tabular-nums;color:${isCredit ? "#2e7d4f" : "#1b2327"};">` +
    `${isCredit ? "− " : ""}${escapeHtml(formatMoneyDe(Math.abs(s.schlussbetrag)))}</div></div></div>`
  );
}

/** SEPA 付款块：IBAN / BIC / Verwendungszweck + Lastschrift 提示 */
function dePaymentBlock(vm: BillViewModel, meta: TemplateMeta): string {
  const s = vm.settlement;
  if (s === undefined) return "";
  const barcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 100 });
  const isCredit = s.schlussbetrag < 0;
  return (
    `<div style="margin-top:54px;display:flex;justify-content:space-between;align-items:flex-end;">` +
    `<div style="flex:1;"><div style="font-size:30px;letter-spacing:2px;color:#5a656c;text-transform:uppercase;margin-bottom:12px;">Zahlung · 付款信息</div>` +
    `<div style="font-size:32px;color:#333c42;line-height:1.8;">` +
    `<div>IBAN <b style="font-family:'Courier New',monospace;">${escapeHtml(s.iban)}</b></div>` +
    `<div>BIC <b style="font-family:'Courier New',monospace;">${escapeHtml(s.bic)}</b></div>` +
    `<div>Verwendungszweck <b>${escapeHtml(s.verwendungszweck)}</b></div></div>` +
    `<div style="margin-top:16px;font-size:29px;color:#5a656c;line-height:1.7;">${
      isCredit
        ? "Das Guthaben wird innerhalb von 14 Tagen auf Ihr bekanntes Konto erstattet. 结余将于 14 日内退回您的账户。"
        : "Der Betrag wird per SEPA-Lastschrift von Ihrem Konto eingezogen. Sie brauchen nichts zu veranlassen. 款项将通过 SEPA 直接扣款收取，无需操作。"
    }</div></div>` +
    `<div style="text-align:center;margin-left:60px;"><div>${barcode}</div>` +
    `<div style="font-size:26px;letter-spacing:6px;color:#333c42;margin-top:8px;">${escapeHtml(vm.barcodePayload)}</div></div></div>`
  );
}

/**
 * 德国流派外壳：文字密集的表格流、公文语气。结构 =
 * 发件人行 → 页眉（Kundennummer 元信息块）→ 客户地址 → 年度结算标题与引言 →
 * Zählerstände 表 →（燃气的换算块经 bodyHtml 注入）→ Abrechnung 明细
 * （netto → USt 19% → brutto）→ Abschlag 对冲块 → SEPA 付款块。
 */
export function renderDeShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:34px;color:#1b2327;line-height:1.6;">${escapeHtml(line)}</div>`)
    .join("");
  const chargeRows = vm.charges
    .map((line) => deRow(escapeHtml(line.label), escapeHtml(formatMoneyDe(line.amount))))
    .join("");
  const notes =
    vm.notes.length === 0
      ? ""
      : `<div style="margin-top:44px;font-size:27px;color:#8a9298;line-height:1.8;">` +
        vm.notes.map((n) => `<div style="margin-bottom:8px;">${escapeHtml(n)}</div>`).join("") +
        `</div>`;
  const kindDe = vm.kind === "power" ? "Strom" : "Gas";
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:120px 140px;display:flex;flex-direction:column;">` +
    `<div style="font-size:26px;color:#8a9298;border-bottom:1px solid #d9d6ce;padding-bottom:12px;">` +
    `${escapeHtml(vm.utilityName)} · Falkenplatz 1 · 91240 Falkenheim · fiktives Musterdokument</div>` +
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:44px;">` +
    `<div style="display:flex;gap:34px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:58px;font-weight:800;letter-spacing:-0.5px;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:34px;color:#5a656c;margin-top:4px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="font-size:30px;color:#333c42;line-height:1.75;text-align:right;">` +
    `<div>Kundennummer <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Rechnungs-Nr. <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>Rechnungsdatum ${escapeHtml(vm.billDate)}</div>` +
    `<div>Abrechnungszeitraum ${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}</div></div></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:52px;">` +
    `<div><div style="font-size:28px;color:#8a9298;margin-bottom:8px;">${escapeHtml(vm.utilityName)} an</div>` +
    `<div style="font-size:42px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div></div>` +
    `<div style="margin-top:50px;">` +
    `<div style="font-size:56px;font-weight:800;color:${meta.accent};">Ihre ${kindDe}-Jahresabrechnung</div>` +
    `<div style="font-size:32px;color:#5a656c;margin-top:12px;line-height:1.75;">` +
    `Sehr geehrte Kundin, sehr geehrter Kunde, für den oben genannten Abrechnungszeitraum haben wir Ihren ` +
    `tatsächlichen Verbrauch abgerechnet und mit Ihren geleisteten Abschlagszahlungen verrechnet. ` +
    `本次年度结算将您的实际用量与已付月度预缴对冲。</div></div>` +
    deMeterTable(vm, vm.kind === "power" ? "kWh" : "m³ / kWh") +
    bodyHtml +
    `<div style="margin-top:54px;"><div style="font-size:30px;letter-spacing:2px;color:#5a656c;` +
    `text-transform:uppercase;margin-bottom:10px;">Ihre Abrechnung · 费用结算</div>` +
    chargeRows +
    deRow("Zwischensumme netto", escapeHtml(formatMoneyDe(vm.subtotal)), { bold: true, topBorder: true }) +
    deRow(escapeHtml(vm.taxLabel), escapeHtml(formatMoneyDe(vm.tax)), {}) +
    deRow("Gesamtbetrag brutto", escapeHtml(formatMoneyDe(vm.total)), { bold: true, color: meta.accent }) +
    `</div>` +
    deSettlementBlock(vm, meta) +
    dePaymentBlock(vm, meta) +
    notes +
    `<div style="margin-top:auto;padding-top:36px;border-top:1px solid #d9d6ce;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 香港流派（HK-style 双语 + 缴款回条） ================= */

/** CJK 字体栈：双语账单必须带繁中 fallback（单引号——外层 style 属性用双引号） */
const HK_FONT = `Helvetica, Arial, 'PingFang TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif`;

/** 账户条码号：XXXXX-XXXXX-X 格式（10 位户号 + 1 位 hash 校验位，装饰性） */
function hkAccountCode(vm: BillViewModel): { formatted: string; payload: string } {
  const digits10 = vm.accountNumber;
  const check = `${fnv1a(`hkacct::${digits10}`) % 10}`;
  return {
    formatted: `${digits10.slice(0, 5)}-${digits10.slice(5)}-${check}`,
    payload: `${digits10}${check}`,
  };
}

/** 存根底部 OCR 扫描行：hash 派生的等宽数字串（装饰性） */
function hkOcrLine(vm: BillViewModel): string {
  const rng = mulberry32(fnv1a(`hkocr::${vm.barcodePayload}::${vm.total.toFixed(2)}`));
  const digits = (n: number): string =>
    Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
  const cents = `${Math.round(vm.total * 100)}`.padStart(8, "0");
  return `${vm.accountNumber}${digits(4)} ${cents} ${digits(14)}`;
}

/** HK 外壳的扩展件（lc_power 全用；lc_water 只传 merchantNo） */
export interface HkShellExtras {
  /** 缴费灵风格 2 位商户编号（虚构） */
  readonly merchantNo: string;
  /** 顶部账户条码（XXXXX-XXXXX-X + Code128） */
  readonly accountBarcode?: boolean;
  /** 费用公式块：Energy + Fuel + Others = Total */
  readonly formula?: { readonly energy: number; readonly fuel: number; readonly others: number };
  /** 客戶按金 Deposit（显示项，不计入应缴） */
  readonly deposit?: number;
  /** 存根底部 OCR 扫描行 */
  readonly stubOcr?: boolean;
}

/** 费用公式块：四个数值块横向排列，"+"、"+"、"=" 连接（流派通用结构） */
function hkFormulaBlock(meta: TemplateMeta, f: { energy: number; fuel: number; others: number }, total: number): string {
  const cell = (labelZh: string, labelEn: string, value: number, strong: boolean): string =>
    `<div style="flex:1;border:3px solid ${meta.accent};border-radius:14px;padding:26px 20px;text-align:center;` +
    `${strong ? `background:${meta.accent};color:#ffffff;` : "background:#ffffff;"}">` +
    `<div style="font-size:29px;font-weight:700;">${labelZh}</div>` +
    `<div style="font-size:24px;${strong ? "opacity:0.85;" : "color:#8a9298;"}">${labelEn}</div>` +
    `<div style="font-size:${strong ? 54 : 46}px;font-weight:800;margin-top:10px;font-variant-numeric:tabular-nums;">` +
    `${escapeHtml(fmtMeta(meta, value))}</div></div>`;
  const connector = (ch: string): string =>
    `<div style="flex:none;align-self:center;font-size:56px;font-weight:300;color:#8a9298;">${ch}</div>`;
  return (
    `<div style="display:flex;gap:22px;margin-top:46px;align-items:stretch;">` +
    cell("電力費用", "Energy Charge", f.energy, false) +
    connector("+") +
    cell("燃料調整費", "Fuel Cost Adjustment", f.fuel, false) +
    connector("+") +
    cell("其他收費", "Other Charges", f.others, false) +
    connector("=") +
    cell("應繳總數", "Total Due", total, true) +
    `</div>`
  );
}

/** 平均每日用電量柱图：柱高 = 各期度/日，柱顶标数值（vm.bars 驱动） */
function hkDailyBars(vm: BillViewModel, meta: TemplateMeta): string {
  if (vm.bars.length === 0) return "";
  const max = Math.max(...vm.bars.map((b) => b.value), 1);
  const bars = vm.bars
    .map((bar) => {
      const height = Math.max(18, Math.round((bar.value / max) * 300));
      return (
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:390px;">` +
        `<div style="font-size:22px;color:#5a656c;margin-bottom:6px;">${bar.value.toFixed(1)}</div>` +
        `<div style="width:74%;height:${height}px;background:${meta.accent};border-radius:8px 8px 0 0;"></div>` +
        `<div style="font-size:22px;color:#8a9298;margin-top:10px;">${escapeHtml(bar.label)}</div></div>`
      );
    })
    .join("");
  return (
    `<div style="margin-top:56px;border:1px solid #b9b3a6;border-radius:14px;padding:36px 44px;">` +
    `<div style="font-size:32px;font-weight:700;">${escapeHtml(vm.barTitle)}</div>` +
    `<div style="font-size:26px;color:#8a9298;margin:2px 0 20px;">Average daily consumption · 單位：${escapeHtml(vm.barUnit)}</div>` +
    `<div style="display:flex;gap:12px;align-items:flex-end;">${bars}</div></div>`
  );
}

/**
 * 香港流派外壳：双语（EN 上 / 繁中下）标签、密集边框表格、
 * 底部缴款回条（商户编号 + Code128 条码 + 类 FPS 伪 QR + 缴款限期）。
 * extras 可加：顶部账户条码、费用公式块、按金行、日均用量柱图、存根 OCR 行。
 * meta.locale 应设 "en-HK"。
 */
export function renderHkShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
  extras: HkShellExtras,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:32px;color:#1b2327;line-height:1.55;">${escapeHtml(line)}</div>`)
    .join("");
  const meterRows = vm.meterRows
    .map(
      (row) =>
        `<tr style="font-size:29px;">` +
        `<td style="padding:14px 10px;border:1px solid #b9b3a6;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:14px 10px;border:1px solid #b9b3a6;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.previous)}</td>` +
        `<td style="padding:14px 10px;border:1px solid #b9b3a6;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.current)}</td>` +
        `<td style="padding:14px 10px;border:1px solid #b9b3a6;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(row.usage)}</td></tr>`,
    )
    .join("");
  const meterSection =
    vm.meterRows.length === 0
      ? ""
      : `<table style="width:100%;border-collapse:collapse;margin-top:16px;">` +
        `<tr style="font-size:25px;color:#5a656c;">` +
        `<th style="text-align:left;padding:10px;border:1px solid #b9b3a6;background:#f2efe6;">水錶 Meter</th>` +
        `<th style="text-align:right;padding:10px;border:1px solid #b9b3a6;background:#f2efe6;">上期讀數 Previous</th>` +
        `<th style="text-align:right;padding:10px;border:1px solid #b9b3a6;background:#f2efe6;">本期讀數 Current</th>` +
        `<th style="text-align:right;padding:10px;border:1px solid #b9b3a6;background:#f2efe6;">用量 Usage</th></tr>` +
        meterRows +
        `</table>`;
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<tr style="font-size:30px;">` +
        `<td style="padding:15px 10px;border:1px solid #b9b3a6;color:#333c42;">${escapeHtml(line.label)}</td>` +
        `<td style="padding:15px 10px;border:1px solid #b9b3a6;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, line.amount))}</td></tr>`,
    )
    .join("");
  const barcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 110 });
  const qr = pseudoQrSvg(vm.qrSeed, { module: 8 });
  const kindHk = vm.kind === "water" ? "水費單" : vm.kind === "power" ? "電費單" : "賬單";
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:${HK_FONT};">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:24px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:110px 130px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:36px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:62px;font-weight:800;">${escapeHtml(vm.utilityNameZh)}</div>` +
    `<div style="font-size:40px;color:#5a656c;margin-top:2px;">${escapeHtml(vm.utilityName)}</div></div></div>` +
    `<div style="text-align:right;font-size:30px;color:#333c42;line-height:1.7;">` +
    `<div style="font-size:46px;font-weight:800;color:${meta.accent};">${kindHk} ${vm.kind.toUpperCase()} BILL</div>` +
    `<div>賬單號碼 Bill No. <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>客戶編號 Account No. <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>發單日期 Issue date ${escapeHtml(vm.billDate)}</div></div></div>` +
    (extras.accountBarcode === true
      ? (() => {
          const acct = hkAccountCode(vm);
          const acctBarcode = code128Svg(acct.payload, { moduleWidth: 3, height: 100 });
          return (
            `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;` +
            `border:1px solid #b9b3a6;border-radius:12px;padding:22px 30px;">` +
            `<div><div style="font-size:28px;color:#8a9298;">客戶號碼 Account number</div>` +
            `<div style="font-size:44px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:3px;">${escapeHtml(acct.formatted)}</div></div>` +
            `<div style="text-align:center;">${acctBarcode}` +
            `<div style="font-size:24px;letter-spacing:5px;color:#333c42;margin-top:6px;">${escapeHtml(acct.payload)}</div></div>` +
            `<div style="text-align:right;font-size:28px;color:#5a656c;line-height:1.6;">` +
            `<div>繳款限期 Payment due date</div>` +
            `<div style="font-size:36px;font-weight:700;color:${meta.accent};">${escapeHtml(vm.dueDate)}</div></div></div>`
          );
        })()
      : "") +
    `<div style="display:flex;justify-content:space-between;margin-top:50px;">` +
    `<div><div style="font-size:28px;color:#8a9298;margin-bottom:8px;">客戶地址 Customer address</div>` +
    `<div style="font-size:44px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:32px;color:#333c42;line-height:1.75;">` +
    `<div style="font-size:28px;color:#8a9298;">賬期 Billing period</div>` +
    `<div>${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}</div>` +
    `<div style="color:#5a656c;">${vm.periodDays} 天 days · ${escapeHtml(vm.usageSummary)}</div></div></div>` +
    `<div style="margin-top:44px;">${meterSection}${bodyHtml}</div>` +
    (extras.formula !== undefined ? hkFormulaBlock(meta, extras.formula, vm.total) : "") +
    (extras.deposit !== undefined
      ? `<div style="margin-top:26px;font-size:30px;color:#5a656c;">` +
        `客戶按金 Deposit on account：<b style="color:#1b2327;">${escapeHtml(fmtMeta(meta, extras.deposit))}</b>` +
        `　·　按金不計入本期應繳總數 Deposit is not part of this bill's total.</div>`
      : "") +
    `<div style="margin-top:50px;"><div style="font-size:30px;letter-spacing:2px;color:${meta.accent};` +
    `text-transform:uppercase;margin-bottom:10px;font-weight:700;">收費明細 Charge details</div>` +
    `<table style="width:100%;border-collapse:collapse;">${chargeRows}` +
    `<tr style="font-size:36px;font-weight:800;">` +
    `<td style="padding:18px 10px;border:1px solid #b9b3a6;background:#f2efe6;">應繳總額 Total amount due</td>` +
    `<td style="padding:18px 10px;border:1px solid #b9b3a6;background:#f2efe6;text-align:right;` +
    `font-variant-numeric:tabular-nums;color:${meta.accent};">${escapeHtml(fmtMeta(meta, vm.total))}</td></tr></table></div>` +
    hkDailyBars(vm, meta) +
    `<div style="margin-top:auto;">` +
    `<div style="padding-top:36px;font-size:25px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虛構示例文件，僅供版式學習，非真實賬單。</div>` +
    `<div style="margin-top:30px;border-top:4px dashed #9aa29b;position:relative;padding-top:14px;">` +
    `<span style="position:absolute;left:-26px;top:-28px;font-size:40px;color:#9aa29b;">✂</span>` +
    `<div style="text-align:center;font-size:28px;letter-spacing:4px;color:#5a656c;">繳款回條 PAYMENT SLIP</div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;">` +
    `<div style="font-size:30px;color:#333c42;line-height:1.85;">` +
    `<div>繳費靈商戶編號 Merchant code <b style="font-family:'Courier New',monospace;font-size:36px;">${escapeHtml(extras.merchantNo)}</b></div>` +
    `<div>客戶編號 Account No. <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>繳款限期 Pay by <b style="color:${meta.accent};">${escapeHtml(vm.dueDate)}</b></div>` +
    `<div style="margin-top:8px;">${barcode}</div>` +
    `<div style="font-size:26px;letter-spacing:5px;margin-top:6px;">${escapeHtml(vm.barcodePayload)}</div></div>` +
    `<div style="text-align:center;">` +
    `<div style="width:430px;height:100px;border:4px solid #1b2327;border-radius:8px;display:flex;align-items:center;` +
    `justify-content:center;font-size:44px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, vm.total))}</div>` +
    `<div style="font-size:26px;color:#8a9298;margin-top:8px;">應繳總額 Amount due</div></div>` +
    `<div style="text-align:center;"><div>${qr}</div>` +
    `<div style="font-size:25px;color:#8a9298;margin-top:8px;">轉數快掃碼繳費 FPS (decorative)</div></div>` +
    `</div>` +
    (extras.stubOcr === true
      ? `<div style="margin-top:22px;font-family:'Courier New',monospace;font-size:32px;letter-spacing:3px;color:#333c42;">` +
        `${escapeHtml(hkOcrLine(vm))}</div>`
      : "") +
    `</div>` +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 澳洲流派（AU-style：NMI/MIRN + GST 内含 + BPAY） ================= */

export interface AuPaymentInfo {
  readonly billerCode: string;
  readonly ref: string;
  /** 表号行，如 "NMI 3012345678" / "MIRN 5320012345" */
  readonly meterIdLabel: string;
}

/** BPAY 付款块：Biller Code + Ref 两组数字（标志性） */
function bpayBlock(meta: TemplateMeta, pay: AuPaymentInfo): string {
  return (
    `<div style="margin-top:70px;display:flex;gap:60px;align-items:center;border:3px solid #d8d4ca;` +
    `border-radius:16px;padding:34px 44px;">` +
    `<div style="background:${meta.accent};color:#ffffff;font-weight:800;font-size:40px;letter-spacing:2px;` +
    `border-radius:12px;padding:18px 30px;flex:none;">BPAY</div>` +
    `<div style="font-size:32px;color:#333c42;line-height:1.8;">` +
    `<div>Biller Code: <b style="font-family:'Courier New',monospace;font-size:38px;">${escapeHtml(pay.billerCode)}</b></div>` +
    `<div>Ref: <b style="font-family:'Courier New',monospace;font-size:38px;">${escapeHtml(pay.ref)}</b></div></div>` +
    `<div style="margin-left:auto;font-size:27px;color:#8a9298;max-width:620px;line-height:1.7;">` +
    `Pay via internet or phone banking. 通过网银或电话银行付款。其它付款方式见官网（fictional）。</div></div>`
  );
}

/**
 * 澳洲流派外壳：表号行（NMI/MIRN）、supply charge（c/day）+ usage（c/unit）、
 * "Total includes GST 10%" 内含行、用量柱状图、BPAY 付款块。
 * 金额按 ex-GST 拆分：charges/subtotal 为税前，taxLabel 注明 included。
 */
export function renderAuShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
  pay: AuPaymentInfo,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:34px;color:#333c42;line-height:1.55;">${escapeHtml(line)}</div>`)
    .join("");
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<tr><td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:35px;color:#333c42;">${escapeHtml(line.label)}</td>` +
        `<td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:35px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, line.amount))}</td></tr>`,
    )
    .join("");
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:30px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:115px 135px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:40px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:64px;font-weight:800;letter-spacing:-1px;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:36px;color:#5a656c;margin-top:4px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="background:${meta.accent};color:#ffffff;border-radius:16px;padding:28px 44px;text-align:center;flex:none;">` +
    `<div style="font-size:28px;letter-spacing:4px;opacity:0.85;text-transform:uppercase;">Total due</div>` +
    `<div style="font-size:78px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15;">${escapeHtml(fmtMeta(meta, vm.total))}</div>` +
    `<div style="font-size:30px;margin-top:4px;">Due ${escapeHtml(vm.dueDate)}</div></div></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:52px;">` +
    `<div><div style="font-size:30px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:10px;">Supply address · 供电地址</div>` +
    `<div style="font-size:48px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:32px;color:#333c42;line-height:1.8;">` +
    `<div>Account <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Invoice <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div style="font-family:'Courier New',monospace;">${escapeHtml(pay.meterIdLabel)}</div>` +
    `<div style="color:#5a656c;">${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)} · ${escapeHtml(vm.usageSummary)}</div></div></div>` +
    `<div style="margin-top:40px;">${meterTableHtml(vm)}${bodyHtml}</div>` +
    barsHtml(vm, meta, 300) +
    `<div style="margin-top:60px;"><div style="font-size:32px;letter-spacing:3px;color:${meta.accent};` +
    `text-transform:uppercase;margin-bottom:10px;font-weight:700;">Your charges · 费用明细（excl. GST）</div>` +
    `<table style="width:100%;border-collapse:collapse;">${chargeRows}` +
    `<tr><td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:35px;color:#333c42;">${escapeHtml(vm.taxLabel)}</td>` +
    `<td style="padding:20px 0;border-bottom:2px solid #e7e4dc;font-size:35px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, vm.tax))}</td></tr>` +
    `<tr><td style="padding:24px 0;font-size:40px;font-weight:800;">Total (includes GST)</td>` +
    `<td style="padding:24px 0;font-size:44px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;color:${meta.accent};">${escapeHtml(fmtMeta(meta, vm.total))}</td></tr>` +
    `</table></div>` +
    `<div style="margin-top:auto;">` +
    bpayBlock(meta, pay) +
    `<div style="margin-top:44px;padding-top:36px;border-top:2px solid #e7e4dc;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

/* ================= 分区计价外壳（新加坡三合一 / 英国 dual fuel 共用骨架） ================= */

export interface SectionShellFlavor {
  /** "sg" = GIRO 付款提示；"uk" = Direct Debit 提示 */
  readonly flavor: "sg" | "uk";
  /** 头部副行（如英国 tariff name） */
  readonly tariffLine?: string;
}

/**
 * 分区计价外壳：vm.sections 逐段渲染（段标题栏 + 明细行 + 段小计），
 * 再汇总 subtotal → tax → total。SG 与 UK 的视觉差异经 flavor/accent 体现。
 */
export function renderSectionShell(
  vm: BillViewModel,
  meta: TemplateMeta,
  bodyHtml: string,
  opts: RenderOptions,
  flavor: SectionShellFlavor,
): string {
  const addressHtml = vm.addressLines
    .map((line) => `<div style="font-size:33px;color:#333c42;line-height:1.55;">${escapeHtml(line)}</div>`)
    .join("");
  const sections = (vm.sections ?? [])
    .map((section) => {
      const rows = section.lines
        .map(
          (line) =>
            `<div style="display:flex;justify-content:space-between;padding:15px 0;border-bottom:1px solid #e7e4dc;">` +
            `<span style="font-size:32px;color:#333c42;">${escapeHtml(line.label)}</span>` +
            `<span style="font-size:32px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, line.amount))}</span></div>`,
        )
        .join("");
      return (
        `<div style="margin-top:44px;">` +
        `<div style="display:flex;justify-content:space-between;align-items:baseline;background:#f2f0e9;` +
        `border-left:10px solid ${meta.accent};padding:18px 26px;border-radius:0 12px 12px 0;">` +
        `<span style="font-size:36px;font-weight:700;">${escapeHtml(section.title)}</span>` +
        (section.subtitle !== undefined
          ? `<span style="font-size:27px;color:#5a656c;font-family:'Courier New',monospace;">${escapeHtml(section.subtitle)}</span>`
          : "") +
        `</div>` +
        `<div style="padding:6px 26px 0;">${rows}` +
        `<div style="display:flex;justify-content:space-between;padding:16px 0;">` +
        `<span style="font-size:32px;font-weight:600;color:#5a656c;">Section total · 小计</span>` +
        `<span style="font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, section.sectionTotal))}</span></div></div></div>`
      );
    })
    .join("");
  const payment =
    flavor.flavor === "sg"
      ? `<div style="margin-top:56px;border:3px solid ${meta.accent};border-radius:14px;padding:28px 36px;` +
        `font-size:32px;color:#333c42;line-height:1.7;">Payment by <b>GIRO</b> — the amount will be deducted from your bank ` +
        `account on ${escapeHtml(vm.dueDate)}. No action is required. 已通过 GIRO 自动转账，无需操作。</div>`
      : `<div style="margin-top:56px;border:3px solid ${meta.accent};border-radius:14px;padding:28px 36px;` +
        `font-size:32px;color:#333c42;line-height:1.7;">You pay by <b>Direct Debit</b> — we will collect ` +
        `<b>${escapeHtml(fmtMeta(meta, vm.total))}</b> on or around ${escapeHtml(vm.dueDate)}. 已通过直接扣款支付，无需操作。</div>`;
  const tariff =
    flavor.tariffLine !== undefined
      ? `<div style="font-size:30px;color:#5a656c;margin-top:10px;">${escapeHtml(flavor.tariffLine)}</div>`
      : "";
  const notes =
    vm.notes.length === 0
      ? ""
      : `<ul style="margin:52px 0 0;padding-left:44px;font-size:28px;color:#8a9298;line-height:1.75;">` +
        vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("") +
        `</ul>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:26px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:115px 135px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:38px;align-items:center;">${logoBlock(meta)}` +
    `<div><div style="font-size:62px;font-weight:800;letter-spacing:-1px;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:35px;color:#5a656c;margin-top:4px;">${escapeHtml(vm.utilityNameZh)} · ${escapeHtml(vm.tagline)}</div>` +
    `${tariff}</div></div>` +
    `<div style="text-align:right;font-size:31px;color:#333c42;line-height:1.75;">` +
    `<div>Account <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Invoice <b>${escapeHtml(vm.invoiceNumber)}</b></div>` +
    `<div>Bill date ${escapeHtml(vm.billDate)}</div>` +
    `<div>Due <b>${escapeHtml(vm.dueDate)}</b></div></div></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:46px;">` +
    `<div><div style="font-size:29px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:8px;">Customer · 客户</div>` +
    `<div style="font-size:46px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:31px;color:#333c42;line-height:1.75;">` +
    `<div style="font-size:29px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;">Billing period · 账期</div>` +
    `<div>${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}</div>` +
    `<div style="color:#5a656c;">${escapeHtml(vm.usageSummary)}</div></div></div>` +
    `<div style="margin-top:36px;">${meterTableHtml(vm)}${bodyHtml}</div>` +
    sections +
    `<div style="margin-top:48px;border-top:3px solid #1b2327;padding-top:10px;">` +
    `<div style="display:flex;justify-content:space-between;padding:14px 0;">` +
    `<span style="font-size:34px;color:#333c42;">Charges before tax · 税前小计</span>` +
    `<span style="font-size:34px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, vm.subtotal))}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e7e4dc;">` +
    `<span style="font-size:34px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:34px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, vm.tax))}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:20px 0;align-items:baseline;">` +
    `<span style="font-size:40px;font-weight:800;">Total for this bill · 本期总额</span>` +
    `<span style="font-size:56px;font-weight:800;color:${meta.accent};font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, vm.total))}</span></div></div>` +
    payment +
    notes +
    `<div style="margin-top:auto;padding-top:36px;border-top:2px solid #e7e4dc;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}
