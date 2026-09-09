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

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 地址行排版：streetNumber+streetName 合并为一行；city/state/zip 合并为 "City, ST 12345"；其余字段各自成行 */
export function formatAddressLines(address: Record<string, string>): string[] {
  const values = Object.entries(address).filter(([, v]) => v.trim().length > 0);
  const lines: string[] = [];
  let pendingNumber: string | null = null;
  const mergedCityStateZip = new Set<string>();
  for (const [key, value] of values) {
    if (key === "streetNumber") {
      pendingNumber = value.trim();
      continue;
    }
    if (key === "streetName" && pendingNumber !== null) {
      lines.push(`${pendingNumber} ${value.trim()}`);
      pendingNumber = null;
      continue;
    }
    if (key === "city") {
      const state = address["state"]?.trim();
      const zip = address["zip"]?.trim();
      if (state !== undefined && state.length > 0) {
        lines.push(
          `${pendingNumber !== null ? `${pendingNumber} ` : ""}${value.trim()}, ${state}${zip !== undefined && zip.length > 0 ? ` ${zip}` : ""}`,
        );
        pendingNumber = null;
        mergedCityStateZip.add("state");
        mergedCityStateZip.add("zip");
        continue;
      }
    }
    if (mergedCityStateZip.has(key)) continue;
    if (pendingNumber !== null) {
      lines.push(pendingNumber);
      pendingNumber = null;
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
