/**
 * 真实加拿大账单模板组（regionId "canada"，货币 CAD）：
 * - caBcHydroPower   沿海阶梯电价月度单：highlights + auto-pay 框 + 12 期用量柱图 + Step 1/Step 2 阶梯 + GST 5%
 * - caEnmaxPower     能源 + 市政服务合并月结单：账户摘要（上期/已收款/结转）+ 双 section 计价 + GST 5% + 撕线回单
 * - caHydroOnePower  三大信息框（owe/use/due）+ 3 柱用量对比 + HST 13% + 底部付款存根 + OCR 扫描行
 * 三个版式分别学习三张真实加拿大账单参考图的页面结构；机构名为虚构，地区 / 货币为真实（加拿大 / 加元 CAD）。
 */

import { fnv1a, mulberry32 } from "../hash";
import type { BillInput, BillTemplate, BillViewModel, RenderOptions, UsageBar } from "../model";
import {
  addDaysIso,
  buildBase,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  escapeHtml,
  fmtMeta,
  formatDateEn,
  formatInt,
  round2,
  type TemplateMeta,
} from "./common";

/** 与其他区域模板一致的地址字段 schema（同键 / 同序 / 同校验） */
const CA_FIELDS = [
  {
    kind: "text",
    key: "streetNo",
    label: "门牌号",
    placeholder: "142",
    required: true,
    maxLength: 6,
    pattern: /^\d{1,5}$/,
  },
  {
    kind: "text",
    key: "streetName",
    label: "街道名",
    placeholder: "Granville Street",
    required: true,
    maxLength: 50,
  },
  {
    kind: "text",
    key: "city",
    label: "城市",
    placeholder: "Vancouver",
    required: true,
    maxLength: 40,
  },
  {
    kind: "text",
    key: "province",
    label: "省（2 位缩写）",
    placeholder: "BC",
    required: true,
    maxLength: 2,
    pattern: /^[A-Z]{2}$/,
  },
  {
    kind: "text",
    key: "postalCode",
    label: "邮政编码",
    placeholder: "V6B 1A1",
    required: true,
    maxLength: 7,
    pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/,
  },
] as const;

/* ================= 本文件共用的小工具 ================= */

/** 与 common.ts 相同的水印层（private，这里复制一份供自定义外壳使用） */
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

/** 页脚虚构声明（每个外壳的最后一个元素） */
function fictionalFooter(vm: BillViewModel, borderColor = "#e7e4dc"): string {
  return (
    `<div style="margin-top:auto;padding-top:36px;border-top:2px solid ${borderColor};font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>`
  );
}

/** OCR 扫描行：由确定性 hash 派生的等宽数字分组（装饰用，模拟存根机读行） */
function ocrScanLine(vm: BillViewModel, groups: ReadonlyArray<number>): string {
  const rng = mulberry32(
    fnv1a(`caocr::${vm.docType}::${vm.barcodePayload}::${vm.total.toFixed(2)}`),
  );
  return groups
    .map((n) => Array.from({ length: n }, () => `${Math.floor(rng() * 10)}`).join(""))
    .join(" ");
}

const MONTHS_SHORT: ReadonlyArray<string> = [
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
];
const MONTHS_FULL: ReadonlyArray<string> = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "04 Sep 2026" → "2026 September 04" */
function longCaDate(formatted: string): string {
  const [d, mon, y] = formatted.split(" ");
  const idx = MONTHS_SHORT.indexOf(mon ?? "");
  return `${y} ${MONTHS_FULL[idx] ?? mon ?? ""} ${d}`;
}

/** "04 Sep 2026" → "September 4, 2026" */
function usLongDate(formatted: string): string {
  const [d, mon, y] = formatted.split(" ");
  const idx = MONTHS_SHORT.indexOf(mon ?? "");
  return `${MONTHS_FULL[idx] ?? mon ?? ""} ${Number(d)}, ${y}`;
}

/** "04 Sep 2026" → "Sep 4" */
function shortMonDay(formatted: string): string {
  const [d, mon] = formatted.split(" ");
  return `${mon ?? ""} ${Number(d)}`;
}

/** "$148.05" → "$148.⁰⁵"（角标分位，加式账单大金额排版） */
function moneySup(formatted: string): string {
  const dot = formatted.lastIndexOf(".");
  if (dot < 0) return escapeHtml(formatted);
  return (
    `${escapeHtml(formatted.slice(0, dot))}.` +
    `<span style="font-size:0.55em;vertical-align:super;">${escapeHtml(formatted.slice(dot + 1))}</span>`
  );
}

/* ================= 1) 沿海阶梯电价月度单（bc 版式学习） ================= */

const BC_META: TemplateMeta = {
  docType: "ca_bchydro_power",
  regionId: "canada",
  kind: "power",
  utilityName: "Bluefjord Power",
  utilityNameZh: "蓝峡电力",
  tagline: "Fictional coastal electric utility",
  currency: "CAD",
  prefix: "BFP",
  periodDays: 30,
  accent: "#0098c9",
  locale: "en-CA",
};

const BC_NAVY = "#16324f";
const BC_GREEN = "#5b9e37";

/** 双色圆形 logo（青 / 绿半圆 + 白色闪电） */
function bcLogo(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="150" height="150">` +
    `<circle cx="50" cy="50" r="47" fill="${BC_META.accent}"/>` +
    `<path d="M50 3 a47 47 0 0 1 0 94 Z" fill="${BC_GREEN}"/>` +
    `<polygon points="57,16 30,56 47,56 41,84 70,42 53,42" fill="#ffffff"/>` +
    `</svg>`
  );
}

function bcBullet(kind: "check" | "ring"): string {
  const inner =
    kind === "check"
      ? `<circle cx="15" cy="15" r="14" fill="${BC_GREEN}"/><path d="M8.5 15.5 L13.2 20.2 L21.5 10" stroke="#ffffff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="15" cy="15" r="10.5" fill="none" stroke="${BC_META.accent}" stroke-width="4.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30" style="flex:none;margin-top:8px;">${inner}</svg>`;
}

