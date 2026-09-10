/**
 * 澳洲账单版式研习（两页版）：
 * - auAglGas             澳式燃气单版式：浅蓝圆角面板（Your details / Need help?）、
 *   顶部 Gas 药丸、问候语 + supply address、Help and support / Amount due 双卡片、
 *   底部浅灰 "How to pay" 区（BPAY Biller Code/Ref + Mail + 邮局缴费 + 大条码）
 * - auEnergyAustraliaPower 澳式电费单版式：深绿标题栏（Need to get in touch? / Your bill）、
 *   "Your electricity account" 边框表、绿色 "save money" 横幅、
 *   底部 "payment options" 区（Billpay code + BPAY + Office use only + OCR 行）
 * 机构 / 地名 / 号码均为虚构；货币为真实 AUD（澳元）。GST 10% 内含（金额按 ex-GST 入账）。
 * 地址字段：streetNo / streetName / suburb / state(2–3 字母) / postcode(4 位)（与 australia 一致）。
 */

import { code128Svg } from "../barcode";
import { fnv1a, mulberry32 } from "../hash";
import type { BillInput, BillTemplate, BillViewModel, RenderOptions } from "../model";
import {
  buildBase,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  escapeHtml,
  fmtMeta,
  formatInt,
  round2,
  type TemplateMeta,
} from "./common";

const AU_FIELDS = [
  {
    kind: "text",
    key: "streetNo",
    label: "门牌号",
    placeholder: "14",
    required: true,
    maxLength: 6,
    pattern: /^\d{1,5}$/,
  },
  {
    kind: "text",
    key: "streetName",
    label: "街道名",
    placeholder: "Banksia Street",
    required: true,
    maxLength: 50,
  },
  {
    kind: "text",
    key: "suburb",
    label: "Suburb",
    placeholder: "Bondi",
    required: true,
    maxLength: 40,
  },
  {
    kind: "text",
    key: "state",
    label: "州（2–3 位缩写）",
    placeholder: "NSW",
    required: true,
    maxLength: 3,
    pattern: /^[A-Z]{2,3}$/,
  },
  {
    kind: "text",
    key: "postcode",
    label: "邮编",
    placeholder: "2026",
    required: true,
    maxLength: 4,
    pattern: /^\d{4}$/,
  },
] as const;

const AGL_GAS_META: TemplateMeta = {
  docType: "au_agl_gas",
  regionId: "australia",
  kind: "gas",
  utilityName: "Bluegum Gas",
  utilityNameZh: "蓝桉燃气",
  tagline: "Fictional Australian gas retailer",
  currency: "AUD",
  prefix: "BLG",
  periodDays: 90,
  accent: "#0072bc",
  locale: "en-AU",
};

const EA_POWER_META: TemplateMeta = {
  docType: "au_energyau_power",
  regionId: "australia",
  kind: "power",
  utilityName: "Wattle Energy",
  utilityNameZh: "金合欢能源",
  tagline: "Fictional Australian electricity retailer",
  currency: "AUD",
  prefix: "WTE",
  periodDays: 90,
  accent: "#0a7a3d",
  locale: "en-AU",
};

/** 水印层（与 common.ts 的私有实现一致，本文件自定义外壳需本地副本） */
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

function fictionalFooter(vm: BillViewModel): string {
  return (
    `<div style="margin-top:24px;padding-top:22px;border-top:2px solid #e3e1d9;font-size:25px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>`
  );
}

function digits(rng: () => number, n: number): string {
  return Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
}

/** 渲染期确定性伪随机（只依赖 vm，不改 compute 契约） */
function seededDigits(seed: string, n: number): string {
  return digits(mulberry32(fnv1a(seed)), n);
}

/** AU 计费拆分：展示价为含税（GST incl.）费率，金额按 ex-GST 入账，tax = subtotal × 10% */
function auSplit(inclAmount: number): number {
  return round2(inclAmount / 1.1);
}

/** 户号分组显示：10 位 → "2912 3606 13" 风格 */
function groupAccount(acct: string): string {
  return `${acct.slice(0, 4)} ${acct.slice(4, 8)} ${acct.slice(8)}`;
}

/** BPAY 参考号：20 位数字，4 位一组（由单号 hash 确定性派生，虚构） */
function bpayRefFormatted(vm: BillViewModel): { raw: string; grouped: string } {
  const raw = `${vm.accountNumber}${seededDigits(`bpayref::${vm.invoiceNumber}`, 10)}`;
  const groups = raw.match(/.{1,4}/g) ?? [raw];
  return { raw, grouped: groups.join(" ") };
}

function bpayBillerCode(vm: BillViewModel): string {
  return seededDigits(`bpay::${vm.invoiceNumber}`, 5);
}

/** meterRows[0].label = "MIRN 53xxxxxxxx · meter read (MJ)" → "MIRN 53xxxxxxxx" */
function meterIdLabel(vm: BillViewModel): string {
  return vm.meterRows[0]?.label.split(" ·")[0] ?? "";
}

/* ================= 图标（内联 SVG，装饰性） ================= */

function iconSvg(path: string, color: string, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
  );
}

