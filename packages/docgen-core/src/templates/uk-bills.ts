/**
 * 真实地区「英国 UK」扩展：英国三大公用事业账单版式复刻。
 * - ukBritishGasGas      "British Gas"：燃气单——Supply address + Rota block、蓝焰字标、
 *   大号问候标题、蓝色 "Your account summary" 圆角卡片（previous balance / costs /
 *   payments / new balance·Debit）、绿色 "Important information" 付款提示卡、
 *   m³→kWh 换算行、VAT 5%、tariff 信息栏 + Did you know
 * - ukEonNextPower       "E.ON Next"：电力单——橙红 e.on/next 双行字标、Get in touch 块 +
 *   Rota 框、粉底/紫底账户流水条（CR/DR）、Direct Debit 说明段、右侧年度预估 +
 *   Next Pledge / Next Secure 换资费省钱推荐栏、注册信息页脚
 * - ukThamesWaterWater   "Thames Water"：水单——圆形蓝底白字 roundel、右侧浅蓝信息侧栏
 *   （户号/账期/供水地址 + What's in this bill 目录）、绿色 "What to pay" 大卡片 +
 *   蓝色 "When to pay by" 卡片、How to pay 三栏、water + sewerage 分区计价、
 *   民用水 VAT 零税率、伪 QR
 * 地址字段复用 uk（streetNo / streetName / city / postcode），真实货币 GBP。
 * 账期长度按参考图实际账期取值：月度账单 31 天、水务半年账 190 天。
 */

import type {
  BillInput,
  BillTemplate,
  BillViewModel,
  ChargeSection,
  RenderOptions,
} from "../model";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  buildBase,
  escapeHtml,
  fmtMeta,
  formatInt,
  round2,
  type TemplateMeta,
} from "./common";
import { fnv1a, mulberry32 } from "../hash";
import { pseudoQrSvg } from "../pseudoqr";

const UK_FIELDS = [
  {
    kind: "text",
    key: "streetNo",
    label: "门牌号",
    placeholder: "12",
    required: true,
    maxLength: 6,
    pattern: /^\d{1,5}[A-Z]?$/,
  },
  {
    kind: "text",
    key: "streetName",
    label: "街道名",
    placeholder: "Mill Lane",
    required: true,
    maxLength: 50,
  },
  {
    kind: "text",
    key: "city",
    label: "城市",
    placeholder: "London",
    required: true,
    maxLength: 40,
  },
  {
    kind: "text",
    key: "postcode",
    label: "邮编",
    placeholder: "SW1A 1AA",
    required: true,
    maxLength: 8,
    pattern: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/,
  },
] as const;

const BGAS_META: TemplateMeta = {
  docType: "uk_britishgas_gas",
  regionId: "uk",
  kind: "gas",
  utilityName: "British Gas",
  utilityNameZh: "英国燃气",
  tagline: "Gas & energy services",
  currency: "GBP",
  prefix: "ABG",
  periodDays: 31,
  accent: "#0046b0",
  locale: "en-GB",
};

const EON_META: TemplateMeta = {
  docType: "uk_eonnext_power",
  regionId: "uk",
  kind: "power",
  utilityName: "E.ON Next",
  utilityNameZh: "E.ON Next",
  tagline: "Energy supplier",
  currency: "GBP",
  prefix: "NVW",
  periodDays: 31,
  accent: "#7b2d8e",
  locale: "en-GB",
};

const TW_META: TemplateMeta = {
  docType: "uk_thameswater_water",
  regionId: "uk",
  kind: "water",
  utilityName: "Thames Water",
  utilityNameZh: "泰晤士水务",
  tagline: "Water & sewerage services",
  currency: "GBP",
  prefix: "CHW",
  periodDays: 190,
  accent: "#00a3e0",
  locale: "en-GB",
};

const UK_FONT = `Helvetica, Arial, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif`;

/** 抄表读数标记：a = actual / e = estimated（确定性派生） */
function marker(rng: () => number): "a" | "e" {
  return rng() < 0.6 ? "a" : "e";
}

function digitsFrom(rng: () => number, n: number): string {
  return Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join("");
}

/** 水印层（复制自 common.ts 的私有实现，供本文件自定义外壳使用） */
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

function money(meta: TemplateMeta, amount: number): string {
  return escapeHtml(fmtMeta(meta, amount));
}

function fictionalNotice(): string {
  return `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。`;
}

/* ================= British Gas 版式 ================= */

const BGAS_BLUE = "#0099ff";
const BGAS_GREEN = "#009530";
const BGAS_NAVY = "#0046b0";
const BGAS_FLAME_GREEN = "#a3c614";
const BGAS_STANDING_P = 32.1;
const BGAS_UNIT_P = 7.14;
const BGAS_CALORIFIC = 39.4;
const BGAS_CORRECTION = 1.0226;

/** British Gas 火焰标：蓝色火瓣 + 左下绿色弯月（内联 SVG，无外部资源） */
function bgasFlame(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110" viewBox="0 0 150 110" role="img" aria-label="logo">` +
    `<path d="M28 68 C50 22 102 4 142 6 C146 52 116 96 62 100 C40 102 24 90 28 68 Z" fill="${BGAS_NAVY}"/>` +
    `<path d="M8 84 C16 104 44 114 74 108 C50 108 26 100 14 78 Z" fill="${BGAS_FLAME_GREEN}"/>` +
    `</svg>`
  );
}

function bgasSummaryRow(
  label: string,
  value: string,
  opts?: { bold?: boolean; mid?: string },
): string {
  const bold = opts?.bold === true;
  return (
    `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:16px 0;` +
    `${bold ? `border-top:2px solid #9ecceb;margin-top:8px;padding-top:24px;` : ""}">` +
    `<span style="font-size:${bold ? 40 : 36}px;font-weight:${bold ? 800 : 600};color:#1b2327;">${label}</span>` +
    (opts?.mid !== undefined
      ? `<span style="font-size:34px;font-weight:700;color:#1b2327;">${opts.mid}</span>`
      : "") +
    `<span style="font-size:${bold ? 42 : 38}px;font-weight:${bold ? 800 : 600};color:${BGAS_NAVY};` +
    `font-variant-numeric:tabular-nums;">${value}</span></div>`
  );
}

