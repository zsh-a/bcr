/**
 * 真实地区「新加坡 Singapore」（货币 SGD）：新加坡电信账单流派（Singtel 版式复刻）。
 * - sg_singtel_telecom  Meridian Telecommunications：左侧品牌栏（弧形 logo +
 *   条码 + 客户地址 + eBill QR 推广 + App/帮助/热线三块），右侧浅灰
 *   「My Bill Overview」面板（账户元信息 + Total Due 大数字 + Outstanding /
 *   Current Charges + 「My Monthly Charges」三月横向条形图 + 注册号小字），
 *   下方「My Bill Details」按 Mobile / Fibre Broadband / TV 分 section 计价
 *   （GST 9% 外加），底部撕线 Payment Slip（双条码 + 银行/支票填写框 +
 *   Page 1 of 3），GIRO 自动转账提示。
 * 地址字段为新加坡式组屋地址（blockStreet / unitNo / postalCode）。
 */

import { code128Svg } from "../barcode";
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
  utilityName: "Meridian Telecommunications",
  utilityNameZh: "子午电信",
  tagline: "Fictional mobile, fibre & TV operator",
  currency: "SGD",
  prefix: "MDT",
  periodDays: 30,
  accent: "#e2262e",
  locale: "en-SG",
};

/** 横向条形图使用的青蓝渐变（参考图的月度费用条） */
const BAR_TEAL_A = "#2aa9bd";
const BAR_TEAL_B = "#157d92";
/** 右侧概览面板底色 */
const PANEL_BG = "#f1f1f3";

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

/** 品牌 logo：红色三道弧 + 右侧递升圆点（弧形笑脸风格），下方字标 */
function logoSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240" viewBox="0 0 560 240" role="img" aria-label="logo">` +
    `<path d="M70 190 A170 170 0 0 1 380 78" stroke="${accent}" stroke-width="22" fill="none" stroke-linecap="round"/>` +
    `<path d="M126 190 A112 112 0 0 1 318 118" stroke="${accent}" stroke-width="18" fill="none" stroke-linecap="round"/>` +
    `<path d="M180 190 A60 60 0 0 1 268 152" stroke="${accent}" stroke-width="14" fill="none" stroke-linecap="round"/>` +
    `<circle cx="404" cy="66" r="24" fill="${accent}"/>` +
    `<circle cx="342" cy="112" r="19" fill="${accent}"/>` +
    `<circle cx="288" cy="150" r="15" fill="${accent}"/>` +
    `</svg>`
  );
}

/** 左栏推广小图标：红色圆角块 + 白色图形 */
function promoIcon(accent: string, inner: string): string {
  return (
    `<div style="width:96px;height:96px;border-radius:20px;background:${accent};flex:none;` +
    `display:flex;align-items:center;justify-content:center;">${inner}</div>`
  );
}

function promoIconGlyphs(): { app: string; help: string; phone: string } {
  const miniArcs =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 100 100">` +
    `<g stroke="#ffffff" stroke-width="10" fill="none" stroke-linecap="round">` +
    `<path d="M20 62 A44 44 0 0 1 78 34"/><path d="M32 66 A26 26 0 0 1 66 50"/></g>` +
    `<circle cx="82" cy="30" r="8" fill="#ffffff"/></svg>`;
  const help = `<span style="font-size:64px;font-weight:800;color:#ffffff;line-height:1;">?</span>`;
  const phone =
    `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 24 24">` +
    `<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1` +
    `C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" fill="#ffffff"/></svg>`;
  return { app: miniArcs, help, phone };
}