const ICON_PERSON = `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/>`;
const ICON_HEADSET = `<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/>`;
const ICON_PHONE = `<path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>`;
const ICON_DOC = `<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7"/>`;
const ICON_WALLET = `<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>`;
const ICON_MAIL = `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`;
const ICON_CARD = `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>`;
const ICON_FLAME = `<path d="M12 3c2.5 3.2 6 5.6 6 9.5a6 6 0 0 1-12 0C6 8.6 9.5 6.8 12 3Z"/>`;

/* ================= AGL 版式（燃气，浅蓝圆角面板流） ================= */

const AGL_PALE = "#e9f4fc";
const AGL_PALE_BORDER = "#d3e9f8";

/** 扇形光芒 logo（虚构，蓝绿色系）+ 小写字标 */
function aglStyleLogo(vm: BillViewModel): string {
  const rays: ReadonlyArray<readonly [number, string, number]> = [
    [-58, "#003c71", 46],
    [-30, "#0072bc", 56],
    [0, "#00a9e0", 62],
    [30, "#00b5ad", 56],
    [58, "#6ec6e8", 46],
  ];
  const rayRects = rays
    .map(
      ([angle, color, len]) =>
        `<rect x="-7" y="${-len - 12}" width="14" height="${len}" rx="7" fill="${color}" transform="rotate(${angle})"/>`,
    )
    .join("");
  return (
    `<div style="display:flex;align-items:flex-end;gap:26px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 96" width="150" height="120">` +
    `<g transform="translate(60,88)">${rayRects}</g></svg>` +
    `<div style="font-size:88px;font-weight:800;letter-spacing:-3px;color:#0a3d62;line-height:1;">` +
    `${escapeHtml(vm.utilityName.toLowerCase().replace(" gas", ""))}<span style="font-size:34px;letter-spacing:6px;color:${AGL_GAS_META.accent};vertical-align:top;">&#160;GAS</span></div>` +
    `</div>`
  );
}

/** 浅蓝圆角标题条 + 面 body 的小面板 */
function aglPanel(icon: string, title: string, body: string, marginTop: string): string {
  return (
    `<div style="margin-top:${marginTop};border-radius:22px;overflow:hidden;border:2px solid ${AGL_PALE_BORDER};">` +
    `<div style="background:${AGL_PALE};padding:20px 34px;display:flex;align-items:center;gap:18px;">` +
    `${iconSvg(icon, AGL_GAS_META.accent, 40)}` +
    `<span style="font-size:38px;font-weight:800;color:${AGL_GAS_META.accent};">${title}</span></div>` +
    `<div style="padding:26px 34px 30px;">${body}</div></div>`
  );
}

function aglDetailRow(label: string, value: string, boldValue = false): string {
  return (
    `<div style="margin-bottom:20px;"><div style="font-size:27px;color:#6b7680;">${label}</div>` +
    `<div style="font-size:36px;color:#1b2327;${boldValue ? "font-weight:700;" : ""}">${value}</div></div>`
  );
}

/** Amount due / Help and support 双卡片（渐变蓝标题） */
function aglCards(vm: BillViewModel): string {
  const header = (icon: string, title: string): string =>
    `<div style="background:linear-gradient(90deg,#0a5fa5,#00a9e0);border-radius:20px 20px 0 0;` +
    `padding:18px 30px;display:flex;align-items:center;gap:16px;">${iconSvg(icon, "#ffffff", 36)}` +
    `<span style="font-size:36px;font-weight:800;color:#ffffff;">${title}</span></div>`;
  return (
    `<div style="display:flex;gap:60px;margin-top:44px;">` +
    `<div style="flex:1;border-radius:20px;border:2px solid ${AGL_PALE_BORDER};overflow:hidden;align-self:flex-start;">` +
    header(ICON_HEADSET, "Help and support") +
    `<div style="padding:30px 34px 34px;"><div style="font-size:36px;font-weight:800;">We're here for you</div>` +
    `<div style="font-size:30px;color:#3c464d;margin-top:16px;line-height:1.6;">Questions, feedback or just need a ` +
    `bit of help? 有疑问或需要帮助？</div>` +
    `<div style="font-size:30px;color:#3c464d;margin-top:18px;line-height:1.6;">Message us in the ` +
    `<b>${escapeHtml(vm.utilityName)}</b> app or visit <b>${escapeHtml(vm.utilityName.toLowerCase().replaceAll(" ", ""))}.example/help</b> (fictional).</div></div></div>` +
    `<div style="width:660px;flex:none;border-radius:20px;border:2px solid ${AGL_PALE_BORDER};overflow:hidden;">` +
    header(ICON_DOC, "Amount due") +
    `<div style="padding:30px 38px 36px;">` +
    `<div style="font-size:88px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;">` +
    `${escapeHtml(fmtMeta(AGL_GAS_META, vm.total))}</div>` +
    `<div style="font-size:26px;color:#6b7680;margin-top:10px;">Includes GST of ${escapeHtml(fmtMeta(AGL_GAS_META, vm.tax))}</div>` +
    `<div style="border-top:2px solid #e3eef4;margin-top:26px;padding-top:22px;">` +
    `<div style="font-size:28px;color:#6b7680;">Due date</div>` +
    `<div style="font-size:62px;font-weight:800;margin-top:6px;">${escapeHtml(vm.dueDate)}</div></div>` +
    `</div></div></div>`
  );
}