function renderBritishGas(vm: BillViewModel, meta: TemplateMeta, opts: RenderOptions): string {
  const s = vm.accountSummary ?? {
    previousBalance: 0,
    paymentsReceived: 0,
    currentCharges: vm.total,
  };
  const conv = vm.conversion;
  const meter = vm.meterRows[0];
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:34px;color:#1b2327;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const kwh = conv?.kwh ?? 0;
  const annualUsage = Math.round((kwh * 365) / vm.periodDays);
  const annualCost = round2(
    ((annualUsage * BGAS_UNIT_P) / 100 + (365 * BGAS_STANDING_P) / 100) * 1.05,
  );
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #dbe9f5;">` +
        `<span style="font-size:32px;color:#333c42;">${escapeHtml(line.label)}</span>` +
        `<span style="font-size:32px;font-variant-numeric:tabular-nums;color:#1b2327;">${money(meta, line.amount)}</span></div>`,
    )
    .join("");
  const conversionLine =
    conv !== undefined
      ? `<div style="font-size:30px;color:#5a656c;margin-top:12px;">` +
        `Unit conversion: ${formatInt(conv.cubicMeters)} m³ × calorific value ${conv.brennwert.toFixed(1)} × ` +
        `correction factor ${conv.zustandszahl.toFixed(4)} ÷ 3.6 = <b style="color:#1b2327;">${formatInt(conv.kwh)} kWh</b></div>`
      : "";
  const notes =
    vm.notes.length === 0
      ? ""
      : `<div style="margin-top:44px;font-size:27px;color:#8a9298;line-height:1.7;flex:none;">` +
        vm.notes.map((n) => `<div>${escapeHtml(n)}</div>`).join("") +
        `</div>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:${UK_FONT};">` +
    `<div style="position:absolute;inset:0;padding:110px 130px;display:flex;flex-direction:column;">` +
    /* 页眉：Supply address + Rota block（左） / swoosh + 字标（右） */
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex:none;">` +
    `<div><div style="font-size:34px;font-weight:800;color:#1b2327;">Supply address:</div>` +
    `<div style="margin-top:8px;">${addressHtml}</div>` +
    `<div style="display:flex;align-items:center;gap:16px;margin-top:22px;">` +
    `<span style="font-size:32px;font-weight:800;color:#1b2327;">Rota block letter:</span>` +
    `<span style="border:3px solid #1b2327;padding:2px 20px;font-size:32px;font-weight:700;">R</span></div></div>` +
    `<div style="position:relative;margin-top:88px;flex:none;">` +
    `<div style="position:absolute;top:-88px;right:44px;">${bgasFlame()}</div>` +
    `<div style="font-size:118px;font-weight:800;color:${BGAS_NAVY};letter-spacing:-2px;line-height:1.1;">${escapeHtml(vm.utilityName)}</div></div></div>` +
    /* 客户地址块 */
    `<div style="margin-top:60px;flex:none;"><div style="font-size:40px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    /* 大号问候标题 + 账期元信息 */
    `<div style="margin-top:60px;flex:none;"><div style="font-size:88px;font-weight:800;color:${BGAS_NAVY};">Hello,</div>` +
    `<div style="font-size:60px;font-weight:800;color:${BGAS_NAVY};margin-top:10px;">we've prepared your gas bill for you</div></div>` +
    `<div style="margin-top:44px;font-size:36px;line-height:1.8;color:#1b2327;flex:none;">` +
    `<div><b>Covering:</b> ${escapeHtml(vm.periodStart)} to ${escapeHtml(vm.periodEnd)}</div>` +
    `<div><b>Bill date:</b> on ${escapeHtml(vm.billDate)}</div>` +
    `<div><b>Customer account number:</b> ${escapeHtml(vm.accountNumber)}</div></div>` +
    /* 蓝色账户摘要卡 */
    `<div style="margin-top:56px;border:4px solid ${BGAS_BLUE};border-radius:26px;overflow:hidden;max-width:1400px;flex:none;">` +
    `<div style="background:${BGAS_BLUE};color:#ffffff;padding:20px 42px;font-size:44px;font-weight:700;` +
    `display:flex;align-items:center;gap:20px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><rect x="7" y="5" width="32" height="36" rx="4" fill="none" stroke="#ffffff" stroke-width="4"/><line x1="14" y1="16" x2="32" y2="16" stroke="#ffffff" stroke-width="4"/><line x1="14" y1="24" x2="32" y2="24" stroke="#ffffff" stroke-width="4"/><line x1="14" y1="32" x2="26" y2="32" stroke="#ffffff" stroke-width="4"/></svg>` +
    `Your account summary</div>` +
    `<div style="padding:34px 44px 40px;">` +
    bgasSummaryRow(
      `Your previous balance on ${escapeHtml(vm.periodStart)}`,
      money(meta, s.previousBalance),
    ) +
    bgasSummaryRow(
      "Your total gas costs (inc. VAT and any adjustments)",
      money(meta, s.currentCharges),
    ) +
    bgasSummaryRow("Payments", `+ ${money(meta, s.paymentsReceived)}`) +
    bgasSummaryRow(`Your new balance on ${escapeHtml(vm.billDate)}`, money(meta, vm.total), {
      bold: true,
      mid: "Debit",
    }) +
    `</div></div>` +
    /* 绿色付款提示卡 */
    `<div style="margin-top:48px;border:4px solid ${BGAS_GREEN};border-radius:26px;overflow:hidden;max-width:1400px;flex:none;">` +
    `<div style="background:${BGAS_GREEN};color:#ffffff;padding:20px 42px;font-size:44px;font-weight:700;` +
    `display:flex;align-items:center;gap:20px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="#ffffff" stroke-width="4"/><line x1="23" y1="14" x2="23" y2="26" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/><circle cx="23" cy="33" r="2.6" fill="#ffffff"/></svg>` +
    `Important information</div>` +
    `<div style="padding:34px 44px 40px;">` +
    `<div style="font-size:42px;font-weight:800;color:#1b2327;">Please pay ${money(meta, vm.total)} by ${escapeHtml(vm.dueDate)} - thank you</div>` +
    `<div style="font-size:34px;color:#333c42;margin-top:24px;">You can find simple ways to pay on the last page of this bill.</div>` +
    `</div></div>` +
    /* 燃气费用明细（含 m³→kWh 换算） */
    `<div style="margin-top:64px;border-left:10px solid ${BGAS_NAVY};padding-left:36px;flex:none;">` +
    `<div style="font-size:34px;letter-spacing:3px;color:${BGAS_NAVY};text-transform:uppercase;font-weight:800;">Your gas charges in detail · 费用明细</div>` +
    (meter !== undefined
      ? `<div style="font-size:30px;color:#5a656c;margin-top:14px;">Meter reading: ${escapeHtml(meter.previous)} → ` +
        `${escapeHtml(meter.current)} (<b style="color:#1b2327;">${escapeHtml(meter.usage)}</b> used)</div>`
      : "") +
    conversionLine +
    `<div style="margin-top:16px;">${chargeRows}` +
    `<div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #dbe9f5;">` +
    `<span style="font-size:32px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:32px;font-variant-numeric:tabular-nums;color:#1b2327;">${money(meta, vm.tax)}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:20px 0;align-items:baseline;">` +
    `<span style="font-size:38px;font-weight:800;">Total for this bill</span>` +
    `<span style="font-size:48px;font-weight:800;color:${BGAS_NAVY};font-variant-numeric:tabular-nums;">${money(meta, vm.total)}</span></div></div></div>` +
    /* 底部：tariff 信息 + Did you know */
    `<div style="margin-top:56px;border-top:4px solid ${BGAS_NAVY};padding-top:44px;display:flex;gap:90px;flex:none;">` +
    `<div style="flex:1.4;font-size:32px;line-height:1.7;color:#1b2327;">` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;color:${BGAS_NAVY};width:360px;flex:none;">Your gas tariff:</span><span>Standard Variable Tariff</span></div>` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;width:360px;flex:none;">Payment method:</span><span>Pay on receipt of a monthly bill</span></div>` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;width:360px;flex:none;">Tariff ends:</span><span>No end date</span></div>` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;width:360px;flex:none;">Exit fee:</span><span>None</span></div>` +
    `<div style="margin-top:22px;display:flex;gap:30px;"><span style="font-weight:800;color:${BGAS_NAVY};width:360px;flex:none;">Annual estimates:</span><span>Gas</span></div>` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;width:360px;flex:none;">Estimated annual usage:</span><span>${formatInt(annualUsage)} kWh</span></div>` +
    `<div style="display:flex;gap:30px;"><span style="font-weight:800;width:360px;flex:none;">Estimated annual cost:</span><span>${money(meta, annualCost)}</span></div></div>` +
    `<div style="flex:1;"><div style="display:flex;align-items:center;gap:18px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="52" viewBox="0 0 64 52"><rect x="3" y="3" width="58" height="38" rx="4" fill="none" stroke="${BGAS_NAVY}" stroke-width="5"/><line x1="24" y1="49" x2="40" y2="49" stroke="${BGAS_NAVY}" stroke-width="5"/><line x1="32" y1="41" x2="32" y2="49" stroke="${BGAS_NAVY}" stroke-width="5"/></svg>` +
    `<span style="font-size:44px;font-weight:800;color:${BGAS_NAVY};">Did you know?</span></div>` +
    `<div style="font-size:34px;color:#333c42;line-height:1.7;margin-top:20px;">It's always a good idea to check online for the best tariff deals available.</div></div></div>` +
    notes +
    `<div style="margin-top:auto;padding-top:40px;font-size:27px;color:#a2a9ae;line-height:1.7;flex:none;">` +
    `If you're finding it hard to pay your energy bill, there are a number of ways we can help you. ` +
    `Visit <b style="color:#5a656c;">britishgas.co.uk/payhelp</b><br/>` +
    fictionalNotice() +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const ukBritishGasGas: BillTemplate = {
  docType: BGAS_META.docType,
  regionId: "uk",
  label: "燃气账单 · British Gas 版式",
  kind: "gas",
  fields: UK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, BGAS_META);
    const days = BGAS_META.periodDays;
    const m3 = 100 + Math.floor(rng() * 260);
    const kwh = Math.round((m3 * BGAS_CALORIFIC * BGAS_CORRECTION) / 3.6);
    const prevReading = 4300 + Math.floor(rng() * 2000);
    const standing = round2((days * BGAS_STANDING_P) / 100);
    const unit = round2((kwh * BGAS_UNIT_P) / 100);
    const subtotal = round2(standing + unit);
    const tax = round2(subtotal * 0.05);
    const currentCharges = round2(subtotal + tax);
    const previousBalance = round2(30 + rng() * 90);
    const paymentsReceived = previousBalance;
    const total = round2(previousBalance - paymentsReceived + subtotal + tax);
    return {
      docType: BGAS_META.docType,
      regionId: "uk",
      kind: "gas",
      utilityName: BGAS_META.utilityName,
      utilityNameZh: BGAS_META.utilityNameZh,
      tagline: BGAS_META.tagline,
      currency: BGAS_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: BGAS_META.periodDays,
      meterRows: [
        {
          label: "Gas meter (m³)",
          previous: `${formatInt(prevReading)} ${marker(rng)}`,
          current: `${formatInt(prevReading + m3)} ${marker(rng)}`,
          usage: `${formatInt(m3)} m³`,
        },
      ],
      usageSummary: `${formatInt(m3)} m³ → ${formatInt(kwh)} kWh`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        {
          label: `Gas standing charge · ${days} days × ${BGAS_STANDING_P.toFixed(1)}p/day`,
          amount: standing,
        },
        {
          label: `Gas unit rate · ${formatInt(kwh)} kWh × ${BGAS_UNIT_P.toFixed(2)}p/kWh`,
          amount: unit,
        },
      ],
      subtotal,
      taxLabel: "VAT at 5%",
      tax,
      total,
      accountSummary: { previousBalance, paymentsReceived, currentCharges },
      conversion: {
        cubicMeters: m3,
        brennwert: BGAS_CALORIFIC,
        zustandszahl: BGAS_CORRECTION,
        kwh,
      },
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Readings marked 'a' are actual; 'e' are estimated.",
        "Domestic gas is charged VAT at the reduced 5% rate.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderBritishGas(vm, BGAS_META, opts);
  },
};

