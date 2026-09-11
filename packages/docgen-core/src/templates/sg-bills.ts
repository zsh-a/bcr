/**
 * 真实地区「新加坡 Singapore」（货币 SGD）：新加坡电信账单流派（Singtel 版式复刻）。
 * - sg_singtel_telecom  Singtel：版式与品牌信息按参考图对齐——左侧品牌栏
 *   （5 颗递升红圆点 + Singtel 字标、变高条码、客户地址、eBill QR 推广、
 *   App/帮助/热线三块），右侧浅灰「My Bill Overview」面板（白色圆角标题条、
 *   账户元信息 + Total Due 大数字 + Outstanding / Current Charges +
 *   「My Monthly Charges」三月三色横向条形图 + 注册号小字 + Next Page），
 *   下方「My Bill Details」按 Mobile / Fibre Broadband / TV 分 section 计价
 *   （GST 9% 外加），底部红色点线撕线 Payment Slip（双条码 + 灰底白填写框 +
 *   Page 1 of 3），GIRO 自动转账提示。
 * 地址字段为新加坡式组屋地址（blockStreet / unitNo / postalCode）。
 */

import { code128Svg, encodeCode128B } from "../barcode";
import { fnv1a, mulberry32 } from "../hash";
import type {
  BillInput,
  BillTemplate,
  BillViewModel,
  ChargeSection,
  RenderOptions,
} from "../model";
import { pseudoQrSvg } from "../pseudoqr";
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

const SG_TELECOM_FIELDS = [
  {
    kind: "text",
    key: "blockStreet",
    label: "座号 + 街道",
    placeholder: "Blk 128 Bishan Street 12",
    required: true,
    maxLength: 60,
  },
  {
    kind: "text",
    key: "unitNo",
    label: "单位号",
    placeholder: "#12-34",
    required: true,
    maxLength: 8,
    pattern: /^#\d{2}-\d{2}$/,
  },
  {
    kind: "text",
    key: "postalCode",
    label: "邮编",
    placeholder: "570128",
    required: true,
    maxLength: 6,
    pattern: /^\d{6}$/,
  },
] as const;

const SINGTEL_META: TemplateMeta = {
  docType: "sg_singtel_telecom",
  regionId: "singapore",
  kind: "telecom",
  utilityName: "Singtel",
  utilityNameZh: "新加坡电信",
  tagline: "",
  currency: "SGD",
  prefix: "MDT",
  periodDays: 30,
  accent: "#ed193d",
  locale: "en-SG",
};

/** 「My Monthly Charges」三色平涂条（参考图：新→旧由浅至深，直角） */
const BAR_SHADES = ["#2bb7d8", "#0099b5", "#006b8c"] as const;
/** 右侧概览面板底色 */
const PANEL_BG = "#f3f4f4";

const MONTH_ABBR = [
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

/** 水印层（复制自 common.ts 的私有实现，本文件为自定义版式） */
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

/** 账单号：12 位数字（"000" + 户号截取），用于头部条码与回单条码 */
function billIdOf(vm: BillViewModel): string {
  return `000${vm.accountNumber.slice(1, 10)}`;
}

/**
 * 品牌标志：5 颗红色圆点递升排列成弧形（参考图标志），置于字标上方。
 * 圆点由左小右大，最高点在字标中部偏右。
 */
function logoDots(accent: string): string {
  const dots = [
    { cx: 100, cy: 78, r: 20 },
    { cx: 180, cy: 40, r: 26 },
    { cx: 262, cy: 20, r: 30 },
    { cx: 336, cy: 32, r: 30 },
    { cx: 412, cy: 72, r: 35 },
  ];
  const circles = dots
    .map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${accent}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="100" viewBox="0 0 460 100" ` +
    `role="img" aria-label="logo">${circles}</svg>`
  );
}

/**
 * 头部条码：参考图为变高条码（条高不一、底部对齐、无读数）。
 * 用 Code128 模块序列定条位，条高由 payload hash 确定性派生。
 */
function waveBarcode(text: string): string {
  const modules = encodeCode128B(text);
  const rng = mulberry32(fnv1a(`wave::${text}`));
  const mw = 2;
  const full = 72;
  const quiet = 8;
  const totalWidth = (modules.length + quiet * 2) * mw;
  const rects: string[] = [];
  let run = -1;
  for (let i = 0; i <= modules.length; i++) {
    const bit = modules[i] ?? 0;
    if (bit === 1 && run < 0) run = i;
    if (bit === 0 && run >= 0) {
      const h = rng() < 0.5 ? full : Math.round(full * (0.45 + rng() * 0.3));
      rects.push(
        `<rect x="${(run + quiet) * mw}" y="${full - h}" width="${(i - run) * mw}" height="${h}" fill="#101418"/>`,
      );
      run = -1;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${full}" ` +
    `viewBox="0 0 ${totalWidth} ${full}" role="img" aria-label="barcode">${rects.join("")}</svg>`
  );
}