/** 费用小表（AGL 第 2 页风格压缩版：supply / usage / GST included） */
function aglChargesStrip(vm: BillViewModel): string {
  const row = (label: string, value: string, strong = false): string =>
    `<div style="display:flex;justify-content:space-between;padding:13px 0;` +
    `${strong ? "border-top:2px solid #b9d9ee;margin-top:6px;padding-top:16px;" : "border-bottom:1px solid #dcebf5;"}">` +
    `<span style="font-size:${strong ? 32 : 29}px;${strong ? "font-weight:800;" : "color:#3c464d;"}">${label}</span>` +
    `<span style="font-size:${strong ? 34 : 29}px;font-weight:${strong ? 800 : 500};font-variant-numeric:tabular-nums;">${value}</span></div>`;
  const rows = vm.charges
    .map((c) => row(escapeHtml(c.label), escapeHtml(fmtMeta(AGL_GAS_META, c.amount))))
    .join("");
  return (
    `<div style="margin-top:38px;border:2px solid ${AGL_PALE_BORDER};border-radius:20px;padding:26px 36px;background:#fbfdfe;">` +
    `<div style="font-size:30px;font-weight:800;color:${AGL_GAS_META.accent};margin-bottom:10px;">` +
    `Your gas charges this period · 本期燃气费用（rates GST incl., billed ex-GST）</div>` +
    rows +
    row("Subtotal (excl. GST)", escapeHtml(fmtMeta(AGL_GAS_META, vm.subtotal))) +
    row(escapeHtml(vm.taxLabel), escapeHtml(fmtMeta(AGL_GAS_META, vm.tax))) +
    row("Total this bill (incl. GST)", escapeHtml(fmtMeta(AGL_GAS_META, vm.total)), true) +
    `<div style="font-size:25px;color:#8a9298;margin-top:12px;">` +
    `Meter ${escapeHtml(meterIdLabel(vm))} · ${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)} · ${escapeHtml(vm.usageSummary)}</div></div>`
  );
}

/** BPAY 标志块（蓝底白字，虚构 biller） */
function bpayBadge(color: string, size: number): string {
  return (
    `<div style="width:${size}px;height:${size}px;background:${color};border-radius:8px;flex:none;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;color:#ffffff;">` +
    `<span style="font-size:${Math.round(size * 0.42)}px;font-weight:900;line-height:1;">B</span>` +
    `<span style="font-size:${Math.round(size * 0.2)}px;font-weight:800;letter-spacing:1px;">PAY</span></div>`
  );
}