/* ================= E.ON Next 版式 ================= */

/** E.ON 品牌橙红（字标两行同色） */
const EON_CORAL_DARK = "#f04e23";
const EON_CORAL_LIGHT = "#f04e23";
const EON_PURPLE = "#7b2d8e";
const EON_INK = "#2e1a47";
const EON_PINK_ROW = "#f9e4ee";
const EON_STANDING_P = 48.9;
const EON_UNIT_P = 26.4;

/** 粉色闪电吉祥物（装饰性 SVG） */
function eonBolt(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 100 100" role="img" aria-label="mascot">` +
    `<polygon points="58,4 20,56 43,56 36,96 80,40 55,40" fill="#f48fb1"/>` +
    `<circle cx="47" cy="34" r="7" fill="none" stroke="#2e1a47" stroke-width="3"/>` +
    `<circle cx="63" cy="30" r="7" fill="none" stroke="#2e1a47" stroke-width="3"/>` +
    `<line x1="54" y1="32" x2="56" y2="32" stroke="#2e1a47" stroke-width="3"/>` +
    `</svg>`
  );
}

function renderEonNext(vm: BillViewModel, meta: TemplateMeta, opts: RenderOptions): string {
  const s = vm.accountSummary ?? {
    previousBalance: 0,
    paymentsReceived: 0,
    currentCharges: vm.total,
  };
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:36px;color:${EON_INK};line-height:1.45;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const addressInline = vm.addressLines.map((l) => escapeHtml(l)).join(", ");
  /* 装饰性派生（hash of vm，渲染层确定性）：MPAN / 省钱金额 / DD 收款日 */
  const rr = mulberry32(fnv1a(`eon::${vm.accountNumber}::${vm.invoiceNumber}`));
  const mpan = `${digitsFrom(rr, 2)} ${digitsFrom(rr, 4)} ${digitsFrom(rr, 4)} ${digitsFrom(rr, 3)}`;
  const saveSimilar = round2(20 + rr() * 40);
  const saveOverall = round2(saveSimilar + 5 + rr() * 30);
  const kwhUsed = Number(vm.meterRows[0]?.usage.replace(/[^\d]/g, "") ?? "0");
  const annualCost = round2(
    ((kwhUsed * 365 * EON_UNIT_P) / vm.periodDays / 100 + (365 * EON_STANDING_P) / 100) * 1.05,
  );
  const periodParts = vm.periodStart.split(" ");
  const ddDate = `${5 + Math.floor(rr() * 20)} ${periodParts[1] ?? "Aug"} ${periodParts[2] ?? "2026"}`;
  const chargeDetail = vm.charges
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:29px;color:#5a4a6e;">` +
        `<span>${escapeHtml(line.label)}</span>` +
        `<span style="font-variant-numeric:tabular-nums;">${money(meta, line.amount)}</span></div>`,
    )
    .join("");
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:${EON_INK};font-family:${UK_FONT};">` +
    `<div style="position:absolute;inset:0;padding:105px 120px;display:flex;flex-direction:column;">` +
    /* 页眉：双行 logo（左） / Get in touch + Rota 框（右） */
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="line-height:0.95;">` +
    `<div style="font-size:64px;font-weight:400;font-style:italic;color:${EON_CORAL_LIGHT};">e.on</div>` +
    `<div style="font-size:128px;font-weight:800;font-style:italic;color:${EON_CORAL_DARK};letter-spacing:-2px;">next</div></div>` +
    `<div style="display:flex;gap:34px;align-items:flex-start;">` +
    `<div style="font-size:32px;line-height:1.75;">` +
    `<div style="font-weight:800;">Get in touch with us</div>` +
    `<div style="display:flex;align-items:center;gap:12px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="none" stroke="${EON_CORAL_DARK}" stroke-width="3"/><ellipse cx="17" cy="17" rx="6" ry="14" fill="none" stroke="${EON_CORAL_DARK}" stroke-width="3"/><line x1="3" y1="17" x2="31" y2="17" stroke="${EON_CORAL_DARK}" stroke-width="3"/></svg>` +
    `<span>eonnext.com/contact</span></div>` +
    `<div style="display:flex;align-items:center;gap:12px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="28" viewBox="0 0 34 28"><rect x="2" y="2" width="30" height="24" rx="3" fill="none" stroke="${EON_CORAL_DARK}" stroke-width="3"/><path d="M2 4 L17 17 L32 4" fill="none" stroke="${EON_CORAL_DARK}" stroke-width="3"/></svg>` +
    `<span>hi@eonnext.com</span></div></div>` +
    `<div style="border:3px solid ${EON_INK};padding:6px 22px;font-size:34px;font-weight:700;">R</div></div></div>` +
    /* 客户地址 */
    `<div style="margin-top:80px;flex:none;"><div style="font-size:36px;color:${EON_INK};line-height:1.45;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    /* 账号元信息（右对齐行） */
    `<div style="margin-top:60px;text-align:right;font-size:34px;line-height:1.7;">` +
    `<div><b>Your account number.</b> ${escapeHtml(vm.accountNumber)}</div>` +
    `<div><b>Bill reference.</b> ${escapeHtml(vm.invoiceNumber)}</div>` +
    `<div><b>Date.</b> ${escapeHtml(vm.billDate)}</div></div>` +
    `<div style="display:flex;gap:70px;margin-top:56px;flex:1 0 auto;">` +
    /* 左栏：账户流水 */
    `<div style="flex:1.3;">` +
    `<div style="display:flex;align-items:center;gap:36px;">` +
    `<div style="font-size:76px;font-weight:800;color:${EON_CORAL_DARK};">Your energy account.</div>${eonBolt()}</div>` +
    `<div style="font-size:32px;margin-top:14px;">${addressInline}</div>` +
    `<div style="font-size:34px;margin-top:44px;">${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}</div>` +
    `<div style="margin-top:40px;background:${EON_PINK_ROW};padding:24px 34px;display:flex;justify-content:space-between;align-items:baseline;">` +
    `<span style="font-size:34px;font-weight:800;">On ${escapeHtml(vm.periodStart)} your previous balance was</span>` +
    `<span style="font-size:34px;font-variant-numeric:tabular-nums;">${money(meta, s.previousBalance)} CR</span></div>` +
    `<div style="margin-top:36px;font-size:34px;font-weight:800;">We have charged you (VAT is included)</div>` +
    `<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:baseline;font-size:34px;">` +
    `<span>Electricity</span><span style="font-size:29px;color:#5a4a6e;">${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}</span>` +
    `<span style="font-variant-numeric:tabular-nums;">${money(meta, s.currentCharges)} DR</span></div>` +
    `<div style="margin:10px 0 0;padding:14px 22px;background:#faf5fa;border-radius:10px;">${chargeDetail}` +
    `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:29px;color:#5a4a6e;">` +
    `<span>${escapeHtml(vm.taxLabel)}</span><span style="font-variant-numeric:tabular-nums;">${money(meta, vm.tax)}</span></div></div>` +
    `<div style="margin-top:36px;font-size:34px;font-weight:800;">You have paid</div>` +
    `<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:baseline;font-size:34px;">` +
    `<span>Direct Debit collection</span><span style="font-size:29px;color:#5a4a6e;">${escapeHtml(ddDate)}</span>` +
    `<span style="font-variant-numeric:tabular-nums;">${money(meta, s.paymentsReceived)} CR</span></div>` +
    `<div style="margin-top:40px;background:${EON_PURPLE};color:#ffffff;padding:24px 34px;` +
    `display:flex;justify-content:space-between;align-items:baseline;">` +
    `<span style="font-size:34px;font-weight:800;">On ${escapeHtml(vm.billDate)} your new balance was</span>` +
    `<span style="font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;">${money(meta, vm.total)} DR</span></div>` +
    `<div style="margin-top:44px;font-size:32px;line-height:1.65;">` +
    `<b>Good news</b> - you pay by monthly Direct Debit (DD) so you're getting cheaper prices than if you pay ` +
    `when you receive your bill, and your payments are up to date. We regularly review how much you're paying ` +
    `to make sure it's the right amount and will let you know if it needs to change.</div>` +
    `<div style="margin-top:26px;font-size:32px;line-height:1.65;">` +
    `<b>Remember</b>, if you cancel your DD your prices will increase.</div></div>` +
    /* 右栏：年度预估 + 资费推荐 */
    `<div style="flex:1;border-left:1px solid #e3dcea;padding-left:56px;">` +
    `<div style="font-size:38px;font-weight:800;">Your estimated cost for the year.</div>` +
    `<div style="margin-top:22px;font-size:40px;"><b>${money(meta, annualCost)}</b> a year for electricity</div>` +
    `<div style="margin-top:22px;font-size:30px;line-height:1.65;">This is an estimate based on your expected ` +
    `annual energy usage, and your current tariff rates, charges and discounts, including VAT. Actual bills ` +
    `will vary depending on your usage and tariff selection.</div>` +
    `<div style="margin-top:40px;border-top:1px solid #e3dcea;padding-top:36px;">` +
    `<div style="font-size:38px;font-weight:800;">Could you save money and pay less?</div>` +
    `<div style="margin-top:20px;font-size:30px;line-height:1.65;">Remember - it might be worth thinking about ` +
    `switching your tariff or supplier.</div>` +
    `<div style="margin-top:20px;font-size:28px;">For your <b>electricity</b> (on meter point ${mpan})</div>` +
    `<div style="margin-top:24px;font-size:32px;line-height:1.6;">Our <b>cheapest similar tariff</b> is ` +
    `<b>Next Pledge Tracker 12m v5</b> - you could save <b>${money(meta, saveSimilar)}</b> a year by switching to this.</div>` +
    `<div style="margin-top:24px;font-size:32px;line-height:1.6;">Our <b>cheapest tariff overall</b> is ` +
    `<b>Next Secure Fixed 12m v14</b> - you could save <b>${money(meta, saveOverall)}</b> a year by switching to this.</div>` +
    `<div style="margin-top:30px;font-size:30px;line-height:1.65;">Paying by Direct Debit is cheaper than if you ` +
    `pay when you get your bill. For our cheapest tariffs you may need to change your meter or the way you pay.</div></div></div>` +
    `</div>` +
    /* 页脚 */
    `<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:60px;flex:none;">` +
    `<div style="font-size:25px;color:#8a8296;line-height:1.65;">` +
    `${escapeHtml(vm.utilityName)} Energy Limited Registered Office: Westwood Way, Westwood Business Park, Coventry CV4 8LG. ` +
    `Registered in England and Wales No. 03782443. E.ON UK plc VAT Group Registration Number: 559 0978 89.<br/>${fictionalNotice()}</div>` +
    `<div style="font-size:28px;color:${EON_INK};flex:none;">Page 1/4</div></div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const ukEonNextPower: BillTemplate = {
  docType: EON_META.docType,
  regionId: "uk",
  label: "电费账单 · E.ON Next 版式",
  kind: "power",
  fields: UK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, EON_META);
    const days = EON_META.periodDays;
    const kwh = 180 + Math.floor(rng() * 320);
    const prevReading = 8000 + Math.floor(rng() * 6000);
    const standing = round2((days * EON_STANDING_P) / 100);
    const unit = round2((kwh * EON_UNIT_P) / 100);
    const subtotal = round2(standing + unit);
    const tax = round2(subtotal * 0.05);
    const currentCharges = round2(subtotal + tax);
    const previousBalance = round2(20 + rng() * 60);
    const paymentsReceived = previousBalance;
    const total = round2(previousBalance - paymentsReceived + subtotal + tax);
    return {
      docType: EON_META.docType,
      regionId: "uk",
      kind: "power",
      utilityName: EON_META.utilityName,
      utilityNameZh: EON_META.utilityNameZh,
      tagline: EON_META.tagline,
      currency: EON_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: EON_META.periodDays,
      meterRows: [
        {
          label: "Electricity meter",
          previous: `${formatInt(prevReading)} ${marker(rng)}`,
          current: `${formatInt(prevReading + kwh)} ${marker(rng)}`,
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh · ${days} days`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        {
          label: `Electricity standing charge · ${days} days × ${EON_STANDING_P.toFixed(1)}p/day`,
          amount: standing,
        },
        {
          label: `Electricity unit rate · ${formatInt(kwh)} kWh × ${EON_UNIT_P.toFixed(1)}p/kWh`,
          amount: unit,
        },
      ],
      subtotal,
      taxLabel: "VAT at 5% (included in totals)",
      tax,
      total,
      accountSummary: { previousBalance, paymentsReceived, currentCharges },
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Domestic electricity is charged VAT at the reduced 5% rate.",
        "You pay by monthly Direct Debit — no action is needed.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderEonNext(vm, EON_META, opts);
  },
};