/** 左栏：logo + 条码 + 客户地址 + eBill 推广（伪 QR）+ App/帮助/热线 */
function leftColumn(vm: BillViewModel, meta: TemplateMeta): string {
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:37px;color:#333c42;line-height:1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");
  const billId = billIdOf(vm);
  const headBarcode = code128Svg(billId, { moduleWidth: 4, height: 120 });
  const qr = pseudoQrSvg(vm.qrSeed, { module: 10 });
  const icons = promoIconGlyphs();
  const promoRow = (icon: string, html: string): string =>
    `<div style="display:flex;gap:36px;align-items:center;margin-top:30px;">${icon}` +
    `<div style="font-size:33px;color:#333c42;line-height:1.55;">${html}</div></div>`;
  return (
    `<div style="width:980px;flex:none;">` +
    logoSvg(meta.accent) +
    `<div style="font-size:96px;font-weight:800;letter-spacing:-2px;color:#1b2327;line-height:1.05;margin-top:6px;">Meridian</div>` +
    `<div style="font-size:34px;letter-spacing:10px;color:#5a656c;margin-top:4px;">TELECOMMUNICATIONS</div>` +
    `<div style="margin-top:36px;">${headBarcode}</div>` +
    `<div style="margin-top:44px;">` +
    `<div style="font-size:42px;font-weight:600;color:#1b2327;">${escapeHtml(vm.customerName)}</div>` +
    `${addressHtml}</div>` +
    `<div style="display:flex;gap:48px;align-items:center;margin-top:52px;">` +
    `<div style="font-size:40px;color:#1b2327;line-height:1.5;">Have you switched<br/>to eBill?` +
    `<div style="font-size:34px;color:${meta.accent};margin-top:12px;">Find out more on<br/>meridian.example/eBill</div></div>` +
    `<div style="flex:none;">${qr}</div></div>` +
    `<div style="margin-top:44px;">` +
    promoRow(
      promoIcon(meta.accent, icons.app),
      `Pay your bills with<br/>My Meridian app<br/>anytime, anywhere.`,
    ) +
    promoRow(
      promoIcon(meta.accent, icons.help),
      `Understand your bill.<br/><span style="color:#5a656c;">meridian.example/billexplainer</span>`,
    ) +
    promoRow(
      promoIcon(meta.accent, icons.phone),
      `For bill enquiries:<br/><b>1800 000 0000</b> <span style="color:#5a656c;">(24-hrs automated helpline)</span>`,
    ) +
    `</div></div>`
  );
}

/** 概览面板的元信息对：小号灰 label + 深色 value（纵向堆叠） */
function metaPair(label: string, value: string): string {
  return (
    `<div style="margin-top:26px;">` +
    `<div style="font-size:29px;color:#5a656c;">${label}</div>` +
    `<div style="font-size:36px;font-weight:600;color:#1b2327;margin-top:4px;">${value}</div></div>`
  );
}

/** 「My Monthly Charges」横向条形图（近 3 期，新→旧） */
function monthlyBars(vm: BillViewModel): string {
  if (vm.bars.length === 0) return "";
  const max = Math.max(...vm.bars.map((b) => b.value), 1);
  const rows = vm.bars
    .map((bar) => {
      const width = Math.max(12, Math.round((bar.value / max) * 100));
      return (
        `<div style="display:flex;align-items:center;margin-top:24px;">` +
        `<div style="width:104px;flex:none;font-size:33px;color:#333c42;">${escapeHtml(bar.label)}</div>` +
        `<div style="flex:1;"><div style="width:${width}%;height:64px;border-radius:0 10px 10px 0;` +
        `background:linear-gradient(90deg,${BAR_TEAL_A},${BAR_TEAL_B});display:flex;align-items:center;` +
        `padding-left:26px;color:#ffffff;font-size:31px;font-variant-numeric:tabular-nums;">${bar.value.toFixed(2)}</div></div></div>`
      );
    })
    .join("");
  return (
    `<div style="margin-top:56px;">` +
    `<div style="font-size:44px;font-weight:700;color:#1b2327;">My Monthly Charges</div>${rows}</div>`
  );
}

/** 右栏浅灰「My Bill Overview」面板 */
function overviewPanel(vm: BillViewModel): string {
  const billId = billIdOf(vm);
  const outstanding =
    vm.accountSummary !== undefined
      ? round2(vm.accountSummary.previousBalance - vm.accountSummary.paymentsReceived)
      : 0;
  const regNo = `20${vm.accountNumber.slice(2, 4)}${vm.accountNumber.slice(4, 8)}D`;
  const gstRegNo = `M${vm.accountNumber.slice(8, 9)}-${vm.accountNumber.slice(0, 7)}-${vm.accountNumber.slice(9, 10)}`;
  return (
    `<div style="flex:1;margin-left:56px;background:${PANEL_BG};border-radius:70px 70px 0 0;padding:52px 72px;">` +
    `<div style="font-size:54px;font-weight:800;color:#1b2327;">My Bill Overview</div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:14px;">` +
    `<div>` +
    metaPair("Account No.", escapeHtml(vm.accountNumber)) +
    metaPair("Bill ID", escapeHtml(billId)) +
    metaPair("Bill Date", escapeHtml(vm.billDate)) +
    metaPair("Bill Period", `${escapeHtml(vm.periodStart)} - ${escapeHtml(vm.periodEnd)}`) +
    `</div>` +
    `<div style="text-align:right;flex:none;margin-top:26px;">` +
    `<div style="font-size:34px;color:#1b2327;">Total Due (${escapeHtml(vm.currency)})</div>` +
    `<div style="font-size:104px;font-weight:800;color:#1b2327;font-variant-numeric:tabular-nums;line-height:1.15;">` +
    `${vm.total.toFixed(2)}</div></div></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:48px;">` +
    `<span style="font-size:42px;font-weight:700;color:#1b2327;">Outstanding Amount</span>` +
    `<span style="font-size:42px;font-weight:700;font-variant-numeric:tabular-nums;">${outstanding.toFixed(2)}</span></div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:44px;">` +
    `<div><div style="font-size:42px;font-weight:700;color:#1b2327;">Current Charges</div>` +
    `<div style="font-size:30px;color:#333c42;margin-top:6px;">Due by ${escapeHtml(vm.dueDate)}</div></div>` +
    `<span style="font-size:42px;font-weight:700;font-variant-numeric:tabular-nums;">${vm.total.toFixed(2)}</span></div>` +
    monthlyBars(vm) +
    `<div style="margin-top:48px;font-size:27px;color:#5a656c;line-height:1.65;">` +
    `<div>${escapeHtml(vm.utilityName)} Limited</div>` +
    `<div>Registration no.: ${escapeHtml(regNo)}</div>` +
    `<div>Tax Invoice GST Registration No.: ${escapeHtml(gstRegNo)}</div></div>` +
    `<div style="text-align:right;font-size:30px;color:#5a656c;margin-top:16px;">Next Page &#9654;</div>` +
    `</div>`
  );
}