/** 底部浅灰 "How to pay" 区：三栏（Direct Debit/卡/钱包 · BPAY/分期 · Mail/邮局 + 大条码） */
function aglHowToPay(vm: BillViewModel): string {
  const ref = bpayRefFormatted(vm);
  const biller = bpayBillerCode(vm);
  const billpayCode = seededDigits(`billpay::${vm.invoiceNumber}`, 4);
  const crn = `${seededDigits(`crn::${vm.invoiceNumber}`, 3)}-${seededDigits(`crn2::${vm.invoiceNumber}`, 3)}-${seededDigits(`crn3::${vm.invoiceNumber}`, 3)}-F`;
  const topRef = `${seededDigits(`topref::${vm.invoiceNumber}`, 14)}/${seededDigits(`topref2::${vm.invoiceNumber}`, 7)}E-${seededDigits(`topref3::${vm.invoiceNumber}`, 6)} S-${seededDigits(`topref4::${vm.invoiceNumber}`, 6)} I-${seededDigits(`topref5::${vm.invoiceNumber}`, 6)}`;
  const barcode = code128Svg(ref.raw, { moduleWidth: 4, height: 150 });
  const method = (icon: string, title: string, body: string): string =>
    `<div style="display:flex;gap:22px;margin-top:30px;align-items:flex-start;">` +
    `<div style="flex:none;margin-top:4px;">${iconSvg(icon, "#1b2327", 52)}</div>` +
    `<div><div style="font-size:32px;font-weight:800;">${title}</div>` +
    `<div style="font-size:28px;color:#3c464d;line-height:1.55;margin-top:6px;">${body}</div></div></div>`;
  return (
    `<div style="margin-top:auto;">` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;border-top:4px dashed #c9c6bd;padding-top:18px;">` +
    `<span style="font-size:28px;color:#3c464d;">${escapeHtml(vm.utilityName)} Pty Ltd ABN 42 116 902 385 (fictional)</span>` +
    `<span style="font-size:20px;color:#8a9298;font-family:'Courier New',monospace;">${topRef}</span></div>` +
    `<div style="background:#f4f3f0;border-radius:18px;margin-top:18px;padding:36px 44px 40px;">` +
    `<div style="display:inline-flex;align-items:center;gap:16px;background:${AGL_PALE};border-radius:16px;padding:14px 34px;">` +
    `${iconSvg(ICON_WALLET, AGL_GAS_META.accent, 40)}` +
    `<span style="font-size:38px;font-weight:800;color:${AGL_GAS_META.accent};">How to pay</span></div>` +
    `<div style="display:flex;gap:56px;margin-top:8px;">` +
    `<div style="flex:1;">` +
    method(
      ICON_CARD,
      "Direct Debit",
      `Sign up to Direct Debit at <b>bluegumgas.example/payments</b> or call <b>133 460</b>. 自动扣款（fictional）。`,
    ) +
    method(
      ICON_CARD,
      "Credit or debit card",
      `Online: <b>bluegumgas.example/payments</b><br/>Phone: <b>1300 460 460</b>`,
    ) +
    method(
      ICON_WALLET,
      "Online wallet",
      `To pay via online wallet visit <b>bluegumgas.example/payments</b>`,
    ) +
    `</div>` +
    `<div style="flex:1.05;border-left:2px solid #e0ddd4;padding-left:48px;">` +
    `<div style="font-size:30px;font-weight:800;">Reference number ${escapeHtml(ref.grouped)}</div>` +
    `<div style="display:flex;gap:24px;margin-top:26px;align-items:flex-start;">${bpayBadge("#123a7a", 88)}` +
    `<div><div style="font-size:34px;font-weight:800;">Biller Code: ${biller}</div>` +
    `<div style="font-size:34px;font-weight:800;">Ref: ${escapeHtml(ref.grouped)}</div>` +
    `<div style="font-size:27px;color:#3c464d;margin-top:6px;">Make this payment from your preferred account. 网银付款（BPAY，fictional biller）。</div></div></div>` +
    `<div style="display:flex;gap:24px;margin-top:34px;align-items:flex-start;">${iconSvg(ICON_DOC, "#1b2327", 64)}` +
    `<div><div style="font-size:32px;font-weight:800;">Instalment plan</div>` +
    `<div style="font-size:27px;color:#3c464d;line-height:1.55;margin-top:4px;">For eligible individuals: arrange ` +
    `fortnightly deductions via your services provider (fictional).<br/>${escapeHtml(vm.utilityName)} plan CRN: <b>${crn}</b></div></div></div>` +
    `</div>` +
    `<div style="flex:1;border-left:2px solid #e0ddd4;padding-left:48px;">` +
    `<div style="display:flex;gap:20px;align-items:flex-start;">${iconSvg(ICON_MAIL, "#1b2327", 56)}` +
    `<div><div style="font-size:32px;font-weight:800;">Mail</div>` +
    `<div style="font-size:27px;color:#3c464d;line-height:1.55;margin-top:4px;">Send your cheque along with the reverse of this section to:<br/>` +
    `<b style="color:#1b2327;">${escapeHtml(vm.utilityName)} Pty Ltd<br/>Locked Bag 1200, Sydney NSW 2001</b></div></div></div>` +
    `<div style="display:flex;gap:20px;margin-top:30px;align-items:flex-start;">` +
    `<div style="width:56px;height:56px;background:#1b2327;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;">` +
    `<span style="color:#ffffff;font-size:30px;font-weight:900;">P</span></div>` +
    `<div><div style="font-size:32px;font-weight:800;">Pay at the post office</div>` +
    `<div style="font-size:27px;color:#3c464d;line-height:1.55;margin-top:4px;">In person at any post office. ` +
    `Billpay Code: <b>${billpayCode}</b></div></div></div>` +
    `<div style="margin-top:26px;">${barcode}</div>` +
    `<div style="font-size:26px;letter-spacing:3px;color:#1b2327;margin-top:8px;font-family:'Courier New',monospace;">` +
    `*${billpayCode} ${ref.raw}</div>` +
    `</div></div>` +
    `<div style="font-size:22px;color:#8a9298;line-height:1.6;margin-top:24px;">` +
    `~ A payment processing fee (incl. GST) may apply for card and over-the-counter payments. Any fees applied will be ` +
    `shown on your next bill. 所有号码与费用均为虚构。</div>` +
    `</div></div>`
  );
}