/** 左栏 App 推广图标：红色圆角块 + 白色小圆点与字标（参考图第一个图标） */
function appIcon(accent: string): string {
  const dots =
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="22" viewBox="0 0 72 26">` +
    `<circle cx="6" cy="18" r="4" fill="#ffffff"/><circle cx="22" cy="11" r="5" fill="#ffffff"/>` +
    `<circle cx="39" cy="7" r="5.5" fill="#ffffff"/><circle cx="56" cy="7" r="5.5" fill="#ffffff"/>` +
    `<circle cx="68" cy="12" r="4.5" fill="#ffffff"/></svg>`;
  return (
    `<div style="width:100px;height:100px;border-radius:20px;background:${accent};flex:none;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;">${dots}` +
    `<div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Singtel</div></div>`
  );
}

/** 无底色红色图形（参考图的 "?" 与电话图标直接以红色呈现） */
function plainIcon(inner: string): string {
  return `<div style="width:100px;flex:none;display:flex;align-items:center;justify-content:center;">${inner}</div>`;
}

function promoGlyphs(accent: string): { help: string; phone: string } {
  const help = `<span style="font-size:80px;font-weight:800;color:${accent};line-height:1;">?</span>`;
  const phone =
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24">` +
    `<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1` +
    `C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" fill="${accent}"/></svg>`;
  return { help, phone };
}

/** 左栏：logo + 变高条码 + 客户地址 + eBill 推广（伪 QR）+ App/帮助/热线 */
function leftColumn(vm: BillViewModel, meta: TemplateMeta): string {
  const addressHtml = vm.addressLines
    .map((line) => (/^\d{6}$/.test(line) ? `SINGAPORE ${line}` : line))
    .map(
      (line) =>
        `<div style="font-size:40px;color:#1b2327;line-height:1.3;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const billId = billIdOf(vm);
  const qr = pseudoQrSvg(vm.qrSeed, { module: 7 });
  const glyphs = promoGlyphs(meta.accent);
  const promoRow = (icon: string, html: string): string =>
    `<div style="display:flex;gap:44px;align-items:center;margin-top:24px;">${icon}` +
    `<div style="font-size:38px;color:#1b2327;line-height:1.45;">${html}</div></div>`;
  return (
    `<div style="width:915px;flex:none;padding-left:260px;padding-top:110px;">` +
    logoDots(meta.accent) +
    `<div style="font-size:170px;font-weight:800;letter-spacing:-6px;color:#1b2327;line-height:1.1;margin-top:2px;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="margin-top:70px;">${waveBarcode(billId)}</div>` +
    `<div style="margin-top:24px;">` +
    `<div style="font-size:40px;color:#1b2327;line-height:1.3;">${escapeHtml(vm.customerName)}</div>` +
    `${addressHtml}</div>` +
    `<div style="display:flex;gap:60px;align-items:flex-start;margin-top:490px;padding-left:65px;">` +
    `<div style="font-size:52px;color:#1b2327;line-height:1.35;">Have you switched<br/>to eBill?` +
    `<div style="font-size:42px;color:${meta.accent};margin-top:14px;line-height:1.4;">Find out more on<br/>singtel.com/eBill</div></div>` +
    `<div style="flex:none;margin-top:-14px;">${qr}</div></div>` +
    `<div style="margin-top:418px;padding-left:95px;">` +
    promoRow(
      appIcon(meta.accent),
      `<b>Pay your bills with<br/>My Singtel app<br/>anytime, anywhere.</b>`,
    ) +
    promoRow(plainIcon(glyphs.help), `Understand your bill.<br/><b>singtel.com/billexplainer</b>`) +
    promoRow(
      plainIcon(glyphs.phone),
      `For bill enquiries.<br/><b>1800 738 3330</b><br/>(24-hrs automated helpline)`,
    ) +
    `</div></div>`
  );
}