/** 「My Bill Details」：按服务分 section 计价 + GST 汇总 */
function billDetails(vm: BillViewModel, meta: TemplateMeta): string {
  const sections = (vm.sections ?? [])
    .map((section) => {
      const rows = section.lines
        .map(
          (line) =>
            `<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e7e4dc;">` +
            `<span style="font-size:31px;color:#333c42;">${escapeHtml(line.label)}</span>` +
            `<span style="font-size:31px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, line.amount))}</span></div>`,
        )
        .join("");
      return (
        `<div style="margin-top:26px;">` +
        `<div style="display:flex;justify-content:space-between;align-items:baseline;background:${PANEL_BG};` +
        `border-left:10px solid ${meta.accent};padding:14px 26px;border-radius:0 12px 12px 0;">` +
        `<span style="font-size:34px;font-weight:700;">${escapeHtml(section.title)}</span>` +
        (section.subtitle !== undefined
          ? `<span style="font-size:26px;color:#5a656c;font-family:'Courier New',monospace;">${escapeHtml(section.subtitle)}</span>`
          : "") +
        `</div>` +
        `<div style="padding:2px 26px 0;">${rows}` +
        `<div style="display:flex;justify-content:space-between;padding:12px 0;">` +
        `<span style="font-size:30px;font-weight:600;color:#5a656c;">Section total · 小计</span>` +
        `<span style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMeta(meta, section.sectionTotal))}</span></div></div></div>`
      );
    })
    .join("");
  const sumRow = (label: string, value: string, strong: boolean): string =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;` +
    `${strong ? "margin-top:10px;padding-top:10px;border-top:3px solid #1b2327;" : "margin-top:6px;"}">` +
    `<span style="font-size:${strong ? 36 : 31}px;${strong ? "font-weight:700;" : "color:#5a656c;"}">${label}</span>` +
    `<span style="font-size:${strong ? 44 : 32}px;font-weight:${strong ? 800 : 500};` +
    `font-variant-numeric:tabular-nums;${strong ? `color:${meta.accent};` : ""}">${value}</span></div>`;
  return (
    `<div style="margin-top:40px;">` +
    `<div style="font-size:44px;font-weight:800;color:#1b2327;">My Bill Details` +
    `<span style="font-size:30px;font-weight:400;color:#8a9298;margin-left:20px;">费用明细 · 按服务分项</span></div>` +
    sections +
    `<div style="margin-top:24px;display:flex;justify-content:flex-end;">` +
    `<div style="width:900px;">` +
    sumRow("Charges before tax · 税前小计", escapeHtml(fmtMeta(meta, vm.subtotal)), false) +
    sumRow(escapeHtml(vm.taxLabel), escapeHtml(fmtMeta(meta, vm.tax)), false) +
    sumRow("Total for this bill · 本期总额", escapeHtml(fmtMeta(meta, vm.total)), true) +
    `</div></div></div>`
  );
}