function renderAglGas(vm: BillViewModel, opts: RenderOptions): string {
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:36px;color:#1b2327;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const topBarcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 110 });
  const shortCode = `${vm.accountNumber.slice(0, 3)}/${vm.accountNumber.slice(3, 8)}`;
  const detailsBody =
    aglDetailRow("Issue date", escapeHtml(vm.billDate)) +
    aglDetailRow("Name", escapeHtml(vm.customerName)) +
    aglDetailRow("Account number", escapeHtml(groupAccount(vm.accountNumber)), true) +
    aglDetailRow(
      "Meter Identification Reference Number (MIRN)",
      escapeHtml(meterIdLabel(vm).replace("MIRN ", "")),
    ) +
    `<div style="font-size:27px;color:#6b7680;">Tax Invoice · 税务发票（fictional）</div>`;
  const helpBody =
    `<div style="font-size:28px;color:#3c464d;line-height:1.7;">` +
    `<div>Support, enquiries or complaints</div><div><b>bluegumgas.example/help or 133 460</b></div>` +
    `<div style="margin-top:14px;">Faults or emergencies</div><div><b>GasNet Services on 136 460</b> (fictional)</div>` +
    `<div style="margin-top:14px;">Energy and Water Ombudsman</div><div><b>1800 460 460</b> (fictional)</div></div>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:90px 110px 70px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:center;">` +
    aglStyleLogo(vm) +
    `<div style="display:flex;align-items:center;gap:18px;background:${AGL_PALE};border-radius:26px;padding:24px 52px;">` +
    `${iconSvg(ICON_FLAME, AGL_GAS_META.accent, 56)}` +
    `<span style="font-size:46px;font-weight:700;color:${AGL_GAS_META.accent};">Gas</span></div></div>` +
    `<div style="display:flex;gap:80px;margin-top:44px;">` +
    `<div style="width:1150px;flex:none;">` +
    `<div>${topBarcode}</div>` +
    `<div style="font-size:24px;color:#6b7680;margin-top:6px;">${escapeHtml(shortCode)}</div>` +
    `<div style="margin-top:18px;"><div style="font-size:38px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="margin-top:52px;">` +
    `<div style="font-size:46px;font-weight:800;color:#0a5fa5;">Hi ${escapeHtml(vm.customerName)},</div>` +
    `<div style="font-size:42px;font-weight:800;color:#0a5fa5;margin-top:10px;line-height:1.35;">` +
    `Here's your gas bill for the supply address:</div>` +
    `<div style="font-size:38px;color:#1b2327;margin-top:22px;line-height:1.5;">${addressHtml}</div></div>` +
    `</div>` +
    `<div style="flex:1;">` +
    aglPanel(ICON_PERSON, "Your details", detailsBody, "0") +
    aglPanel(ICON_HEADSET, "Need help?", helpBody, "34px") +
    `</div></div>` +
    aglCards(vm) +
    aglChargesStrip(vm) +
    aglHowToPay(vm) +
    fictionalFooter(vm) +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const auAglGas: BillTemplate = {
  docType: AGL_GAS_META.docType,
  regionId: "australia",
  label: "燃气账单 · AGL 版式",
  kind: "gas",
  fields: AU_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, AGL_GAS_META);
    const mj = 3200 + Math.floor(rng() * 8800);
    const previousReading = 41000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + mj;
    const mirn = `53${digits(rng, 8)}`;
    const supplyEx = auSplit((AGL_GAS_META.periodDays * 82.5) / 100);
    const usageEx = auSplit((mj * 3.61) / 100);
    const subtotal = round2(supplyEx + usageEx);
    const tax = round2(subtotal * 0.1);
    const total = round2(subtotal + tax);
    const refDigits = digits(rng, 6);
    return {
      docType: AGL_GAS_META.docType,
      regionId: "australia",
      kind: "gas",
      utilityName: AGL_GAS_META.utilityName,
      utilityNameZh: AGL_GAS_META.utilityNameZh,
      tagline: AGL_GAS_META.tagline,
      currency: AGL_GAS_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: AGL_GAS_META.periodDays,
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
        { label: `Supply charge · ${AGL_GAS_META.periodDays} days × 82.5c/day`, amount: supplyEx },
        { label: `Usage · ${formatInt(mj)} MJ × 3.61c/MJ`, amount: usageEx },
      ],
      subtotal,
      taxLabel: "GST 10% (included in total)",
      tax,
      total,
      barcodePayload: `${base.accountNumber}${refDigits}`,
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Gas is measured in megajoules (MJ); 1 MJ ≈ 0.278 kWh.",
        "Rates shown include GST; amounts are billed ex-GST with GST totalled separately.",
      ],
    };
  },
  renderHtml: renderAglGas,
};

/* ================= EnergyAustralia 版式（电力，深绿标题栏流） ================= */

const EA_DARK = "#0a5c34";
const EA_BRIGHT = "#5aa32e";
const EA_PALE = "#f0f5ec";

/** 绿色旋涡 logo（虚构）+ 深色字标 */
function eaStyleLogo(vm: BillViewModel): string {
  return (
    `<div style="display:flex;align-items:center;gap:26px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="130" height="130">` +
    `<circle cx="50" cy="50" r="40" fill="none" stroke="${EA_BRIGHT}" stroke-width="11"/>` +
    `<path d="M50 10 A40 40 0 0 1 90 50" fill="none" stroke="${EA_DARK}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M28 62 Q50 40 72 58 Q55 74 40 66 Q33 63 28 62 Z" fill="${EA_BRIGHT}"/></svg>` +
    `<div style="font-size:66px;font-weight:800;color:#23282d;letter-spacing:-1px;">${escapeHtml(vm.utilityName)}</div>` +
    `</div>`
  );
}

/** 深绿标题栏 + 浅绿 body 的右侧盒（bodyMinHeight 用于撑高 "Your bill" 盒，贴近原版图式的留白） */
function eaPanel(title: string, body: string, icon: string, bodyMinHeight?: number): string {
  return (
    `<div style="border-radius:14px;overflow:hidden;">` +
    `<div style="background:${EA_DARK};padding:20px 34px;display:flex;align-items:center;gap:18px;">` +
    `${iconSvg(icon, "#ffffff", 40)}` +
    `<span style="font-size:38px;font-weight:800;color:#ffffff;">${title}</span></div>` +
    `<div style="background:${EA_PALE};padding:28px 34px 32px;${bodyMinHeight !== undefined ? `min-height:${bodyMinHeight}px;` : ""}">${body}</div></div>`
  );
}