/** 12 期用量柱图：虚线网格 + 左轴刻度 + 本期柱深色 + 图例（Same period last year / Past usage / This period） */
function bcUsageChart(vm: BillViewModel): string {
  if (vm.bars.length === 0) return "";
  const rawMax = Math.max(...vm.bars.map((b) => b.value), 1);
  const niceMax = Math.ceil(rawMax / 10) * 10;
  const plotH = 400;
  const gridLines = [1 / 3, 2 / 3, 1]
    .map((f) => {
      const y = Math.round(plotH * (1 - f));
      return (
        `<div style="position:absolute;left:0;right:0;top:${y}px;border-top:3px dotted #8fb9c9;"></div>` +
        `<div style="position:absolute;left:-70px;top:${y - 18}px;width:56px;text-align:right;font-size:26px;color:#5a656c;">${formatInt(niceMax * f)}</div>`
      );
    })
    .join("");
  const columns = vm.bars
    .map((bar, i) => {
      const h = Math.max(18, Math.round((bar.value / niceMax) * plotH));
      const color = i === vm.bars.length - 1 ? BC_NAVY : BC_META.accent;
      const [mon, day] = bar.label.split("|");
      return (
        `<div style="flex:1;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${plotH}px;">` +
        `<div style="width:72%;height:${h}px;background:${color};"></div>` +
        `<div style="position:absolute;top:${plotH + 14}px;left:0;right:0;text-align:center;font-size:24px;color:#333c42;line-height:1.35;">` +
        `${escapeHtml(mon ?? "")}<br/><b>${escapeHtml(day ?? "")}</b></div></div>`
      );
    })
    .join("");
  const legendItem = (color: string, label: string): string =>
    `<span style="display:inline-flex;align-items:center;gap:12px;font-size:27px;color:#333c42;">` +
    `<span style="width:30px;height:30px;background:${color};"></span>${label}</span>`;
  return (
    `<div style="margin-top:26px;margin-left:70px;">` +
    `<div style="position:relative;height:${plotH}px;border-bottom:3px solid #1b2327;">` +
    `<div style="position:absolute;left:0;right:0;top:0;border-top:3px dotted #8fb9c9;"></div>` +
    gridLines +
    `<div style="position:absolute;left:-190px;top:170px;transform:rotate(-90deg);font-size:26px;color:#5a656c;white-space:nowrap;">Average kWh per day</div>` +
    `<div style="position:absolute;left:0;right:0;top:0;bottom:0;display:flex;gap:18px;align-items:flex-end;">${columns}</div>` +
    `</div>` +
    `<div style="margin-top:150px;display:flex;gap:56px;justify-content:center;">` +
    legendItem("#a9a9a9", "Same period last year") +
    legendItem(BC_META.accent, "Past usage") +
    legendItem(BC_NAVY, "This period") +
    `</div></div>`
  );
}

