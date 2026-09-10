/**
 * 模板公共层：日期 / 金额格式化、A4 画布尺寸（2481×3509 = A4@300DPI）、
 * 账单公共派生（单号 / 户号 / 账期）。各账单版式由模板文件自带自包含 HTML；
 * 地区 / 货币为真实国家地区，机构 / 单号 / 金额均为虚构。
 */

import { fnv1a } from "../hash";
import type { BillInput, BillKind, RegionId } from "../model";

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
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
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
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function isoToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 货币格式化（en-US locale），如 "$1,234.56" / "HK$1,234.56" */
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
 * 美式 "City, ST 12345"；加拿大 "City, PR A1A 1A1"；澳洲 "Suburb NSW 2026"；
 * 德式 "10115 Berlin"；其余字段各自成行。
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
  /** 单号 / 条码前缀，如 "ABG" */
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
  const serial = `${10000 + ((h >>> 7) % 89999)}`;
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