/** "Your electricity account" 边框定义表 */
function eaAccountTable(vm: BillViewModel): string {
  const row = (label: string, valueHtml: string): string =>
    `<tr><td style="padding:20px 4px;border-bottom:2px solid #c9c6bd;font-size:32px;font-weight:800;width:56%;">${label}</td>` +
    `<td style="padding:20px 4px;border-bottom:2px solid #c9c6bd;font-size:32px;text-align:right;font-variant-numeric:tabular-nums;">${valueHtml}</td></tr>`;
  const addr = vm.addressLines.map(escapeHtml).join("<br/>");
  return (
    `<table style="width:100%;border-collapse:collapse;margin-top:26px;">` +
    `<tr><td style="padding:20px 4px;border-top:3px solid #1b2327;border-bottom:2px solid #c9c6bd;font-size:32px;font-weight:800;">Account number:</td>` +
    `<td style="padding:20px 4px;border-top:3px solid #1b2327;border-bottom:2px solid #c9c6bd;font-size:32px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(vm.accountNumber)}</td></tr>` +
    row("National Metering Identifier (NMI):", escapeHtml(meterIdLabel(vm).replace("NMI ", ""))) +
    row("Service address:", addr) +
    row("Bill issue date:", escapeHtml(vm.billDate)) +
    `</table>`
  );
}

/** 费用小表（ex-GST 拆分 + GST included 行，绿色系） */
function eaChargesStrip(vm: BillViewModel): string {
  const row = (label: string, value: string, strong = false): string =>
    `<div style="display:flex;justify-content:space-between;padding:12px 0;` +
    `${strong ? "border-top:2px solid #9fbf8f;margin-top:6px;padding-top:14px;" : "border-bottom:1px solid #d5e2cb;"}">` +
    `<span style="font-size:${strong ? 31 : 28}px;${strong ? "font-weight:800;" : "color:#3c464d;"}">${label}</span>` +
    `<span style="font-size:${strong ? 33 : 28}px;font-weight:${strong ? 800 : 500};font-variant-numeric:tabular-nums;">${value}</span></div>`;
  const rows = vm.charges
    .map((c) => row(escapeHtml(c.label), escapeHtml(fmtMeta(EA_POWER_META, c.amount))))
    .join("");
  return (
    `<div style="margin-top:40px;border:2px solid #cfdcc6;border-radius:14px;padding:24px 32px;background:#fbfdf8;">` +
    `<div style="font-size:29px;font-weight:800;color:${EA_DARK};margin-bottom:8px;">` +
    `How your charges add up · 费用构成（rates GST incl., billed ex-GST）</div>` +
    rows +
    row("Subtotal (excl. GST)", escapeHtml(fmtMeta(EA_POWER_META, vm.subtotal))) +
    row(escapeHtml(vm.taxLabel), escapeHtml(fmtMeta(EA_POWER_META, vm.tax))) +
    row("Total this bill (incl. GST)", escapeHtml(fmtMeta(EA_POWER_META, vm.total)), true) +
    `</div>`
  );
}