/** 概览面板的元信息对：常规灰 label + 粗体深色 value（纵向堆叠） */
function metaPair(label: string, value: string): string {
  return (
    `<div style="margin-top:12px;">` +
    `<div style="font-size:30px;color:#333c42;">${label}</div>` +
    `<div style="font-size:38px;font-weight:700;color:#1b2327;margin-top:2px;">${value}</div></div>`
  );
}

/** 「My Monthly Charges」横向条形图（近 3 期，新→旧；三色平涂、直角） */
function monthlyBars(vm: BillViewModel): string {
  if (vm.bars.length === 0) return "";
  const max = Math.max(...vm.bars.map((b) => b.value), 1);
  const rows = vm.bars
    .map((bar, idx) => {
      const width = Math.max(14, Math.round((bar.value / max) * 100));
      const color = BAR_SHADES[idx % BAR_SHADES.length] ?? BAR_SHADES[0];
      return (
        `<div style="display:flex;align-items:center;margin-top:22px;">` +
        `<div style="width:104px;flex:none;font-size:40px;color:#1b2327;">${escapeHtml(bar.label)}</div>` +
        `<div style="flex:1;"><div style="width:${width}%;height:58px;background:${color};` +
        `display:flex;align-items:center;padding-left:24px;color:#ffffff;font-size:36px;` +
        `font-variant-numeric:tabular-nums;">${bar.value.toFixed(2)}</div></div></div>`
      );
    })
    .join("");
  return (
    `<div style="margin-top:987px;">` +
    `<div style="font-size:50px;font-weight:800;color:#1b2327;">My Monthly Charges</div>${rows}</div>`
  );
}

/** 右栏浅灰「My Bill Overview」面板：白底圆角标题条 + 元信息 + 大金额 + 月度条形图 */
function overviewPanel(vm: BillViewModel): string {
  const billId = billIdOf(vm);
  const outstanding =
    vm.accountSummary !== undefined
      ? round2(vm.accountSummary.previousBalance - vm.accountSummary.paymentsReceived)
      : 0;
  const arrow =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="50" viewBox="0 0 72 56">` +
    `<path d="M0 18h40v-14l32 24-32 24v-14H0z" fill="#1b2327"/></svg>`;
  return (
    `<div style="flex:1;background:${PANEL_BG};border-radius:60px 200px 0 0;padding:100px 85px 36px 115px;">` +
    `<div style="display:inline-block;background:#ffffff;border-radius:56px;padding:18px 60px 18px 40px;width:700px;box-sizing:border-box;">` +
    `<span style="font-size:52px;font-weight:800;color:#1b2327;">My Bill Overview</span></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:80px;">` +
    `<div>` +
    metaPair("Account No.", escapeHtml(vm.accountNumber)) +
    metaPair("Bill ID", escapeHtml(billId)) +
    metaPair("Bill Date", escapeHtml(vm.billDate)) +
    metaPair("Bill Period", `${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}`) +
    `</div>` +
    `<div style="text-align:right;flex:none;margin-top:16px;">` +
    `<div style="font-size:42px;color:#1b2327;">Total Due (${escapeHtml(vm.currency)})</div>` +
    `<div style="font-size:96px;font-weight:800;color:#1b2327;font-variant-numeric:tabular-nums;line-height:1.2;">` +
    `${vm.total.toFixed(2)}</div></div></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:100px;">` +
    `<span style="font-size:48px;font-weight:800;color:#1b2327;">Outstanding Amount</span>` +
    `<span style="font-size:46px;font-weight:700;font-variant-numeric:tabular-nums;">${outstanding.toFixed(2)}</span></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:70px;">` +
    `<div><div style="font-size:48px;font-weight:800;color:#1b2327;">Current Charges</div>` +
    `<div style="font-size:34px;font-style:italic;color:#1b2327;margin-top:6px;">Due by ${escapeHtml(vm.dueDate)}</div></div>` +
    `<span style="font-size:46px;font-weight:700;font-variant-numeric:tabular-nums;">${vm.total.toFixed(2)}</span></div>` +
    monthlyBars(vm) +
    `<div style="margin-top:60px;font-size:28px;font-weight:700;color:#1b2327;line-height:1.55;">` +
    `<div>Singapore Telecommunications Limited</div>` +
    `<div>Registration no.: 199201624D</div>` +
    `<div>Tax Invoice GST Registration No.: MR-8500432-2</div></div>` +
    `<div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:30px;">` +
    `<span style="font-size:32px;font-style:italic;color:#5a656c;">Next Page</span>${arrow}</div>` +
    `</div>`
  );
}