/* ================= Thames Water 版式 ================= */

const TW_CYAN = "#00a3e0";
const TW_GREEN = "#8cc63e";
const TW_SIDEBAR_BG = "#e9f5fb";
const TW_PANEL_BG = "#f2f9fc";
const TW_WATER_RATE = 1.923;
const TW_WATER_STANDING_P = 8.16;
const TW_SEWER_RATE = 2.361;
const TW_SEWER_STANDING_P = 12.34;
const TW_SEWER_FACTOR = 0.95;

function twIcon(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    `<g fill="none" stroke="${TW_CYAN}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`
  );
}

const TW_ICONS = {
  person: `<circle cx="24" cy="16" r="7"/><path d="M10 40 C10 30 17 26 24 26 C31 26 38 30 38 40"/>`,
  mouse: `<rect x="16" y="6" width="16" height="30" rx="8"/><line x1="24" y1="12" x2="24" y2="20"/><path d="M20 42 L28 42"/>`,
  calendar: `<rect x="8" y="10" width="32" height="30" rx="3"/><line x1="8" y1="20" x2="40" y2="20"/><line x1="16" y1="5" x2="16" y2="13"/><line x1="32" y1="5" x2="32" y2="13"/>`,
  clock: `<circle cx="24" cy="24" r="17"/><path d="M24 14 L24 24 L32 28"/>`,
  house: `<path d="M8 24 L24 9 L40 24"/><path d="M13 22 L13 40 L35 40 L35 22"/><path d="M24 30 C24 30 19 35 19 38 a5 5 0 0 0 10 0 C29 35 24 30 24 30 Z"/>`,
} as const;