/** 底部 "payment options" 区：三栏 + 右侧白色汇款卡 + OCR 行 */
function eaPaymentOptions(vm: BillViewModel): string {
  const biller = bpayBillerCode(vm);
  const billpayCode = seededDigits(`billpay::${vm.invoiceNumber}`, 4);
  const ref = bpayRefFormatted(vm);
  const userCode = seededDigits(`usercode::${vm.invoiceNumber}`, 6);
  const payRef = `10${vm.accountNumber}${seededDigits(`payref::${vm.invoiceNumber}`, 2)}`;
  const cents = `${Math.round(vm.total * 100)}`.padStart(14, "0");
  const barcode = code128Svg(payRef, { moduleWidth: 3, height: 130 });
  const method = (icon: string, title: string, body: string): string =>
    `<div style="display:flex;gap:20px;margin-top:26px;align-items:flex-start;">` +
    `<div style="flex:none;margin-top:2px;">${iconSvg(icon, EA_DARK, 48)}</div>` +
    `<div><div style="font-size:31px;font-weight:800;">${title}</div>` +
    `<div style="font-size:27px;color:#3c464d;line-height:1.55;margin-top:4px;">${body}</div></div></div>`;
  return (
    `<div style="margin-top:auto;background:${EA_PALE};border-radius:16px;padding:38px 44px 34px;">` +
    `<div style="display:flex;gap:56px;">` +
    `<div style="flex:1.9;">` +
    `<div style="font-size:44px;font-weight:800;color:${EA_DARK};">Electricity payment options</div>` +
    `<div style="font-size:27px;color:#3c464d;margin-top:6px;">If your bill has been delayed, you are entitled to an extended amount of time to pay.</div>` +
    `<div style="display:flex;gap:44px;">` +
    `<div style="flex:1;">` +
    method(ICON_CARD, "Direct debit", `Call <b>133 470</b>`) +
    method(
      ICON_MAIL,
      "Mail",
      `Please post this payslip with your cheque payable to: ${escapeHtml(vm.utilityName)}, ` +
        `GPO BOX 4491, Sydney NSW 2001 (fictional)`,
    ) +
    method(
      ICON_PHONE,
      "Phone",
      `Call <b>1300 470 470</b> to pay by credit or debit card for payment amounts up to ${escapeHtml(fmtMeta(EA_POWER_META, 10000))}.`,
    ) +
    `</div>` +
    `<div style="flex:1.1;border-left:2px solid #d5e2cb;padding-left:40px;">` +
    `<div style="display:flex;gap:20px;margin-top:26px;align-items:flex-start;">` +
    `<div style="width:52px;height:52px;background:${EA_DARK};border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;">` +
    `<span style="color:#ffffff;font-size:28px;font-weight:900;">P</span></div>` +
    `<div><div style="font-size:29px;font-weight:800;">Billpay code: ${billpayCode}</div>` +
    `<div style="font-size:29px;font-weight:800;">Ref: ${escapeHtml(ref.grouped)}</div>` +
    `<div style="font-size:26px;color:#3c464d;line-height:1.5;margin-top:4px;">Pay in person at any post office, phone <b>13 18 16</b> or go to the post bill payment site (fictional).</div></div></div>` +
    `<div style="display:flex;gap:20px;margin-top:30px;align-items:flex-start;">${bpayBadge(EA_DARK, 76)}` +
    `<div><div style="font-size:29px;font-weight:800;">Biller code: ${biller}</div>` +
    `<div style="font-size:29px;font-weight:800;">Ref: ${escapeHtml(ref.grouped)}</div>` +
    `<div style="font-size:26px;color:#3c464d;line-height:1.5;margin-top:4px;">BPAY - Make this payment via internet or phone banking.<br/>` +
    `BPAY View - Receive, view and pay this bill using internet banking.<br/>` +
    `BPAY View Registration No - ${escapeHtml(vm.accountNumber)} (all fictional)</div></div></div>` +
    `</div></div>` +
    `<div style="font-size:23px;color:#5a656c;line-height:1.6;margin-top:26px;">` +
    `A merchant service fee may apply to credit card payments. Fee is calculated on the total payment amount. ` +
    `Any fees applied will be shown on your next bill and are GST inclusive. Some exemptions apply. 均为虚构。</div>` +
    `</div>` +
    `<div style="width:620px;flex:none;background:#ffffff;border-radius:12px;padding:32px 38px;align-self:flex-start;">` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;">` +
    `<span style="font-size:31px;font-weight:800;">Amount due</span>` +
    `<span style="text-align:right;"><span style="font-size:44px;font-weight:800;color:${EA_BRIGHT};font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(EA_POWER_META, vm.total))}</span>` +
    `<div style="font-size:24px;color:#3c464d;">(incl. GST)</div></span></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:26px;">` +
    `<span style="font-size:31px;font-weight:800;">Bill due date</span>` +
    `<span style="font-size:40px;color:${EA_BRIGHT};font-variant-numeric:tabular-nums;">${escapeHtml(vm.dueDate)}</span></div>` +
    `<div style="margin-top:30px;">${barcode}</div>` +
    `<div style="margin-top:30px;font-size:29px;font-weight:800;">Office use only</div>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:8px;">` +
    `<tr style="font-size:25px;color:#3c464d;"><td style="padding:6px 0;">Trancode</td><td style="padding:6px 0;">User code</td><td style="padding:6px 0;">Payment reference</td></tr>` +
    `<tr style="font-size:27px;font-variant-numeric:tabular-nums;"><td style="padding:4px 0;">831</td><td style="padding:4px 0;">${userCode}</td><td style="padding:4px 0;">${payRef}</td></tr>` +
    `</table></div>` +
    `</div></div>` +
    `<div style="display:flex;justify-content:center;gap:120px;margin-top:26px;` +
    `font-family:'Courier New',monospace;font-size:34px;letter-spacing:2px;color:#1b2327;">` +
    `<span>&lt;${cents}&gt;&#160;&#160;&lt;${userCode}&gt;</span>` +
    `<span>&lt;0${payRef}&gt;&#160;&gt;</span></div>`
  );
}