/** 「My Bill Details」：按服务分 section 计价 + GST 汇总（参考图后续页内容，收于本页中部） */
function billDetails(vm: BillViewModel, meta: TemplateMeta): string {
  const sections = (vm.sections ?? [])
    .map((section) => {
      const rows = section.lines
        .map(
          (line) =>
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e7e4dc;">` +
            `<span style="font-size:26px;color:#333c42;">${escapeHtml(line.label)}</span>` +
            `<span style="font-size:26px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, line.amount))}</span></div>`,
        )
        .join("");
      return (
        `<div style="margin-top:8px;">` +
        `<div style="display:flex;justify-content:space-between;align-items:baseline;background:${PANEL_BG};` +
        `border-left:10px solid ${meta.accent};padding:7px 26px;border-radius:0 12px 12px 0;">` +
        `<span style="font-size:29px;font-weight:700;">${escapeHtml(section.title)}</span>` +
        (section.subtitle !== undefined
          ? `<span style="font-size:26px;color:#5a656c;font-family:'Courier New',monospace;">${escapeHtml(section.subtitle)}</span>`
          : "") +
        `</div>` +
        `<div style="padding:2px 26px 0;">${rows}` +
        `<div style="display:flex;justify-content:space-between;padding:6px 0;">` +
        `<span style="font-size:25px;font-weight:600;color:#5a656c;">Section total · 小计</span>` +
        `<span style="font-size:27px;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, section.sectionTotal))}</span></div></div></div>`
      );
    })
    .join("");
  const sumRow = (label: string, value: string, strong: boolean): string =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;` +
    `${strong ? "margin-top:8px;padding-top:8px;border-top:3px solid #1b2327;" : "margin-top:4px;"}">` +
    `<span style="font-size:${strong ? 33 : 28}px;${strong ? "font-weight:700;" : "color:#5a656c;"}">${label}</span>` +
    `<span style="font-size:${strong ? 42 : 31}px;font-weight:${strong ? 800 : 500};` +
    `font-variant-numeric:tabular-nums;${strong ? `color:${meta.accent};` : ""}">${value}</span></div>`;
  return (
    `<div style="margin-top:8px;padding:0 150px 0 260px;">` +
    `<div style="font-size:32px;font-weight:800;color:#1b2327;">My Bill Details` +
    `<span style="font-size:29px;font-weight:400;color:#8a9298;margin-left:20px;">费用明细 · 按服务分项</span></div>` +
    sections +
    `<div style="margin-top:6px;display:flex;justify-content:flex-end;">` +
    `<div style="width:900px;">` +
    sumRow("Charges before tax · 税前小计", escapeHtml(fmtMeta(meta, vm.subtotal)), false) +
    sumRow(escapeHtml(vm.taxLabel), escapeHtml(fmtMeta(meta, vm.tax)), false) +
    sumRow("Total for this bill · 本期总额", escapeHtml(fmtMeta(meta, vm.total)), true) +
    `</div></div></div>`
  );
}