function twSideItem(icon: string, label: string, valueHtml: string): string {
  return (
    `<div style="display:flex;gap:28px;align-items:flex-start;margin-top:60px;">` +
    `<div style="flex:none;width:92px;height:92px;border:4px solid ${TW_CYAN};border-radius:50%;` +
    `display:flex;align-items:center;justify-content:center;background:#ffffff;">${icon}</div>` +
    `<div><div style="font-size:40px;font-weight:800;color:${TW_CYAN};">${label}</div>` +
    `<div style="font-size:37px;color:${TW_CYAN};line-height:1.45;margin-top:6px;">${valueHtml}</div></div></div>`
  );
}

function twCheck(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">` +
    `<circle cx="36" cy="36" r="32" fill="none" stroke="#7ab648" stroke-width="4"/>` +
    `<path d="M21 38 L32 49 L52 26" fill="none" stroke="#7ab648" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

/** 绿色山丘 + 河流风景横幅（装饰性 SVG，复刻版式中的插画带） */
function twLandscape(): string {
  const tree = (x: number, y: number): string =>
    `<rect x="${x - 3}" y="${y}" width="6" height="26" fill="#8a6d3b"/>` +
    `<circle cx="${x}" cy="${y - 10}" r="16" fill="#5f9e38"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="230" viewBox="0 0 1600 230" ` +
    `preserveAspectRatio="none" role="img" aria-label="landscape">` +
    `<path d="M0 118 C200 58 380 140 560 98 C760 52 940 130 1140 88 C1340 52 1500 108 1600 78 L1600 230 L0 230 Z" fill="${TW_GREEN}"/>` +
    `<path d="M0 168 C260 128 420 190 640 158 C880 126 1060 184 1280 152 C1440 132 1560 162 1600 148 L1600 230 L0 230 Z" fill="#6aa929"/>` +
    `<path d="M120 230 C300 186 430 204 570 182 C770 152 910 198 1090 174 C1250 154 1390 182 1490 166 L1600 230 Z" fill="#4aa8d8" opacity="0.9"/>` +
    tree(180, 120) +
    tree(260, 132) +
    tree(1240, 108) +
    tree(1330, 122) +
    `</svg>`
  );
}

function renderThamesWater(vm: BillViewModel, meta: TemplateMeta, opts: RenderOptions): string {
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:35px;color:#1b2327;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const supplyAddressHtml = vm.addressLines
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
  const qr = pseudoQrSvg(vm.qrSeed, { module: 7 });
  const sections = (vm.sections ?? [])
    .map((section) => {
      const rows = section.lines
        .map(
          (line) =>
            `<div style="display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #d7ecf5;">` +
            `<span style="font-size:31px;color:#333c42;">${escapeHtml(line.label)}</span>` +
            `<span style="font-size:31px;font-variant-numeric:tabular-nums;color:#1b2327;">${money(meta, line.amount)}</span></div>`,
        )
        .join("");
      return (
        `<div style="margin-top:34px;">` +
        `<div style="display:flex;justify-content:space-between;align-items:baseline;">` +
        `<span style="font-size:36px;font-weight:800;color:${TW_CYAN};">${escapeHtml(section.title)}</span>` +
        (section.subtitle !== undefined
          ? `<span style="font-size:27px;color:#5a656c;">${escapeHtml(section.subtitle)}</span>`
          : "") +
        `</div><div style="margin-top:8px;">${rows}` +
        `<div style="display:flex;justify-content:space-between;padding:14px 0;">` +
        `<span style="font-size:31px;font-weight:600;color:#5a656c;">${escapeHtml(section.title)} total</span>` +
        `<span style="font-size:33px;font-weight:700;font-variant-numeric:tabular-nums;">${money(meta, section.sectionTotal)}</span></div></div></div>`
      );
    })
    .join("");
  const meter = vm.meterRows[0];
  const howToPayCol = (text: string): string =>
    `<div style="flex:1;display:flex;gap:18px;align-items:flex-start;">${twCheck()}` +
    `<div style="font-size:29px;color:#333c42;line-height:1.55;">${text}</div></div>`;
  const tocItem = (n: number, title: string, desc: string, color: string): string =>
    `<div style="margin-top:44px;"><div style="font-size:38px;font-weight:800;color:${color};">Section ${n}:</div>` +
    `<div style="font-size:38px;font-weight:800;color:${color};">${title}</div>` +
    `<div style="font-size:30px;color:#5a656c;line-height:1.5;margin-top:6px;">${desc}</div></div>`;
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:${UK_FONT};">` +
    `<div style="position:absolute;inset:0;display:flex;">` +
    /* 主栏 */
    `<div style="flex:1;padding:100px 60px 60px 120px;display:flex;flex-direction:column;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 190 190" role="img" aria-label="logo">` +
    `<circle cx="95" cy="95" r="90" fill="${TW_CYAN}"/>` +
    `<circle cx="95" cy="95" r="76" fill="none" stroke="#ffffff" stroke-width="5"/>` +
    `<text x="95" y="88" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="800" fill="#ffffff">Thames</text>` +
    `<text x="95" y="130" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="800" fill="#ffffff">Water</text>` +
    `<path d="M45 152 C62 142 74 160 95 152 C116 144 128 162 145 152" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>` +
    `</svg>` +
    `<div style="text-align:center;"><div style="font-size:26px;color:#5a656c;margin-bottom:8px;">Page 1 of 7</div>${qr}</div></div>` +
    `<div style="margin-top:64px;"><div style="font-size:40px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="margin-top:64px;font-size:96px;font-weight:300;color:${TW_CYAN};">Your latest bill</div>` +
    `<div style="margin-top:44px;">${twLandscape()}</div>` +
    /* 绿色 What to pay 卡 */
    `<div style="background:${TW_GREEN};border-radius:0 0 0 0;padding:44px 56px;display:flex;align-items:center;gap:40px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" viewBox="0 0 110 110">` +
    `<circle cx="55" cy="55" r="50" fill="none" stroke="#ffffff" stroke-width="5"/>` +
    `<path d="M55 24 C55 24 34 54 34 70 a21 21 0 0 0 42 0 C76 54 55 24 55 24 Z" fill="none" stroke="#ffffff" stroke-width="5"/></svg>` +
    `<div><div style="font-size:42px;color:#ffffff;">What to pay</div>` +
    `<div style="font-size:110px;font-weight:300;color:#ffffff;line-height:1.15;font-variant-numeric:tabular-nums;">${money(meta, vm.total)}</div></div></div>` +
    /* 蓝色 When to pay by 卡 */
    `<div style="background:${TW_CYAN};padding:40px 56px;display:flex;align-items:center;gap:40px;border-radius:0 0 18px 18px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="46" fill="none" stroke="#ffffff" stroke-width="5"/>` +
    `<rect x="26" y="32" width="48" height="40" rx="5" fill="none" stroke="#ffffff" stroke-width="5"/>` +
    `<line x1="26" y1="44" x2="74" y2="44" stroke="#ffffff" stroke-width="5"/>` +
    `<line x1="38" y1="26" x2="38" y2="36" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>` +
    `<line x1="62" y1="26" x2="62" y2="36" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/></svg>` +
    `<div><div style="font-size:40px;color:#ffffff;">When to pay by</div>` +
    `<div style="font-size:72px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(vm.dueDate)}</div></div></div>` +
    /* How to pay 面板 */
    `<div style="margin-top:56px;background:${TW_PANEL_BG};border-radius:18px;padding:44px 50px;">` +
    `<div style="font-size:44px;font-weight:300;color:${TW_CYAN};">How to pay</div>` +
    `<div style="font-size:36px;font-weight:700;color:${TW_CYAN};margin-top:10px;">Break your bill into instalments with Direct Debit</div>` +
    `<div style="display:flex;gap:34px;margin-top:30px;">` +
    howToPayCol("Completely automatic, so you won't need to do anything once set up") +
    howToPayCol("Fully flexible, so you choose what day to pay each month") +
    howToPayCol("Reaches us instantly, so you'll never miss a payment") +
    `</div>` +
    `<div style="font-size:28px;color:#333c42;margin-top:28px;">Sign up through your online account at <b style="color:${TW_CYAN};">thameswater.co.uk/myaccount</b></div>` +
    `<div style="font-size:28px;color:#333c42;margin-top:10px;">For other ways to pay, turn to section 3.</div></div>` +
    /* Your charges */
    `<div style="margin-top:56px;"><div style="font-size:44px;font-weight:300;color:${TW_CYAN};">Your charges</div>` +
    (meter !== undefined
      ? `<div style="font-size:29px;color:#5a656c;margin-top:10px;">Meter reading: ${escapeHtml(meter.previous)} → ` +
        `${escapeHtml(meter.current)} (<b style="color:#1b2327;">${escapeHtml(meter.usage)}</b> over the last ${vm.periodDays} days)</div>`
      : "") +
    sections +
    `<div style="display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #d7ecf5;margin-top:10px;">` +
    `<span style="font-size:31px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:31px;font-variant-numeric:tabular-nums;color:#1b2327;">${money(meta, vm.tax)}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:18px 0;align-items:baseline;">` +
    `<span style="font-size:38px;font-weight:800;">Total for this bill</span>` +
    `<span style="font-size:50px;font-weight:800;color:${TW_CYAN};font-variant-numeric:tabular-nums;">${money(meta, vm.total)}</span></div></div>` +
    `<div style="margin-top:auto;padding-top:36px;font-size:26px;color:#a2a9ae;line-height:1.7;">${fictionalNotice()}</div>` +
    `</div>` +
    /* 右侧信息侧栏 */
    `<div style="width:740px;flex:none;background:${TW_SIDEBAR_BG};">` +
    `<div style="background:${TW_CYAN};padding:56px 54px;display:flex;gap:26px;align-items:center;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="86" height="86" viewBox="0 0 48 48">` +
    `<g fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round">${TW_ICONS.person}</g></svg>` +
    `<div><div style="font-size:42px;font-weight:800;color:#ffffff;">Account number</div>` +
    `<div style="font-size:44px;font-weight:800;color:#ffffff;margin-top:4px;">${escapeHtml(vm.accountNumber)}</div></div></div>` +
    `<div style="padding:20px 54px 0;">` +
    twSideItem(twIcon(TW_ICONS.mouse), "For help, visit", `thameswater.co.uk/bill`) +
    twSideItem(twIcon(TW_ICONS.calendar), "Bill date", escapeHtml(vm.billDate)) +
    twSideItem(
      twIcon(TW_ICONS.clock),
      "Billing period",
      `${escapeHtml(vm.periodStart)}<br/>– ${escapeHtml(vm.periodEnd)}`,
    ) +
    twSideItem(twIcon(TW_ICONS.house), "Supply address", supplyAddressHtml) +
    `<div style="margin-top:90px;font-size:50px;font-weight:300;color:${TW_CYAN};">What's in this bill</div>` +
    tocItem(
      1,
      "Estimated water use",
      `A breakdown of your water use over the last ${vm.periodDays} days`,
      TW_CYAN,
    ) +
    tocItem(2, "Your charges", "How we've calculated your payment", "#8aae2a") +
    tocItem(
      3,
      "How to pay",
      "Ways to pay, including how to get financial support if you need it",
      "#d07b2a",
    ) +
    tocItem(
      4,
      "More help",
      "Website links and phone numbers if you need a helping hand",
      "#3a4a8a",
    ) +
    `</div></div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const ukThamesWaterWater: BillTemplate = {
  docType: TW_META.docType,
  regionId: "uk",
  label: "水费账单 · Thames Water 版式",
  kind: "water",
  fields: UK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, TW_META);
    const days = TW_META.periodDays;
    const m3 = 70 + Math.floor(rng() * 150);
    const sewageM3 = round2(m3 * TW_SEWER_FACTOR);
    const prevReading = 900 + Math.floor(rng() * 600);
    const waterUsage = round2(m3 * TW_WATER_RATE);
    const waterStanding = round2((days * TW_WATER_STANDING_P) / 100);
    const sewerUsage = round2(sewageM3 * TW_SEWER_RATE);
    const sewerStanding = round2((days * TW_SEWER_STANDING_P) / 100);
    const waterTotal = round2(waterUsage + waterStanding);
    const sewerTotal = round2(sewerUsage + sewerStanding);
    const subtotal = round2(waterTotal + sewerTotal);
    // 民用水与排污不收 VAT（0%）
    const tax = 0;
    const total = subtotal;
    const sections: ChargeSection[] = [
      {
        title: "Water",
        subtitle: "Metered supply",
        lines: [
          {
            label: `Water usage · ${formatInt(m3)} m³ × £${TW_WATER_RATE.toFixed(3)}/m³`,
            amount: waterUsage,
          },
          {
            label: `Water standing charge · ${days} days × ${TW_WATER_STANDING_P.toFixed(2)}p/day`,
            amount: waterStanding,
          },
        ],
        sectionTotal: waterTotal,
      },
      {
        title: "Sewerage",
        subtitle: `${Math.round(TW_SEWER_FACTOR * 100)}% of metered water`,
        lines: [
          {
            label: `Sewerage usage · ${formatInt(sewageM3)} m³ × £${TW_SEWER_RATE.toFixed(3)}/m³`,
            amount: sewerUsage,
          },
          {
            label: `Sewerage standing charge · ${days} days × ${TW_SEWER_STANDING_P.toFixed(2)}p/day`,
            amount: sewerStanding,
          },
        ],
        sectionTotal: sewerTotal,
      },
    ];
    const charges = sections.flatMap((s) => s.lines);
    return {
      docType: TW_META.docType,
      regionId: "uk",
      kind: "water",
      utilityName: TW_META.utilityName,
      utilityNameZh: TW_META.utilityNameZh,
      tagline: TW_META.tagline,
      currency: TW_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: TW_META.periodDays,
      meterRows: [
        {
          label: "Meter (m³)",
          previous: formatInt(prevReading),
          current: formatInt(prevReading + m3),
          usage: `${formatInt(m3)} m³`,
        },
      ],
      usageSummary: `${formatInt(m3)} m³ · ${days} days`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges,
      sections,
      subtotal,
      taxLabel: "VAT — domestic water & sewerage are zero-rated (0%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Domestic water and sewerage charges carry no VAT — that is why this bill has no tax line.",
        "This is a half-yearly bill; sewerage is billed at 95% of metered water use.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderThamesWater(vm, TW_META, opts);
  },
};