/** 底部浅色通栏：Ways to pay your bill（图标列表）+ 节能提示（内联 SVG 窗户） */
function bcBottomBand(vm: BillViewModel): string {
  const payIcon = (glyph: string): string =>
    `<span style="width:64px;height:64px;flex:none;border:4px solid ${BC_META.accent};border-radius:10px;` +
    `display:inline-flex;align-items:center;justify-content:center;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="40" height="40">${glyph}</svg></span>`;
  const payRow = (icon: string, html: string): string =>
    `<div style="display:flex;gap:26px;align-items:center;margin-top:26px;">${payIcon(icon)}` +
    `<div style="font-size:29px;color:#333c42;line-height:1.5;">${html}</div></div>`;
  const windowSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" width="220" height="256">` +
    `<rect x="6" y="6" width="108" height="128" fill="#7a4a1f" rx="6"/>` +
    `<rect x="16" y="16" width="40" height="50" fill="#bfe3f2"/><rect x="64" y="16" width="40" height="50" fill="#bfe3f2"/>` +
    `<rect x="16" y="74" width="40" height="50" fill="#d6eef8"/><rect x="64" y="74" width="40" height="50" fill="#d6eef8"/>` +
    `<polygon points="20,60 44,20 54,20 30,60" fill="#ffffff" opacity="0.7"/>` +
    `<polygon points="68,120 92,80 102,80 78,120" fill="#ffffff" opacity="0.7"/>` +
    `</svg>`;
  return (
    `<div style="margin:auto -130px -60px;background:#f5f4ef;padding:60px 130px 100px;border-top:6px solid ${BC_GREEN};">` +
    `<div style="display:flex;gap:110px;">` +
    `<div style="flex:1.25;">` +
    `<div style="font-size:44px;font-weight:800;">Ways to pay your bill</div>` +
    `<div style="font-size:29px;color:#5a656c;margin-top:12px;">We offer several options for you to pay your bill.</div>` +
    payRow(
      `<rect x="4" y="6" width="24" height="16" rx="2" fill="none" stroke="${BC_META.accent}" stroke-width="2.4"/><path d="M12 26 h8 M16 22 v4" stroke="${BC_META.accent}" stroke-width="2.4"/>`,
      `<b>mybluefjord.example</b> – direct withdrawal from your bank account through MyBluefjord (fictional).`,
    ) +
    payRow(
      `<rect x="5" y="8" width="22" height="16" rx="2" fill="none" stroke="${BC_META.accent}" stroke-width="2.4"/><path d="M9 15 l4 4 8-8" stroke="${BC_META.accent}" stroke-width="2.6" fill="none"/>`,
      `<b>Auto-pay</b> – have your bills paid automatically from your bank account.`,
    ) +
    payRow(
      `<path d="M6 24 V14 l10-8 10 8 v10 Z" fill="none" stroke="${BC_META.accent}" stroke-width="2.4"/><rect x="13" y="16" width="6" height="8" fill="${BC_META.accent}"/>`,
      `<b>Online banking</b> – visit your bank's website or pay in person at your local branch.`,
    ) +
    payRow(
      `<rect x="4" y="8" width="24" height="17" rx="3" fill="none" stroke="${BC_META.accent}" stroke-width="2.4"/><rect x="4" y="12" width="24" height="4" fill="${BC_META.accent}"/>`,
      `<b>Credit card</b> – pay through a third-party service provider that charges a service fee.`,
    ) +
    `<div style="margin-top:30px;font-size:27px;color:#333c42;">For more information, visit <b>mybluefjord.example/payments</b> (fictional).</div>` +
    `</div>` +
    `<div style="flex:1;display:flex;gap:44px;">` +
    `<div style="flex:1;">` +
    `<div style="font-size:44px;font-weight:800;">Seal up those gaps</div>` +
    `<div style="font-size:29px;color:#333c42;line-height:1.55;margin-top:14px;">` +
    `Apply draftproofing to drafty gaps around windows and doors to prevent heat loss in the winter, and heat gain in the summer.</div>` +
    `<div style="font-size:29px;color:#333c42;margin-top:18px;">Get more tips at <b>mybluefjord.example/hometips</b></div>` +
    `</div>${windowSvg}</div>` +
    `</div>` +
    `<div style="margin-top:50px;padding-top:30px;border-top:2px solid #d8d4ca;font-size:26px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
    ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
    `</div>`
  );
}

function renderBcHydro(vm: BillViewModel, opts: RenderOptions): string {
  const meta = BC_META;
  const money = (n: number): string => fmtMeta(meta, n);
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:31px;color:#1b2327;line-height:1.45;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const metaCell = (label: string, value: string, bold = false): string =>
    `<div style="padding:0 30px;"><div style="font-size:26px;color:#5a656c;">${label}</div>` +
    `<div style="font-size:31px;font-weight:${bold ? 800 : 600};color:#1b2327;margin-top:4px;">${value}</div></div>`;
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;padding:16px 0;border-bottom:1px solid #e7e4dc;">` +
        `<span style="font-size:31px;color:#333c42;">${escapeHtml(line.label)}</span>` +
        `<span style="font-size:31px;font-variant-numeric:tabular-nums;">${escapeHtml(money(line.amount))}</span></div>`,
    )
    .join("");
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:100px 130px 60px;display:flex;flex-direction:column;">` +
    // 页眉：logo + 机构名 ｜ Service address ｜ 账户元信息表
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:36px;align-items:center;width:560px;flex:none;">${bcLogo()}` +
    `<div><div style="font-size:58px;font-weight:800;color:#1b2327;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:32px;color:#5a656c;margin-top:4px;">${escapeHtml(vm.tagline)}</div></div></div>` +
    `<div style="flex:1;padding-left:40px;"><div style="font-size:26px;color:#5a656c;">Service address</div>` +
    `<div style="font-size:31px;font-weight:800;margin-top:4px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="display:flex;flex:none;">` +
    metaCell("Account number", escapeHtml(vm.accountNumber), true) +
    metaCell("Invoice number", escapeHtml(vm.invoiceNumber), true) +
    metaCell("Billing date", escapeHtml(vm.billDate)) +
    metaCell("Page", "1 of 1") +
    `</div></div>` +
    // Your bill highlights + auto-pay 大蓝框
    `<div style="display:flex;justify-content:space-between;gap:80px;margin-top:64px;">` +
    `<div style="flex:1;">` +
    `<div style="font-size:64px;font-weight:800;color:${meta.accent};">Your bill highlights</div>` +
    `<div style="font-size:38px;font-weight:800;margin-top:18px;">Your bill for ${escapeHtml(usLongDate(vm.periodStart))} to ${escapeHtml(usLongDate(vm.periodEnd))}</div>` +
    `<div style="display:flex;gap:18px;margin-top:26px;align-items:flex-start;">${bcBullet("check")}` +
    `<div style="font-size:31px;color:#333c42;">Thank you for your payment of <b>${escapeHtml(money(round2(vm.total * 0.9)))}</b> on ${escapeHtml(shortMonDay(vm.periodStart))}.</div></div>` +
    `<div style="display:flex;gap:18px;margin-top:20px;align-items:flex-start;">${bcBullet("ring")}` +
    `<div style="font-size:31px;color:#333c42;">To track your electricity usage, visit <b>mybluefjord.example/login</b> (fictional).</div></div>` +
    `</div>` +
    `<div style="width:760px;flex:none;">` +
    `<div style="background:${meta.accent};color:#ffffff;border-radius:6px;padding:44px 52px;">` +
    `<div style="font-size:32px;">Auto-pay amount</div>` +
    `<div style="font-size:96px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;line-height:1.25;">${moneySup(money(vm.total))}</div>` +
    `<div style="font-size:38px;font-weight:800;margin-top:8px;">Withdrawn on or after ${escapeHtml(vm.dueDate)}</div></div>` +
    `<div style="text-align:right;font-size:32px;font-weight:700;color:${meta.accent};margin-top:22px;">Turn for bill details &#8594;</div>` +
    `</div></div>` +
    // 用量区：左侧日均费用 + 柱图，右侧 Did you know 框
    `<div style="display:flex;gap:90px;margin-top:56px;">` +
    `<div style="flex:1.5;">` +
    `<div style="font-size:44px;font-weight:800;">Your electricity usage over time</div>` +
    `<div style="display:flex;gap:22px;margin-top:24px;align-items:stretch;">` +
    `<div style="width:10px;background:${meta.accent};flex:none;"></div>` +
    `<div><div style="font-size:52px;font-weight:800;">${moneySup(money(round2(vm.total / vm.periodDays)))}</div>` +
    `<div style="font-size:29px;color:#333c42;line-height:1.4;">average daily<br/>cost of electricity<br/>this bill period</div></div></div>` +
    bcUsageChart(vm) +
    `</div>` +
    `<div style="flex:1;align-self:flex-start;margin-top:90px;border:2px solid #d8d4ca;padding:40px 44px;">` +
    `<div style="font-size:29px;font-weight:700;color:${BC_GREEN};">Did you know?</div>` +
    `<div style="font-size:42px;font-weight:800;line-height:1.35;margin-top:14px;">You used a total of ${escapeHtml(vm.usageSummary.split(" ")[0] ?? "")} kWh from ${escapeHtml(usLongDate(vm.periodStart))} to ${escapeHtml(usLongDate(vm.periodEnd))}.</div>` +
    `<div style="font-size:29px;color:#333c42;line-height:1.55;margin-top:18px;">` +
    `Use our online tracking tools to view your detailed electricity use by the month, week, day or even hour – up to the previous day. ` +
    `Visit <b>mybluefjord.example/login</b>.</div></div>` +
    `</div>` +
    // Bill details：Step 1 / Step 2 阶梯明细 + GST + total
    `<div style="margin-top:64px;">` +
    `<div style="font-size:36px;font-weight:800;color:${meta.accent};letter-spacing:1px;">Bill details · 账单明细</div>` +
    `<div style="margin-top:10px;">${chargeRows}` +
    `<div style="display:flex;justify-content:space-between;padding:16px 0;border-bottom:1px solid #e7e4dc;">` +
    `<span style="font-size:31px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:31px;font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.tax))}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:20px 0;align-items:baseline;">` +
    `<span style="font-size:38px;font-weight:800;">Total for this bill</span>` +
    `<span style="font-size:52px;font-weight:800;color:${meta.accent};font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.total))}</span></div></div></div>` +
    bcBottomBand(vm) +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const caBcHydroPower: BillTemplate = {
  docType: BC_META.docType,
  regionId: "canada",
  label: "电费账单 · BC Hydro 版式",
  kind: "power",
  fields: CA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, BC_META);
    const kwh = 380 + Math.floor(rng() * 640);
    const previousReading = 30000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + kwh;
    // 参考图为 30 天月结单：Step 1 额度 675 kWh（≈22.5 kWh/天），超出部分按 Step 2
    const step1Qty = Math.min(kwh, 675);
    const step2Qty = Math.max(kwh - 675, 0);
    const basic = round2(BC_META.periodDays * 0.225);
    const step1 = round2(step1Qty * 0.1179);
    const step2 = round2(step2Qty * 0.1762);
    const rider = round2((basic + step1 + step2) * 0.05);
    const subtotal = round2(basic + step1 + step2 + rider);
    const tax = round2(subtotal * 0.05);
    const total = round2(subtotal + tax);
    const dailyAvg = kwh / BC_META.periodDays;
    const periodEndIso = addDaysIso(base.billDateIso, -4);
    const bars: UsageBar[] = [];
    for (let i = 11; i >= 1; i--) {
      const parts = formatDateEn(addDaysIso(periodEndIso, -30 * i)).split(" ");
      bars.push({
        label: `${parts[1] ?? ""}|${`${Number(parts[0])}`}`,
        value: round2(dailyAvg * (0.55 + rng() * 0.9)),
      });
    }
    const endParts = formatDateEn(periodEndIso).split(" ");
    bars.push({
      label: `${endParts[1] ?? ""}|${`${Number(endParts[0])}`}`,
      value: round2(dailyAvg),
    });
    return {
      docType: BC_META.docType,
      regionId: "canada",
      kind: "power",
      utilityName: BC_META.utilityName,
      utilityNameZh: BC_META.utilityNameZh,
      tagline: BC_META.tagline,
      currency: BC_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: BC_META.periodDays,
      meterRows: [
        {
          label: "Meter (kWh)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh · ${BC_META.periodDays} days`,
      bars,
      barUnit: "kWh/day",
      barTitle: "Your electricity usage over time",
      charges: [
        { label: `Basic charge · ${BC_META.periodDays} days × $0.2250/day`, amount: basic },
        { label: `Step 1 · ${formatInt(step1Qty)} kWh × $0.1179`, amount: step1 },
        { label: `Step 2 · ${formatInt(step2Qty)} kWh × $0.1762`, amount: step2 },
        { label: "Rate rider · 5.0% of energy and basic charges", amount: rider },
      ],
      subtotal,
      taxLabel: "GST (5%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Step 1 applies to the first 675 kWh in a 30-day billing period; usage above is billed at Step 2.",
        "Rates are approved by the provincial utilities commission (fictional).",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderBcHydro(vm, opts);
  },
};

/* ================= 2) 能源 + 市政服务合并月结单（enmax 版式学习） ================= */

const EN_META: TemplateMeta = {
  docType: "ca_enmax_power",
  regionId: "canada",
  kind: "power",
  utilityName: "Foothill Arc Utilities",
  utilityNameZh: "山麓弧光公用事业",
  tagline: "Fictional energy & municipal services",
  currency: "CAD",
  prefix: "FAU",
  periodDays: 30,
  accent: "#1c4f8a",
  locale: "en-CA",
};

/** 点线引导行（label .......... amount） */
function enLeaderRow(
  label: string,
  value: string,
  opts?: { bold?: boolean; size?: number },
): string {
  const size = opts?.size ?? 31;
  return (
    `<div style="display:flex;align-items:flex-end;padding:11px 0;">` +
    `<span style="font-size:${size}px;${opts?.bold === true ? "font-weight:700;" : "color:#333c42;"}">${label}</span>` +
    `<span style="flex:1;border-bottom:3px dotted #c3bdae;margin:0 14px 9px;"></span>` +
    `<span style="font-size:${size}px;font-weight:${opts?.bold === true ? 700 : 500};font-variant-numeric:tabular-nums;">${value}</span></div>`
  );
}

/** 斜体弧形 logo（文字 + 弧线 svg） */
function enLogo(width = 300): string {
  return (
    `<span style="display:inline-flex;align-items:center;gap:16px;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="72" height="48">` +
    `<path d="M4 32 a34 34 0 0 1 52 0" fill="none" stroke="#c8322a" stroke-width="6" stroke-linecap="round"/>` +
    `</svg>` +
    `<span style="font-size:${Math.round(width / 7)}px;font-weight:800;font-style:italic;color:${EN_META.accent};letter-spacing:-1px;">Foothill&#8202;Arc</span>` +
    `</span>`
  );
}

/** 虚构市徽块（红色圆角块 + MB；段标题已含城市名，此处不再重复文字） */
function enCityLogo(): string {
  return (
    `<span style="width:64px;height:64px;background:#c8322a;border-radius:10px;display:inline-flex;align-items:center;` +
    `justify-content:center;color:#ffffff;font-size:30px;font-weight:800;">MB</span>`
  );
}

function renderEnmax(vm: BillViewModel, opts: RenderOptions): string {
  const meta = EN_META;
  const money = (n: number): string => fmtMeta(meta, n);
  const s = vm.accountSummary;
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:30px;color:#1b2327;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const sectionHtml = (vm.sections ?? [])
    .map((section, idx) => {
      const rows = section.lines
        .map((line) => enLeaderRow(escapeHtml(line.label), escapeHtml(money(line.amount))))
        .join("");
      return (
        `<div style="margin-top:40px;">` +
        `<div style="display:flex;justify-content:center;position:relative;padding:6px 0 14px;">` +
        `<span style="position:absolute;left:0;top:0;">${idx === 0 ? enLogo(240) : enCityLogo()}</span>` +
        `<span style="font-size:40px;font-weight:800;">${escapeHtml(section.title)}</span></div>` +
        rows +
        `<div style="border-top:3px solid #1b2327;margin-top:6px;">` +
        enLeaderRow("Subtotal", escapeHtml(money(section.sectionTotal)), { bold: true }) +
        `</div></div>`
      );
    })
    .join("");
  const ocr = ocrScanLine(vm, [9, 9, 14, 2]);
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;left:0;top:0;right:0;height:24px;background:${meta.accent};"></div>` +
    `<div style="position:absolute;inset:0;padding:90px 120px 60px;display:flex;flex-direction:column;">` +
    // 页眉：报表标题 + 地址 ｜ 页码 / 户号 / 出账日
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div><div style="font-size:44px;font-weight:800;color:${meta.accent};letter-spacing:1px;">YOUR ENERGY AND UTILITIES STATEMENT</div>` +
    `<div style="margin-top:18px;font-size:30px;font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;font-size:29px;line-height:1.6;flex:none;">` +
    `<div style="color:#5a656c;">PAGE 1 OF 1</div>` +
    `<div style="margin-top:10px;">Account Number: <b>${escapeHtml(vm.accountNumber)}</b></div>` +
    `<div>Current Bill Date: <b>${escapeHtml(longCaDate(vm.billDate))}</b></div></div></div>` +
    // 主体双栏
    `<div style="display:flex;gap:60px;margin-top:44px;">` +
    `<div style="flex:1.55;border:2px solid #c8c4ba;padding:36px 40px;">` +
    `<div style="display:flex;align-items:center;gap:26px;background:#f2f0e9;padding:24px 30px;">` +
    `<span style="width:64px;height:64px;background:#1b2327;color:#ffffff;display:inline-flex;align-items:center;` +
    `justify-content:center;font-size:40px;font-weight:800;flex:none;">$</span>` +
    `<div style="flex:1;display:flex;align-items:flex-end;">` +
    `<span style="font-size:34px;font-weight:800;">Pre Authorized Amount to be Withdrawn ${escapeHtml(shortMonDay(vm.dueDate))}</span>` +
    `<span style="flex:1;border-bottom:3px dotted #9aa29b;margin:0 12px 8px;"></span>` +
    `<span style="font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.total))}</span></div></div>` +
    `<div style="font-size:25px;color:#5a656c;margin-top:14px;line-height:1.5;">` +
    `If payment is received after ${escapeHtml(longCaDate(vm.dueDate))}, the following late payment fees will apply: ` +
    `A one-time late payment fee of 3.25% on Current Charges.</div>` +
    `<div style="font-size:42px;font-weight:800;margin-top:34px;">Summary of Your Account</div>` +
    `<div style="font-size:33px;font-weight:700;margin-top:20px;">Previous Charges and Credits</div>` +
    enLeaderRow("Previous balance", escapeHtml(money(s?.previousBalance ?? 0))) +
    enLeaderRow(
      `Payment we processed on ${escapeHtml(shortMonDay(vm.periodEnd))}. Thank you`,
      `${escapeHtml(money(s?.paymentsReceived ?? 0))} CR`,
    ) +
    `<div style="border-top:3px solid #1b2327;margin-top:4px;">` +
    enLeaderRow(
      "Balance Forward",
      escapeHtml(money(round2((s?.previousBalance ?? 0) - (s?.paymentsReceived ?? 0)))),
      { bold: true },
    ) +
    `</div>` +
    sectionHtml +
    `<div style="border-top:3px solid #1b2327;margin-top:26px;padding-top:6px;">` +
    enLeaderRow(`Total ${escapeHtml(vm.taxLabel)}`, escapeHtml(money(vm.tax))) +
    enLeaderRow("Total Current Charges", escapeHtml(money(vm.total)), { bold: true }) +
    `<div style="border-top:3px solid #1b2327;margin-top:4px;">` +
    enLeaderRow("Total Amount Due", escapeHtml(money(vm.total)), { bold: true, size: 38 }) +
    `</div></div>` +
    `</div>` +
    // 右侧边栏
    `<div style="flex:1;">` +
    `<div style="font-size:26px;color:#5a656c;">You are on:</div>` +
    `<div style="background:${meta.accent};color:#ffffff;font-size:42px;font-weight:800;padding:20px 30px;margin-top:6px;">SteadyPlan<span style="font-size:0.5em;vertical-align:super;">&#174;</span></div>` +
    `<div style="border:2px solid #d8d4ca;border-top:none;padding:26px 30px;font-size:26px;color:#333c42;line-height:1.6;">` +
    `<div style="font-weight:800;">Need help?</div>` +
    `<div>Phone: 310-2010</div>` +
    `<div>Toll Free Outside Alberta: 1-877-555-0110</div>` +
    `<div>Online: foothillarc.example/contact-us</div>` +
    `<div>Monday to Friday 8:00 a.m. to 8:00 p.m.</div>` +
    `<div>Saturday 8:00 a.m. to 4:30 p.m. · Sunday Closed</div>` +
    `<div style="font-weight:800;margin-top:20px;">OUTAGES &amp; EMERGENCIES 24 Hours</div>` +
    `<div>Electricity: Foothill Arc Power: 403-555-0180</div>` +
    `<div>Natural Gas: Maplebrook Gas: 1-800-555-0147</div>` +
    `<div>Water/Wastewater: The City of Maplebrook: 311</div>` +
    `<div style="font-weight:800;margin-top:20px;">METER READINGS</div>` +
    `<div>Electricity: Foothill Arc Power: 403-555-0180</div>` +
    `<div>Natural Gas: Maplebrook Gas: 310-5678</div>` +
    `<div>Water/Wastewater: Foothill Arc Power: 403-555-0180</div></div>` +
    `<div style="border:2px solid #d8d4ca;margin-top:36px;padding:28px 30px;">` +
    `<div style="display:flex;gap:22px;align-items:center;">` +
    `<span style="width:58px;height:58px;background:#1b2327;color:#ffffff;display:inline-flex;align-items:center;` +
    `justify-content:center;font-size:38px;font-weight:800;flex:none;">!</span>` +
    `<span style="font-size:40px;font-weight:800;">Important Notices</span></div>` +
    `<div style="font-size:27px;color:#333c42;line-height:1.6;margin-top:18px;">` +
    `Avoid monthly changes in your energy bills by spreading your payments evenly throughout the year with an Equalized ` +
    `Payment Plan – there are no additional costs to set up equalized payments. Visit foothillarc.example/sign-in or call us at 310-2010.</div></div>` +
    `</div></div>` +
    // 撕线回单
    `<div style="margin-top:auto;">` +
    `<div style="text-align:center;font-size:24px;color:#5a656c;margin-bottom:6px;">Tear off here</div>` +
    `<div style="border-top:4px dashed #9aa29b;position:relative;padding-top:24px;">` +
    `<span style="position:absolute;left:-30px;top:-32px;font-size:42px;color:#9aa29b;">&#9986;</span>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;">` +
    `<div style="display:flex;gap:60px;align-items:center;">${enLogo(280)}` +
    `<div style="font-size:27px;color:#333c42;line-height:1.5;">Return this portion with your payment.<br/>Payable at most financial institutions.</div></div>` +
    `<div style="text-align:right;"><div style="font-size:32px;font-weight:700;">Pre Authorized Amount to be Withdrawn ${escapeHtml(shortMonDay(vm.dueDate))} from credit card</div>` +
    `<div style="font-size:52px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.total))}</div></div></div>` +
    `<div style="margin-top:34px;text-align:center;font-family:'Courier New',monospace;font-size:38px;letter-spacing:6px;color:#1b2327;">${escapeHtml(ocr)}</div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;">` +
    `<div style="font-size:30px;line-height:1.55;"><div style="font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="text-align:right;">` +
    `<div style="display:inline-block;border:3px solid #1b2327;padding:18px 40px;text-align:center;">` +
    `<div style="font-size:28px;font-weight:700;">Amount of Payment</div>` +
    `<div style="font-size:40px;font-weight:800;margin-top:6px;">$</div></div>` +
    `<div style="font-size:32px;font-weight:800;margin-top:16px;">Account Number:&#160;&#160;${escapeHtml(vm.accountNumber)}</div></div></div>` +
    `<div style="text-align:right;font-size:26px;color:#5a656c;margin-top:12px;">EBIL</div>` +
    `</div>` +
    fictionalFooter(vm) +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const caEnmaxPower: BillTemplate = {
  docType: EN_META.docType,
  regionId: "canada",
  label: "电费账单 · ENMAX 版式",
  kind: "power",
  fields: CA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, EN_META);
    const kwh = 420 + Math.floor(rng() * 730);
    const previousReading = 60000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + kwh;
    const gj = 3 + Math.floor(rng() * 9);
    // 双 section：能源（电 + 气，GST 仅计此 section）+ 市政服务（水 / 污水 / 雨水 / 垃圾回收）
    const electricity = round2(120 + kwh * 0.265);
    const naturalGas = round2(28 + gj * 7.2);
    const water = round2(42 + rng() * 20);
    const wastewater = round2(60 + rng() * 28);
    const stormwater = round2(13 + rng() * 6);
    const waste = round2(24 + rng() * 9);
    const energyTotal = round2(electricity + naturalGas);
    const cityTotal = round2(water + wastewater + stormwater + waste);
    const subtotal = round2(energyTotal + cityTotal);
    // GST 5% 只对能源 section 计征；分行展示的 GST 之和与总额精确一致
    const tax = round2(energyTotal * 0.05);
    const elecGst = round2(electricity * 0.05);
    const gasGst = round2(tax - elecGst);
    const total = round2(subtotal + tax);
    const previousBalance = round2(250 + rng() * 550);
    return {
      docType: EN_META.docType,
      regionId: "canada",
      kind: "power",
      utilityName: EN_META.utilityName,
      utilityNameZh: EN_META.utilityNameZh,
      tagline: EN_META.tagline,
      currency: EN_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: EN_META.periodDays,
      meterRows: [
        {
          label: "Electricity meter (kWh)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh · ${gj} GJ gas`,
      bars: [],
      barUnit: "",
      barTitle: "",
      charges: [
        {
          label: `Electricity · ${formatInt(kwh)} kWh (GST ${fmtMeta(EN_META, elecGst)})`,
          amount: electricity,
        },
        { label: `Natural gas · ${gj} GJ (GST ${fmtMeta(EN_META, gasGst)})`, amount: naturalGas },
        { label: "Water treatment and supply", amount: water },
        { label: "Wastewater collection and treatment", amount: wastewater },
        { label: "Stormwater management", amount: stormwater },
        { label: "Waste and recycling", amount: waste },
      ],
      subtotal,
      taxLabel: "GST (5%)",
      tax,
      total,
      accountSummary: {
        previousBalance,
        paymentsReceived: previousBalance,
        currentCharges: total,
      },
      sections: [
        {
          title: `${EN_META.utilityName} Charges`,
          lines: [
            {
              label: `Electricity · ${formatInt(kwh)} kWh (GST: ${fmtMeta(EN_META, elecGst)})`,
              amount: electricity,
            },
            {
              label: `Natural gas · ${gj} GJ (GST: ${fmtMeta(EN_META, gasGst)})`,
              amount: naturalGas,
            },
          ],
          sectionTotal: energyTotal,
        },
        {
          title: "City of Maplebrook Charges",
          lines: [
            { label: "Water treatment and supply", amount: water },
            { label: "Wastewater collection and treatment", amount: wastewater },
            { label: "Stormwater management", amount: stormwater },
            { label: "Waste and recycling", amount: waste },
          ],
          sectionTotal: cityTotal,
        },
      ],
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "GST applies only to energy charges; municipal service charges are not taxed.",
        "Amounts are pre-authorized and will be withdrawn on the due date shown.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderEnmax(vm, opts);
  },
};

/* ================= 3) 三大信息框 + 存根（hydro one 版式学习） ================= */

const HO_META: TemplateMeta = {
  docType: "ca_hydroone_power",
  regionId: "canada",
  kind: "power",
  utilityName: "Greatlake Hydro Networks",
  utilityNameZh: "大湖水电网络",
  tagline: "Fictional electricity distributor",
  currency: "CAD",
  prefix: "GHN",
  periodDays: 30,
  accent: "#0057b8",
  locale: "en-CA",
};

const HO_HEADER = "#3b7dd8";
const HO_GREY = "#a9a9a9";

/** 两行小写粗体字标 + 漩涡 svg */
function hoLogo(scale = 1): string {
  return (
    `<span style="display:inline-flex;align-items:center;gap:${Math.round(20 * scale)}px;">` +
    `<span style="font-size:${Math.round(78 * scale)}px;font-weight:800;color:#1b3a6b;line-height:0.95;letter-spacing:-2px;">greatlake<br/>` +
    `<span style="font-size:${Math.round(40 * scale)}px;letter-spacing:${Math.round(8 * scale)}px;font-weight:700;">HYDRO</span></span>` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="${Math.round(90 * scale)}" height="${Math.round(90 * scale)}">` +
    `<path d="M40 8 a32 32 0 1 1 -22 9" fill="none" stroke="#1b3a6b" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M40 22 a18 18 0 1 0 12 5" fill="none" stroke="#1b3a6b" stroke-width="6" stroke-linecap="round"/>` +
    `</svg></span>`
  );
}

/** 顶部信息框：蓝色标题栏 + 圆角边框 */
function hoPanel(title: string, body: string, flex = "1"): string {
  return (
    `<div style="flex:${flex};border:3px solid #7a9cc6;border-radius:22px;overflow:hidden;">` +
    `<div style="background:${HO_HEADER};color:#ffffff;font-size:33px;font-weight:700;text-align:center;padding:16px 10px;">${title}</div>` +
    `<div style="padding:30px 34px;">${body}</div></div>`
  );
}

/** 3 柱用量对比（去年同期 / 上期 / 本期），本期蓝色 */
function hoUsageBars(vm: BillViewModel): string {
  if (vm.bars.length === 0) return "";
  const max = Math.max(...vm.bars.map((b) => b.value), 1);
  const cols = vm.bars
    .map((bar, i) => {
      const h = Math.max(40, Math.round((bar.value / max) * 330));
      const color = i === vm.bars.length - 1 ? HO_META.accent : HO_GREY;
      const [main, sub] = bar.label.split("|");
      return (
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;">` +
        `<div style="width:64%;height:${h}px;background:${color};display:flex;justify-content:center;padding-top:18px;">` +
        `<span style="font-size:32px;font-weight:700;color:#ffffff;font-variant-numeric:tabular-nums;">${formatInt(bar.value)}<br/>kWh</span></div>` +
        `<div style="font-size:27px;font-weight:700;margin-top:14px;text-align:center;line-height:1.35;">${escapeHtml(main ?? "")}</div>` +
        `<div style="font-size:25px;color:#5a656c;text-align:center;">(${escapeHtml(sub ?? "")})</div></div>`
      );
    })
    .join("");
  return `<div style="display:flex;gap:70px;align-items:flex-end;height:560px;">${cols}</div>`;
}

/** 联系行小图标（圆形描边 + 简单图形） */
function hoContactIcon(glyph: string): string {
  return (
    `<span style="width:76px;height:76px;flex:none;border:4px solid ${HO_HEADER};border-radius:50%;` +
    `display:inline-flex;align-items:center;justify-content:center;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="42" height="42">${glyph}</svg></span>`
  );
}

function renderHydroOne(vm: BillViewModel, opts: RenderOptions): string {
  const meta = HO_META;
  const money = (n: number): string => fmtMeta(meta, n);
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:30px;color:#1b2327;line-height:1.55;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const lastYear = vm.bars[0]?.value ?? 1;
  const current = vm.bars[vm.bars.length - 1]?.value ?? 1;
  const pct = Math.round((Math.abs(current - lastYear) / Math.max(lastYear, 1)) * 100);
  const direction = current >= lastYear ? "increased" : "decreased";
  const [dueMon, dueDay] = shortMonDay(vm.dueDate).split(" ");
  const chargeRows = vm.charges
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e7e4dc;">` +
        `<span style="font-size:29px;color:#333c42;">${escapeHtml(line.label)}</span>` +
        `<span style="font-size:29px;font-variant-numeric:tabular-nums;">${escapeHtml(money(line.amount))}</span></div>`,
    )
    .join("");
  const noticeIcon =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="34" height="34" style="flex:none;margin-top:4px;">` +
    `<rect x="3" y="5" width="24" height="17" rx="4" fill="none" stroke="#7a9cc6" stroke-width="2.6"/>` +
    `<path d="M10 27 l0-5 6 0" fill="none" stroke="#7a9cc6" stroke-width="2.6"/>` +
    `<path d="M8 10 h14 M8 14 h14 M8 18 h9" stroke="#7a9cc6" stroke-width="2.2"/></svg>`;
  const ocr = ocrScanLine(vm, [4, 6, 4, 6, 6]);
  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
    `<div style="position:absolute;inset:0;padding:90px 120px 60px;display:flex;flex-direction:column;">` +
    // 页眉：字标 + Page
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div>${hoLogo(1)}</div>` +
    `<div style="font-size:27px;color:#333c42;">Page 1 of 1</div></div>` +
    // 报表标题 + 账期 ｜ 户号箭头框
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;">` +
    `<div><div style="font-size:58px;font-weight:800;color:${HO_HEADER};">Your Electricity Statement</div>` +
    `<div style="font-size:31px;font-weight:700;margin-top:10px;">For the period of:&#160; ${escapeHtml(usLongDate(vm.periodStart))} - ${escapeHtml(usLongDate(vm.periodEnd))}</div></div>` +
    `<div>` +
    `<div style="display:flex;align-items:stretch;">` +
    `<div style="border:3px solid #1b2327;border-right:none;padding:14px 22px;font-size:27px;color:#1b2327;">Your account number is:</div>` +
    `<div style="width:0;height:0;border-top:31px solid transparent;border-bottom:31px solid transparent;border-left:34px solid #1b2327;align-self:center;"></div>` +
    `<div style="font-size:32px;font-weight:800;padding:14px 0 14px 26px;align-self:center;">${escapeHtml(vm.accountNumber)}</div></div>` +
    `<div style="display:flex;gap:26px;margin-top:10px;font-size:27px;">` +
    `<span style="border:3px solid #1b2327;padding:8px 18px;">This statement is issued on:</span>` +
    `<span style="font-weight:800;align-self:center;">${escapeHtml(usLongDate(vm.billDate))}</span></div>` +
    `</div></div>` +
    // 三大信息框
    `<div style="display:flex;gap:46px;margin-top:44px;">` +
    hoPanel(
      "What do I owe?",
      `<div style="text-align:center;font-size:88px;font-weight:800;font-variant-numeric:tabular-nums;">${moneySup(money(vm.total))}</div>` +
        `<div style="text-align:center;font-size:27px;color:#333c42;margin-top:14px;line-height:1.5;">See reverse for a<br/>summary of your charges</div>`,
    ) +
    hoPanel(
      "How much did I use?",
      `<div style="text-align:center;font-size:27px;color:#333c42;">You powered your home with</div>` +
        `<div style="display:flex;justify-content:center;align-items:center;gap:22px;margin-top:8px;">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 52" width="96" height="84">` +
        `<path d="M4 26 L30 4 L56 26" fill="none" stroke="${HO_HEADER}" stroke-width="6" stroke-linejoin="round"/>` +
        `<path d="M12 24 V48 H48 V24" fill="${HO_HEADER}"/><rect x="25" y="30" width="11" height="18" fill="#ffffff"/>` +
        `</svg>` +
        `<span style="font-size:76px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(vm.usageSummary.split(" ")[0] ?? "")}&#160;<span style="font-size:40px;">kWh</span></span></div>` +
        `<div style="text-align:center;font-size:27px;color:#333c42;margin-top:8px;">of electricity this period</div>`,
    ) +
    hoPanel(
      "When is it due?",
      `<div style="text-align:center;font-size:66px;font-weight:800;line-height:1.2;">${escapeHtml(dueMon ?? "")},<br/>${escapeHtml(dueDay ?? "")}</div>` +
        `<div style="text-align:center;font-size:27px;color:#333c42;margin-top:16px;">Please pay by this date</div>`,
    ) +
    `</div>` +
    // 用量对比 + 须知
    `<div style="display:flex;gap:46px;margin-top:44px;">` +
    hoPanel(
      "What does my electricity usage look like?",
      `<div style="display:flex;gap:50px;">` +
        `<div style="width:300px;flex:none;font-size:30px;line-height:1.55;color:#1b2327;">` +
        `<div>Your average daily usage has <b>${direction} by ${pct}%</b> compared to the same period last year.</div>` +
        `<div style="margin-top:26px;">Find out more by logging into <b>myAccount</b> at www.greatlakehydro.example</div></div>` +
        `<div style="flex:1;">${hoUsageBars(vm)}</div></div>`,
      "1.6",
    ) +
    hoPanel(
      "What do I need to know?",
      `<div style="display:flex;gap:16px;align-items:flex-start;">${noticeIcon}` +
        `<div style="font-size:27px;line-height:1.5;color:#333c42;"><b>Total Ontario support: ${escapeHtml(money(round2(vm.subtotal * 0.117)))}.</b> To learn more about the province's electricity support programs, visit ontario.example/yourelectricitybill (fictional).</div></div>` +
        `<div style="border-top:2px solid #d8d4ca;margin:22px 0;"></div>` +
        `<div style="display:flex;gap:16px;align-items:flex-start;">${noticeIcon}` +
        `<div style="font-size:27px;line-height:1.5;color:#333c42;"><b>Important notice:</b> 2026 delivery rates are now in effect and are reflected on this bill. To learn more, visit greatlakehydro.example/2026Rates (fictional).</div></div>`,
      "1",
    ) +
    `</div>` +
    // 费用摘要（reverse 的精简版）
    `<div style="margin-top:40px;border-left:12px solid ${HO_HEADER};background:#f2f6fb;padding:26px 36px;">` +
    `<div style="font-size:31px;font-weight:800;color:${HO_HEADER};margin-bottom:8px;">Summary of your charges · 费用摘要</div>` +
    chargeRows +
    `<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #d8d4ca;">` +
    `<span style="font-size:29px;color:#333c42;">${escapeHtml(vm.taxLabel)}</span>` +
    `<span style="font-size:29px;font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.tax))}</span></div>` +
    `<div style="display:flex;justify-content:space-between;padding:14px 0;align-items:baseline;">` +
    `<span style="font-size:34px;font-weight:800;">Total amount you owe</span>` +
    `<span style="font-size:46px;font-weight:800;color:${meta.accent};font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.total))}</span></div></div>` +
    // 联系行
    `<div style="display:flex;gap:50px;margin-top:44px;">` +
    `<div style="flex:1;display:flex;gap:20px;align-items:center;">${hoContactIcon(`<path d="M6 6 h12 l8 8 v12 h-20 Z" fill="none" stroke="${HO_HEADER}" stroke-width="2.4"/><path d="M18 6 v8 h8" fill="none" stroke="${HO_HEADER}" stroke-width="2.4"/>`)}` +
    `<div style="font-size:26px;line-height:1.5;">For billing, quick answers and much more, visit <b>www.greatlakehydro.example</b></div></div>` +
    `<div style="flex:1;display:flex;gap:20px;align-items:center;">${hoContactIcon(`<path d="M16 4 L29 27 H3 Z" fill="none" stroke="${HO_HEADER}" stroke-width="2.6"/><path d="M16 12 v7 M16 23 v1" stroke="${HO_HEADER}" stroke-width="2.8"/>`)}` +
    `<div style="font-size:26px;line-height:1.5;">For emergencies or reporting outages<br/><b>1-800-555-0135</b> (24 hrs)</div></div>` +
    `<div style="flex:1;display:flex;gap:20px;align-items:center;">${hoContactIcon(`<path d="M8 5 c10 0 19 9 19 19 l-6 2 c-3-3-6-6-9-9 Z" fill="none" stroke="${HO_HEADER}" stroke-width="2.4"/>`)}` +
    `<div style="font-size:26px;line-height:1.5;">For service inquiries and payment<br/><b>1-888-555-0176</b><br/>Mon to Fri 7:30 a.m. - 8 p.m.</div></div>` +
    `<div style="flex:1;display:flex;gap:20px;align-items:center;">${hoContactIcon(`<rect x="4" y="8" width="24" height="17" rx="2" fill="none" stroke="${HO_HEADER}" stroke-width="2.4"/><path d="M4 10 L16 19 L28 10" fill="none" stroke="${HO_HEADER}" stroke-width="2.4"/>`)}` +
    `<div style="font-size:26px;line-height:1.5;">${escapeHtml(vm.utilityName)} Inc.<br/>PO Box 5700<br/>Maplebrook, ON N4P 2K1</div></div>` +
    `</div>` +
    // 付款存根
    `<div style="margin-top:auto;">` +
    `<div style="display:flex;justify-content:space-between;font-size:28px;color:#333c42;border-top:2px solid #d8d4ca;padding-top:22px;">` +
    `<span>Please return this slip with your payment.</span>` +
    `<span>Your account number: <b>${escapeHtml(vm.accountNumber)}</b></span></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px;">` +
    `<div>${hoLogo(0.7)}</div>` +
    `<div style="display:flex;gap:80px;align-items:flex-end;">` +
    `<div style="font-size:31px;font-weight:700;">Total amount you owe</div>` +
    `<div style="font-size:40px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(money(vm.total))}</div></div>` +
    `<div style="display:flex;gap:26px;align-items:center;">` +
    `<span style="font-size:29px;">Amount enclosed</span>` +
    `<span style="width:340px;height:92px;border:3px solid #1b2327;display:inline-flex;align-items:center;padding:0 24px;font-size:40px;font-weight:700;">$</span></div></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:34px;">` +
    `<div style="font-size:29px;line-height:1.6;"><div style="font-weight:700;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="font-size:29px;line-height:1.6;">${escapeHtml(vm.utilityName.toUpperCase())} INC.<br/>PO BOX 4102 STN A<br/>MAPLEBROOK ON N4P 2K1</div></div>` +
    `<div style="margin-top:36px;font-family:'Courier New',monospace;font-size:36px;letter-spacing:4px;color:#1b2327;">${escapeHtml(ocr)}</div>` +
    `</div>` +
    fictionalFooter(vm) +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const caHydroOnePower: BillTemplate = {
  docType: HO_META.docType,
  regionId: "canada",
  label: "电费账单 · Hydro One 版式",
  kind: "power",
  fields: CA_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, HO_META);
    const kwh = 500 + Math.floor(rng() * 700);
    const previousReading = 80000 + Math.floor(rng() * 20000);
    const currentReading = previousReading + kwh;
    const lastYearKwh = 400 + Math.floor(rng() * 700);
    const prevPeriodKwh = 400 + Math.floor(rng() * 700);
    // 安大略式拆分：电能量 + 配送 + 监管，HST 13%
    const electricity = round2(kwh * 0.109);
    const delivery = round2(36.5 + kwh * 0.0312);
    const regulatory = round2(3.2 + kwh * 0.0042);
    const subtotal = round2(electricity + delivery + regulatory);
    const tax = round2(subtotal * 0.13);
    const total = round2(subtotal + tax);
    return {
      docType: HO_META.docType,
      regionId: "canada",
      kind: "power",
      utilityName: HO_META.utilityName,
      utilityNameZh: HO_META.utilityNameZh,
      tagline: HO_META.tagline,
      currency: HO_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: HO_META.periodDays,
      meterRows: [
        {
          label: "Meter (kWh)",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} kWh · ${HO_META.periodDays} days`,
      bars: [
        { label: `Same period last year|${HO_META.periodDays} days`, value: lastYearKwh },
        { label: `Previous period|${HO_META.periodDays} days`, value: prevPeriodKwh },
        { label: `Current month|${HO_META.periodDays} days`, value: kwh },
      ],
      barUnit: "kWh",
      barTitle: "What does my electricity usage look like?",
      charges: [
        { label: `Electricity used · ${formatInt(kwh)} kWh × $0.1090`, amount: electricity },
        {
          label: `Delivery charge · $36.50 + ${formatInt(kwh)} kWh × $0.0312`,
          amount: delivery,
        },
        {
          label: `Regulatory charges · $3.20 + ${formatInt(kwh)} kWh × $0.0042`,
          amount: regulatory,
        },
      ],
      subtotal,
      taxLabel: "HST (13%)",
      tax,
      total,
      barcodePayload: base.invoiceNumber.replaceAll("-", ""),
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "A fictional provincial support credit may apply to eligible residential accounts.",
        "Rates shown are decorative and part of a layout study only.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderHydroOne(vm, opts);
  },
};