/** 底部撕线 Payment Slip：回邮地址 + 应付金额 + 双条码 + 银行/支票填写框 */
function paymentSlip(vm: BillViewModel, meta: TemplateMeta): string {
  const billId = billIdOf(vm);
  const barcode1 = code128Svg(billId, { moduleWidth: 2.4, height: 84 });
  const cents = `${Math.round(vm.total * 100)}`.padStart(8, "0");
  const barcode2 = code128Svg(`${cents}B`, { moduleWidth: 2.4, height: 84 });
  const fillBox = (label: string, value: string): string =>
    `<div style="display:flex;align-items:flex-end;gap:24px;margin-top:16px;">` +
    `<div style="flex:1;background:#f6f6f8;border-radius:12px;padding:20px 30px;font-size:32px;color:#1b2327;` +
    `min-height:44px;">${value}</div>` +
    (label.length > 0
      ? `<div style="flex:none;font-size:30px;color:#5a656c;padding-bottom:20px;">${label}</div>`
      : "") +
    `</div>`;
  return (
    `<div style="margin-top:auto;">` +
    `<div style="border-top:4px dashed #b9b3a6;position:relative;">` +
    `<span style="position:absolute;right:0;top:14px;font-size:26px;color:#8a9298;font-family:'Courier New',monospace;">0000</span></div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:18px;">` +
    `<div style="width:700px;flex:none;">` +
    `<div style="font-size:36px;font-weight:700;color:#1b2327;">${escapeHtml(vm.utilityName)}</div>` +
    `<div style="font-size:30px;color:#333c42;line-height:1.5;margin-top:8px;">` +
    `ROBINSON ROAD POST OFFICE<br/>PO BOX 294<br/>SINGAPORE 900694</div>` +
    `<div style="margin-top:20px;font-size:36px;font-weight:700;color:${meta.accent};">Payment Slip</div>` +
    `<div style="font-size:28px;color:#5a656c;margin-top:6px;">Mail us this portion with your cheque payment.<br/>Already on GIRO? No action needed — payment is deducted automatically.</div>` +
    `<div style="font-size:30px;color:#5a656c;margin-top:16px;">Total Due</div>` +
    `<div style="font-size:64px;font-weight:800;color:#1b2327;font-variant-numeric:tabular-nums;line-height:1.1;">` +
    `${escapeHtml(vm.currency)}${vm.total.toFixed(2)}</div>` +
    `<div style="font-size:30px;font-weight:600;color:#1b2327;margin-top:6px;">` +
    `Due date for Current Charges ${escapeHtml(vm.dueDate)}</div></div>` +
    `<div style="flex:1;padding:0 36px;display:flex;flex-direction:column;justify-content:flex-end;">` +
    `<div style="display:flex;gap:56px;align-items:flex-end;justify-content:center;">` +
    `<div style="text-align:center;">${barcode1}` +
    `<div style="font-size:23px;letter-spacing:3px;color:#333c42;margin-top:8px;font-family:'Courier New',monospace;">` +
    `${escapeHtml(billId)}&#160;&#160;T101&#160;&#160;${escapeHtml(vm.accountNumber)}</div></div>` +
    `<div style="text-align:center;">${barcode2}` +
    `<div style="font-size:23px;letter-spacing:3px;color:#333c42;margin-top:8px;font-family:'Courier New',monospace;">` +
    `${escapeHtml(cents)}B</div></div></div></div>` +
    `<div style="width:560px;flex:none;">` +
    fillBox(`Acc. No: <b>${escapeHtml(vm.accountNumber)}</b>`, escapeHtml(vm.customerName)) +
    fillBox("", `<span style="color:#8a9298;">Bank</span>`) +
    fillBox("", `<span style="color:#8a9298;">Cheque No.</span>`) +
    `</div></div>` +
    `<div style="display:flex;justify-content:flex-end;margin-top:22px;font-size:28px;color:#5a656c;">Page 1 of 3</div>` +
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
        "Pay by GIRO for a fuss-free experience — deductions are made on the due date (fictional).",
        "GST is charged at the prevailing 9% rate on all services.",
        "This is a multi-page bill; per-service itemised details continue on the following pages.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    const notes =
      vm.notes.length === 0
        ? ""
        : `<ul style="margin:18px 0 0;padding-left:40px;font-size:25px;color:#8a9298;line-height:1.55;">` +
          vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("") +
          `</ul>`;
    return (
      `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
      `background:#ffffff;color:#1b2327;font-family:Helvetica,Arial,sans-serif;">` +
      `<div style="position:absolute;inset:0;padding:64px 96px 48px;display:flex;flex-direction:column;">` +
      `<div style="display:flex;align-items:stretch;">` +
      leftColumn(vm, SINGTEL_META) +
      overviewPanel(vm) +
      `</div>` +
      billDetails(vm, SINGTEL_META) +
      notes +
      paymentSlip(vm, SINGTEL_META) +
      `<div style="margin-top:10px;padding-top:12px;border-top:2px solid #e7e4dc;font-size:20px;color:#a2a9ae;line-height:1.6;white-space:nowrap;">` +
      `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虚构示例文档，仅供版式学习，非真实账单。` +
      ` ${escapeHtml(vm.utilityName)} is a fictional utility; any resemblance to real organisations is coincidental.</div>` +
      `</div>` +
      (opts.watermark ? watermarkLayer() : "") +
      `</div>`
    );
  },
};
