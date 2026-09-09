/**
 * 模板公共层：日期 / 金额格式化、A4 画布外壳（2481×3509 = A4@300DPI）、
 * 页眉 logo 区、金额汇总框、付款区（Code128 + 伪 QR）、水印层。
 * 所有机构 / 地名 / 货币均为虚构。渲染输出完全自包含（内联 CSS/SVG，系统字体栈）。
 */

import { code128Svg } from "../barcode";
import { fnv1a } from "../hash";
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

/** 地址行排版：streetNumber + streetName 合并为一行，其余字段各自成行 */
export function formatAddressLines(address: Record<string, string>): string[] {
  const values = Object.entries(address).filter(([, v]) => v.trim().length > 0);
  const lines: string[] = [];
  let pendingNumber: string | null = null;
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
  const meterSection =
    vm.meterRows.length === 0
      ? ""
      : `<table style="width:100%;border-collapse:collapse;margin-top:16px;">` +
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
        `</table>`;
  const barSection =
    vm.bars.length === 0
      ? ""
      : (() => {
          const max = Math.max(...vm.bars.map((b) => b.value), 1);
          const bars = vm.bars
            .map((bar) => {
              const height = Math.max(24, Math.round((bar.value / max) * 380));
              return (
                `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:460px;">` +
                `<div style="font-size:28px;color:#5a656c;margin-bottom:8px;">${formatInt(bar.value)}</div>` +
                `<div style="width:78%;height:${height}px;background:${meta.accent};border-radius:12px 12px 0 0;"></div>` +
                `<div style="font-size:28px;color:#8a9298;margin-top:12px;">${escapeHtml(bar.label)}</div></div>`
              );
            })
            .join("");
          return (
            `<div style="margin-top:70px;background:#f7f6f1;border-radius:22px;padding:48px 54px;">` +
            `<div style="font-size:34px;letter-spacing:3px;color:#8a9298;text-transform:uppercase;margin-bottom:26px;">` +
            `${escapeHtml(vm.barTitle)} · 近 6 期用量（${escapeHtml(vm.barUnit)}）</div>` +
            `<div style="display:flex;gap:26px;align-items:flex-end;">${bars}</div></div>`
          );
        })();
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