/** 底部红色点线撕线 Payment Slip：回邮地址 + 应付金额 + 双条码 + 灰底白填写框 */
function paymentSlip(vm: BillViewModel): string {
  const billId = billIdOf(vm);
  const barcode1 = code128Svg(billId, { moduleWidth: 2.4, height: 64 });
  const cents = `${Math.round(vm.total * 100)}`.padStart(8, "0");
  const barcode2 = code128Svg(`${cents}B`, { moduleWidth: 3, height: 64 });
  const box = (value: string): string =>
    `<div style="background:#ffffff;border-radius:4px;padding:10px 34px;font-size:34px;color:#1b2327;` +
    `min-height:44px;white-space:nowrap;">${value}</div>`;
  return (
    `<div style="margin-top:auto;">` +
    `<div style="border-top:6px dotted #ed193d;position:relative;">` +
    `<span style="position:absolute;right:100px;top:22px;font-size:34px;font-weight:700;color:#1b2327;">0000</span></div>` +
    `<div style="display:flex;align-items:flex-start;">` +
    `<div style="width:880px;flex:none;padding-left:300px;padding-top:132px;">` +
    `<div style="font-size:42px;font-weight:700;color:#1b2327;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:36px;color:#1b2327;line-height:1.45;margin-top:6px;">` +
    `BRAS BASAH POST OFFICE<br/>PO BOX 294<br/>SINGAPORE 911810</div>` +
    `<div style="margin-top:18px;font-size:38px;font-weight:700;color:#1b2327;">Payment Slip</div>` +
    `<div style="font-size:30px;color:#1b2327;margin-top:4px;">Mail us this portion with your cheque payment.</div>` +
    `<div style="font-size:30px;color:#1b2327;margin-top:2px;">Total Due</div>` +
    `<div style="font-size:72px;font-weight:800;color:#1b2327;font-variant-numeric:tabular-nums;line-height:1.15;">` +
    `${escapeHtml(vm.currency)}${vm.total.toFixed(2)}</div>` +
    `<div style="font-size:30px;font-weight:700;color:#1b2327;white-space:nowrap;">` +
    `Due date for Current Charges ${escapeHtml(vm.dueDate)}</div></div>` +
    `<div style="flex:1;height:536px;box-sizing:border-box;background:${PANEL_BG};border-radius:0 0 0 200px;padding:177px 150px 44px 90px;">` +
    `<div style="display:flex;gap:30px;">` +
    `<div style="flex:1.4;">${box(escapeHtml(vm.customerName))}</div>` +
    `<div style="flex:1;">${box(`Acc. No: ${escapeHtml(vm.accountNumber)}`)}</div></div>` +
    `<div style="display:flex;gap:30px;margin-top:43px;">` +
    `<div style="flex:1.4;">${box("Bank")}</div>` +
    `<div style="flex:1;">${box("Cheque No.")}</div></div>` +
    `</div></div>` +
    `<div style="display:flex;align-items:flex-end;margin-top:53px;padding:6px 150px 91px 290px;">` +
    `<div>${barcode1}` +
    `<div style="font-size:36px;letter-spacing:8px;color:#1b2327;margin-top:12px;font-family:'Courier New',monospace;white-space:nowrap;">` +
    `${escapeHtml(billId)}&#160;&#160;&#160;T101&#160;&#160;${escapeHtml(vm.accountNumber)}</div></div>` +
    `<div style="margin-left:200px;">${barcode2}` +
    `<div style="font-size:36px;letter-spacing:8px;color:#1b2327;margin-top:12px;font-family:'Courier New',monospace;white-space:nowrap;">` +
    `${escapeHtml(cents)}B</div></div>` +
    `<div style="flex:1;text-align:right;font-size:34px;letter-spacing:6px;color:#1b2327;padding-bottom:6px;white-space:nowrap;">Page&#160;&#160;1&#160;&#160;of&#160;&#160;3</div>` +
    `</div>` +
    `</div>`
  );
}