function renderEaPower(vm: BillViewModel, opts: RenderOptions): string {
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:34px;color:#1b2327;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const topBarcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 100 });
  const shortCode = vm.accountNumber.slice(0, 5);
  const contactBody =
    `<div style="font-size:28px;color:#1b2327;line-height:1.75;">` +
    `<div><b>Enquiries and Complaints:</b> 133 470</div>` +
    `<div><b>Online:</b> wattleenergy.example (fictional)</div>` +
    `<div style="margin-top:10px;"><b>Faults or emergencies:</b></div>` +
    `<div>Line faults or supply failure (24 Hrs)</div>` +
    `<div>GridNet Services 131 470 (fictional)</div></div>`;
  const billBody =
    `<div style="font-size:30px;font-weight:800;">Amount due</div>` +
    `<div style="font-size:24px;color:#5a656c;">(incl. GST)</div>` +
    `<div style="font-size:66px;font-weight:800;color:${EA_BRIGHT};font-variant-numeric:tabular-nums;margin-top:6px;">${escapeHtml(fmtMeta(EA_POWER_META, vm.total))}</div>` +
    `<div style="font-size:30px;font-weight:800;margin-top:24px;">Bill due date</div>` +
    `<div style="font-size:50px;color:${EA_BRIGHT};margin-top:4px;">${escapeHtml(vm.dueDate)}</div>` +
    `<div style="font-size:25px;color:#5a656c;margin-top:20px;border-top:2px solid #d5e2cb;padding-top:16px;">` +
    `This period: ${escapeHtml(vm.usageSummary)} · ${vm.periodDays} days<br/>` +
    `${escapeHtml(vm.periodStart)} – ${escapeHtml(vm.periodEnd)}</div>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:90px 110px 60px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    eaStyleLogo(vm) +
    `<div style="text-align:right;font-size:26px;color:#5a656c;line-height:1.6;">` +
    `<div style="font-size:32px;color:#1b2327;">Tax invoice</div>` +
    `<div>${escapeHtml(vm.utilityName)} Pty Ltd ABN 99 086 014 000 (fictional)</div></div></div>` +
    `<div style="display:flex;gap:70px;margin-top:36px;">` +
    `<div style="width:1180px;flex:none;">` +
    `<div>${topBarcode}</div>` +
    `<div style="font-size:22px;color:#6b7680;margin-top:4px;">${escapeHtml(shortCode)}</div>` +
    `<div style="margin-top:16px;"><div style="font-size:36px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="font-size:58px;font-weight:800;margin-top:56px;">Your electricity account</div>` +
    eaAccountTable(vm) +
    `<div style="font-size:27px;color:#3c464d;line-height:1.65;margin-top:26px;">` +
    `Government support may be available to help reduce bills. Check the understand your bill section to see if you ` +
    `have received a rebate or concession. More information at your government's energy site (fictional).</div>` +
    `<div style="margin-top:34px;border-radius:12px;overflow:hidden;">` +
    `<div style="background:${EA_DARK};padding:18px 32px;font-size:34px;font-weight:800;color:#ffffff;">` +
    `Could you save money on another plan?</div>` +
    `<div style="background:${EA_PALE};padding:24px 32px;font-size:26px;color:#1b2327;line-height:1.65;">` +
    `Based on your past usage, our Flexi Plan (Home) may cost you less per year than your current plan. ` +
    `Go to <b>wattleenergy.example</b> or call us on <b>133 470</b> to find out more (all fictional). ` +
    `Compare other plans at your government's energy comparison site.<br/>` +
    `<span style="color:#5a656c;">The energy regulator requires us to include this information.</span></div></div>` +
    eaChargesStrip(vm) +
    `</div>` +
    `<div style="flex:1;">` +
    eaPanel("Need to get in touch?", contactBody, ICON_PHONE) +
    `<div style="height:36px;"></div>` +
    eaPanel("Your bill", billBody, ICON_DOC, 560) +
    `</div></div>` +
    eaPaymentOptions(vm) +
    fictionalFooter(vm) +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const auEnergyAustraliaPower: BillTemplate = {
  docType: EA_POWER_META.docType,
  regionId: "australia",
  label: "电费账单 · EnergyAustralia 版式",
  kind: "power",
  fields: AU_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, EA_POWER_META);
    const kwh = 420 + Math.floor(rng() * 1150);
    const previousReading = 32000 + Math.floor(rng() * 15000);
    const currentReading = previousReading + kwh;
    const nmi = `30${digits(rng, 8)}`;
    const supplyEx = auSplit((EA_POWER_META.periodDays * 102.4) / 100);
    const usageEx = auSplit((kwh * 29.9) / 100);
    const subtotal = round2(supplyEx + usageEx);
    const tax = round2(subtotal * 0.1);
    const total = round2(subtotal + tax);
    const refDigits = digits(rng, 4);
    return {
      docType: EA_POWER_META.docType,
      regionId: "australia",
      kind: "power",
      utilityName: EA_POWER_META.utilityName,
      utilityNameZh: EA_POWER_META.utilityNameZh,
      tagline: EA_POWER_META.tagline,
      currency: EA_POWER_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: EA_POWER_META.periodDays,
      meterRows: [
        {
          label: `NMI ${nmi} · meter read (kWh)`,
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        {
          label: `Supply charge · ${EA_POWER_META.periodDays} days × 102.4c/day`,
          amount: supplyEx,
        },
        { label: `Usage · ${formatInt(kwh)} kWh × 29.9c/kWh`, amount: usageEx },
      ],
      subtotal,
      taxLabel: "GST 10% (included in total)",
      tax,
      total,
      barcodePayload: `${base.accountNumber}${refDigits}`,
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Rates shown include GST; amounts are billed ex-GST with GST totalled separately.",
        "Pay via BPAY, card, direct debit or at the post office (all fictional).",
      ],
    };
  },
  renderHtml: renderEaPower,
};