export const sgSingtelTelecom: BillTemplate = {
  docType: SINGTEL_META.docType,
  regionId: "singapore",
  label: "电信账单 · Singtel 版式",
  kind: "telecom",
  fields: SG_TELECOM_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, SINGTEL_META);
    const iddMinutes = 5 + Math.floor(rng() * 120);
    const mobileNo = `9${Array.from({ length: 7 }, () => `${Math.floor(rng() * 10)}`).join("")}`;
    const mobilePlan = round2(15 + rng() * 20);
    const idd = round2(iddMinutes * 0.22);
    const broadband = round2(39.9 + rng() * 15);
    const tv = round2(12 + rng() * 18);
    const mobileSection: ChargeSection = {
      title: "Mobile · 移动服务",
      subtitle: `Mobile ${mobileNo.slice(0, 4)} ${mobileNo.slice(4)}`,
      lines: [
        { label: `Mobile plan · 60 GB monthly subscription`, amount: mobilePlan },
        { label: `IDD voice usage · ${formatInt(iddMinutes)} mins × SGD 0.22/min`, amount: idd },
      ],
      sectionTotal: round2(mobilePlan + idd),
    };
    const broadbandSection: ChargeSection = {
      title: "Fibre Broadband · 光纤宽带",
      subtitle: "Fibre 1 Gbps",
      lines: [{ label: "Fibre broadband 1 Gbps · monthly subscription", amount: broadband }],
      sectionTotal: broadband,
    };
    const tvSection: ChargeSection = {
      title: "TV · 电视",
      subtitle: "Entertainment pack",
      lines: [{ label: "TV entertainment pack · monthly subscription", amount: tv }],
      sectionTotal: tv,
    };
    const sections = [mobileSection, broadbandSection, tvSection];
    const charges = sections.flatMap((s) => s.lines);
    const subtotal = round2(sections.reduce((sum, s) => sum + s.sectionTotal, 0));
    const tax = round2(subtotal * 0.09);
    const total = round2(subtotal + tax);
    // 参考图 Outstanding = 0：上期已全额缴清（previousBalance == paymentsReceived）
    const previousBalance = round2(20 + rng() * 80);
    // 「My Monthly Charges」三月条形图：本期 + 前两期（本期账期结束月为当前月）
    const periodEndMonth = base.periodEnd.slice(3, 6);
    const monthIdx = Math.max(0, MONTH_ABBR.indexOf(periodEndMonth as (typeof MONTH_ABBR)[number]));
    const monthLabel = (offset: number): string =>
      MONTH_ABBR[(monthIdx - offset + 36) % 12] ?? "???";
    const bars = [
      { label: monthLabel(0), value: total },
      { label: monthLabel(1), value: round2(total * (0.85 + rng() * 0.4)) },
      { label: monthLabel(2), value: round2(total * (0.85 + rng() * 0.4)) },
    ];
    return {
      docType: SINGTEL_META.docType,
      regionId: "singapore",
      kind: "telecom",
      utilityName: SINGTEL_META.utilityName,
      utilityNameZh: SINGTEL_META.utilityNameZh,
      tagline: SINGTEL_META.tagline,
      currency: SINGTEL_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: SINGTEL_META.periodDays,
      meterRows: [],
      usageSummary: `${formatInt(iddMinutes)} IDD mins`,
      bars,
      barUnit: SINGTEL_META.currency,
      barTitle: "My Monthly Charges",
      charges,
      sections,
      subtotal,
      taxLabel: "GST (9%)",
      tax,
      total,
      accountSummary: {
        previousBalance,
        paymentsReceived: previousBalance,
        currentCharges: total,
      },
      barcodePayload: `000${base.accountNumber.slice(1, 10)}`,
      qrSeed: `${base.invoiceNumber}|${total.toFixed(2)}|${base.dueDate}`,
      notes: [
        "Pay by GIRO for a fuss-free experience — deductions are made on the due date.",
        "GST is charged at the prevailing 9% rate on all services.",
        "This is a multi-page bill; per-service itemised details continue on the following pages.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return (
      `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
      `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
      `<div style="position:absolute;inset:0;padding-top:40px;display:flex;flex-direction:column;">` +
      `<div style="display:flex;align-items:stretch;">` +
      leftColumn(vm, SINGTEL_META) +
      overviewPanel(vm) +
      `</div>` +
      // 参考图首屏到这里结束；明细页另行排版，不能挤入首屏的付款回条区域。
      paymentSlip(vm) +
      `<div style="margin:2px 150px 0 260px;padding-top:4px;border-top:2px solid #e7e4dc;font-size:20px;color:#a2a9ae;line-height:1.6;white-space:nowrap;">` +
      `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。</div>` +
      `</div>` +
      (opts.watermark ? watermarkLayer() : "") +
      `</div>`
    );
  },
};
