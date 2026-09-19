/**
 * 香港账单流派「版式 B」：贴近真实港式参考图版式的虚构双语（繁中 + EN）模板。
 * - hk_electricity_power  中華電力 CLP Power：双月账期、顶部深蓝横幅（风车标 +
 *   「照亮美好明天」标语 + CLP 中電字标）、费用公式块（電力費用＋燃料調整費＋其他＝應繳總數圆徽）、
 *   分级电量表（首/次/超逾）、其他栏（政府電費紓緩/補貼 / 零數撥來撥入）、平均每日用電量柱图、
 *   电表小表、「轉數快」伪 QR、底部存根（编账号码 + Code128 + OCR 行 + 環保訊息框）。
 * - hk_water_bill  水務署 Water Supplies Department：约四月账期（参考图为 123 日）、
 *   用水量/日均用量条、每日平均用水量柱图、水表行（度數附 A/E/S 标注）、
 *   分级水费＋排污费双栏试算（餘額承前/撥入下期）、右侧應繳總額大圆角框（水滴圆标）、
 *   底部缴款回条（繳費靈商户编号「08」+ 长数字 Code128 + 转数快伪 QR）。
 * 版式 / 品牌字标以参考图为准；全部编号、金额、姓名等数据均为确定性派生的虚构值，仅供版式学习。
 */

import { code128Svg } from "../barcode";
import { fnv1a } from "../hash";
import type { BillInput, BillTemplate, BillViewModel, ChargeLine, RenderOptions } from "../model";
import { pseudoQrSvg } from "../pseudoqr";
import {
  addDaysIso,
  buildBase,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  escapeHtml,
  formatInt,
  round2,
  type TemplateMeta,
} from "./common";

/** CJK 字体栈：双语账单必须带繁中 fallback（单引号——外层 style 属性用双引号） */
const HK_FONT = `Helvetica, Arial, 'PingFang TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif`;

/** 与 hongkong 地区一致的地址字段 schema（表单渲染 + 校验共用） */
const HK_FIELDS = [
  {
    kind: "text",
    key: "flat",
    label: "单位",
    placeholder: "Flat A, 12/F",
    required: true,
    maxLength: 40,
  },
  {
    kind: "text",
    key: "estate",
    label: "屋邨 / 屋苑",
    placeholder: "Mei Foo Sun Chuen, Block 3",
    required: true,
    maxLength: 60,
  },
  {
    kind: "text",
    key: "district",
    label: "地区",
    placeholder: "Kowloon",
    required: true,
    maxLength: 40,
  },
] as const;

const POWER_META: TemplateMeta = {
  docType: "hk_electricity_power",
  regionId: "hongkong",
  kind: "power",
  utilityName: "CLP Power",
  utilityNameZh: "中華電力",
  tagline: "照亮美好明天 · Power Brighter Tomorrows",
  currency: "HKD",
  prefix: "HBP",
  periodDays: 60,
  accent: "#8db542",
  locale: "en-HK",
};

const WATER_META: TemplateMeta = {
  docType: "hk_water_bill",
  regionId: "hongkong",
  kind: "water",
  utilityName: "Water Supplies Department",
  utilityNameZh: "水務署",
  tagline: "付款通知書 Payment notice",
  currency: "HKD",
  prefix: "CSW",
  // 参考图账期明确印为「123日」（23/04/2026 - 24/08/2026），按图取值
  periodDays: 123,
  accent: "#215fac",
  locale: "en-HK",
};

/** 水务参考图的双层蓝：品牌深蓝（logo/机构名）+ 浅钢蓝（大框/水滴圆标/回条框） */
const WATER_BOX_BLUE = "#7f9ecd";
const WATER_CHIP_HEAD = "#bdcee2";
const WATER_CHIP_BODY = "#ebeff8";

const POWER_BANNER_BLUE = "#22338b";
const POWER_GREEN = "#8db542";

/* ---------------- 本地 helper ---------------- */

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

const MONTH_TO_NUM: Readonly<Record<string, string>> = {
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

/** "03 Sep 2026" → "2026-09-03"（vm 只带英文日期串，渲染期需要 ISO 做日期算术/重排格式） */
function parseEnDate(en: string): string {
  const parts = en.split(" ");
  const d = parts[0] ?? "01";
  const mon = MONTH_TO_NUM[parts[1] ?? ""] ?? "01";
  const y = parts[2] ?? "1970";
  return `${y}-${mon}-${d}`;
}

/** iso → "03/09/2026"（水务单日期格式） */
function fmtSlash(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** iso → "03-09-26"（电力单日期格式，日-月-年） */
function fmtDash2(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${(y ?? "").slice(2)}`;
}

/** 两位小数裸数字（千分位），配合栏头 "HK$" 使用 */
function fmtNum2(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** 参考单据的正文金额只显示美元符号；HK$ 仅作为明细栏的币种栏头。 */
function hkMoney(n: number): string {
  return `$${fmtNum2(n)}`;
}

/** 分 → 元（整数分运算保证勾稽分毫不差） */
function fromCents(c: number): number {
  return round2(c / 100);
}

/** 电力编账号码：XXXXX-XXXXX-X（10 位户号 + hash 校验位，装饰性） */
function powerAccountCode(accountNumber: string): { formatted: string; payload: string } {
  const check = `${fnv1a(`hkpacct::${accountNumber}`) % 10}`;
  return {
    formatted: `${accountNumber.slice(0, 5)}-${accountNumber.slice(5)}-${check}`,
    payload: `${accountNumber}${check}`,
  };
}

/** 水务用户编号：XXXX XXXX XXX（10 位户号 + hash 校验位，装饰性） */
function waterAccountCode(accountNumber: string): { formatted: string; payload: string } {
  const check = `${fnv1a(`hkwacct::${accountNumber}`) % 10}`;
  const digits = `${accountNumber}${check}`;
  return {
    formatted: `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`,
    payload: digits,
  };
}

/** charge label 结构："组 · 栏名 · 数值细节"，拆三段供版式化渲染 */
function splitLabel(label: string): { caption: string; detail: string } {
  const parts = label.split(" · ");
  return { caption: parts[1] ?? "", detail: parts[2] ?? "" };
}

/** 电力标志：参考图中的中電四色折面标。 */
function powerLogoMark(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120">` +
    `<path d="M0 0H50L100 50H50Z" fill="#f5d70a"/>` +
    `<path d="M0 0L50 50L0 100Z" fill="#2b3990"/>` +
    `<path d="M50 0H100V50H50Z" fill="#8dc63f"/>` +
    `<path d="M0 100H50L100 50V100Z" fill="#2b8ac4"/>` +
    `</svg>`
  );
}

/** 公式块小图标：energy 插头 / fuel 火焰 / others 三点 */
function formulaIcon(kind: "energy" | "fuel" | "others"): string {
  const inner =
    kind === "energy"
      ? `<rect x="34" y="14" width="12" height="26" fill="#ffffff"/><rect x="54" y="14" width="12" height="26" fill="#ffffff"/>` +
        `<path d="M30 40 h40 v14 a20 20 0 0 1 -40 0 Z" fill="#ffffff"/><rect x="46" y="72" width="8" height="18" fill="#ffffff"/>`
      : kind === "fuel"
        ? `<path d="M50 10 C60 26 74 38 74 58 a24 24 0 0 1 -48 0 C26 38 40 28 50 10 Z" fill="#ffffff"/>`
        : `<circle cx="28" cy="50" r="9" fill="#ffffff"/><circle cx="50" cy="50" r="9" fill="#ffffff"/><circle cx="72" cy="50" r="9" fill="#ffffff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="44" height="44">${inner}</svg>`;
}

/** 水务标志：蓝色倒三角盾形 + 两条白色竖向波纹（对齐参考图风格） */
function waterLogoMark(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="130" height="130">` +
    `<path d="M6 8 H94 L56 90 Q50 96 44 90 Z" fill="${accent}"/>` +
    `<path d="M34 8 C46 26 24 42 36 60 C42 70 46 80 47 90" stroke="#ffffff" stroke-width="7" fill="none"/>` +
    `<path d="M54 8 C66 26 44 42 56 60 C61 68 62 76 60 84" stroke="#ffffff" stroke-width="7" fill="none"/>` +
    `</svg>`
  );
}

/** 大白水滴（水务應繳總額框的圆形叠加标） */
function dropletGlyph(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="96" height="96">` +
    `<path d="M50 10 C50 10 24 44 24 64 a26 26 0 0 0 52 0 C76 44 50 10 50 10 Z" fill="#ffffff"/>` +
    `</svg>`
  );
}

/** 底部免责声明（保留中英双语句；不再声称机构为虚构） */
function fictionalFooter(): string {
  return (
    `<div style="margin-top:14px;font-size:25px;color:#a2a9ae;line-height:1.7;">` +
    `FICTIONAL SAMPLE DOCUMENT — layout study only, not a real bill. 虛構示例文件，僅供版式學習，非真實賬單。</div>`
  );
}

/* ---------------- 电力版式 B ---------------- */

/** 平均每日用電量柱图：黑色柱 + 网格线 + 柱顶数值 + 月份/年份轴 + 左侧竖排轴标题（贴近参考图） */
function powerChart(vm: BillViewModel, billIso: string): string {
  if (vm.bars.length === 0) return "";
  const H = 360;
  const maxV = Math.max(...vm.bars.map((b) => b.value), 1);
  const axisMax = Math.max(5, Math.ceil(maxV / 5) * 5);
  const grid: string[] = [];
  for (let v = 5; v <= axisMax; v += 5) {
    const y = Math.round(H - (v / axisMax) * H);
    grid.push(
      `<div style="position:absolute;left:80px;right:0;top:${y}px;border-top:2px solid #c9c4b8;"></div>` +
        `<div style="position:absolute;left:0;top:${y - 15}px;width:64px;text-align:right;font-size:22px;color:#5a656c;">${v}</div>`,
    );
  }
  const bars = vm.bars
    .map((bar) => {
      const h = Math.max(14, Math.round((bar.value / axisMax) * H));
      return (
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${H}px;">` +
        `<div style="font-size:24px;color:#1b2327;margin-bottom:4px;">${bar.value.toFixed(0)}</div>` +
        `<div style="width:62%;height:${h}px;background:#1b2327;"></div></div>`
      );
    })
    .join("");
  const labels = vm.bars
    .map(
      (bar) =>
        `<div style="flex:1;text-align:center;font-size:24px;color:#333c42;">${escapeHtml(bar.label)}</div>`,
    )
    .join("");
  const leftYear = addDaysIso(billIso, -660).slice(0, 4);
  const rightYear = billIso.slice(0, 4);
  return (
    `<div style="margin-top:0;display:flex;gap:10px;">` +
    `<div style="flex:none;width:40px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:60px;">` +
    `<div style="writing-mode:vertical-rl;font-size:26px;color:#333c42;letter-spacing:2px;">平均每日用電量（度）</div></div>` +
    `<div style="flex:1;min-width:0;">` +
    `<div style="position:relative;height:${H}px;">${grid.join("")}` +
    `<div style="position:absolute;left:80px;right:0;top:0;bottom:0;border-left:3px solid #1b2327;border-bottom:3px solid #1b2327;"></div>` +
    `<div style="position:absolute;left:88px;right:8px;top:0;bottom:0;display:flex;gap:10px;align-items:flex-end;">${bars}</div></div>` +
    `<div style="display:flex;gap:10px;margin-left:88px;margin-top:8px;">${labels}</div>` +
    `<div style="display:flex;justify-content:space-between;margin-left:88px;margin-top:4px;font-size:24px;color:#5a656c;">` +
    `<span>${leftYear}</span><span>賬單月份 Billing month</span><span>${rightYear}</span></div></div></div>`
  );
}

function renderPowerHtml(vm: BillViewModel, opts: RenderOptions): string {
  const billIso = parseEnDate(vm.billDate);
  const dueIso = parseEnDate(vm.dueDate);
  const startIso = parseEnDate(vm.periodStart);
  const endIso = parseEnDate(vm.periodEnd);
  const acct = powerAccountCode(vm.accountNumber);
  const h = fnv1a(`hkpower::${vm.accountNumber}`);
  // 展示项：按金 / 上次繳費 / 環保排放因子（hash 确定性派生，不计入应缴）
  const deposit = fromCents((400 + (h % 20) * 100) * 100);
  const lastPayment = fromCents((200 + (fnv1a(`hkpower-lp::${vm.accountNumber}`) % 400)) * 100);
  const lastPayDate = fmtDash2(addDaysIso(billIso, -52));
  const emissionYear = `${Number(billIso.slice(0, 4)) - 1}`;
  const emissionFactor = ((30 + (h % 20)) / 100).toFixed(2);
  const blockLines = vm.charges.filter((c) => c.label.startsWith("電力費用"));
  const fuel = vm.charges.find((c) => c.label.startsWith("燃料調整費"))?.amount ?? 0;
  const otherLines = vm.charges.filter((c) => c.label.startsWith("其他｜"));
  const energy = round2(blockLines.reduce((s, c) => s + c.amount, 0));
  const others = round2(otherLines.reduce((s, c) => s + c.amount, 0));
  const meter = vm.meterRows[0];
  const meterNo = `${36177000 + (h % 90000)}`;
  const kwhText = meter?.usage.split(" ")[0] ?? "";
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:34px;color:#1b2327;line-height:1.55;">${escapeHtml(line)}</div>`,
    )
    .join("");

  const thL = `text-align:left;padding:10px 8px;font-weight:600;border-bottom:2px solid #1b2327;`;
  const thR = `text-align:right;padding:10px 8px;font-weight:600;border-bottom:2px solid #1b2327;`;
  const tdL = `text-align:left;padding:10px 8px;`;
  const tdR = `text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;`;
  const blockRowsHtml = blockLines
    .map((line) => {
      const { caption, detail } = splitLabel(line.label);
      const m = /([\d,]+) 度 kWh × ([\d.]+)¢/.exec(detail);
      return (
        `<tr style="font-size:31px;">` +
        `<td style="${tdL}">${escapeHtml(caption)}</td>` +
        `<td style="${tdR}">${escapeHtml(m?.[2] ?? "-")}</td>` +
        `<td style="${tdR}">${escapeHtml(m?.[1] ?? "-")}</td>` +
        `<td style="${tdR}">${fmtNum2(line.amount)}</td></tr>`
      );
    })
    .join("");
  const otherRowsHtml = otherLines
    .map((line) => {
      const label = line.label.split("｜")[1] ?? line.label;
      // 参考图：补贴行带 -$ 前缀，零数行与小结为裸数字
      const sign = line.amount < 0 ? "-" : "";
      const value = `${sign}${label.includes("紓緩") ? "$" : ""}${fmtNum2(Math.abs(line.amount))}`;
      return (
        `<div style="display:flex;justify-content:space-between;padding:11px 0;font-size:32px;">` +
        `<span>${escapeHtml(label)}</span>` +
        `<span style="font-variant-numeric:tabular-nums;">${value}</span></div>`
      );
    })
    .join("");

  const formulaBox = (zh: string, en: string, value: number, icon: string): string =>
    `<div style="flex:1;border:4px solid ${POWER_GREEN};border-radius:16px;overflow:hidden;background:#ffffff;">` +
    `<div style="background:${POWER_GREEN};color:#ffffff;display:flex;align-items:center;gap:14px;padding:16px 20px;">` +
    `<span style="width:66px;height:66px;border-radius:50%;background:rgba(255,255,255,0.28);display:flex;align-items:center;justify-content:center;flex:none;">${icon}</span>` +
    `<span><span style="display:block;font-size:33px;font-weight:800;">${zh}</span>` +
    `<span style="display:block;font-size:24px;opacity:0.92;">${en}</span></span></div>` +
    `<div style="background:#ffffff;padding:20px 12px;text-align:center;font-size:48px;font-weight:800;` +
    `font-variant-numeric:tabular-nums;">${escapeHtml(hkMoney(value))}</div></div>`;
  const connector = (ch: string): string =>
    `<div style="flex:none;align-self:center;font-size:64px;font-weight:300;color:#8a9298;">${ch}</div>`;
  const acctBarcode = code128Svg(acct.payload, { moduleWidth: 5, height: 130 });
  const stubBarcode = code128Svg(vm.barcodePayload, { moduleWidth: 4, height: 150 });
  const ocr = `${acct.payload}  ${`${Math.round(vm.total * 100)}`.padStart(10, "0")}  02  1`;
  const notesHtml = vm.notes
    .map((n) => `<div style="font-size:26px;color:#3f5aa8;margin-top:6px;">${escapeHtml(n)}</div>`)
    .join("");

  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:${HK_FONT};">` +
    // 顶部深蓝横幅（内嵌式：四周留白，与参考图一致）：左风车标志 + 标语，右 CLP 中電字标
    `<div style="height:178px;margin:49px 55px 0;background:${POWER_BANNER_BLUE};color:#ffffff;padding:0 85px;` +
    `display:flex;justify-content:space-between;align-items:center;box-sizing:border-box;">` +
    `<div style="display:flex;gap:30px;align-items:center;">${powerLogoMark()}` +
    `<div><div style="font-size:36px;letter-spacing:10px;">照亮美好明天</div>` +
    `<div style="font-size:26px;opacity:0.85;margin-top:8px;">Power Brighter Tomorrows</div></div></div>` +
    `<div style="display:flex;gap:22px;align-items:center;">` +
    `<span style="font-size:72px;font-weight:700;letter-spacing:3px;">CLP</span>` +
    `<span style="width:96px;height:96px;border:6px solid #ffffff;border-radius:50%;` +
    `display:flex;align-items:center;justify-content:center;font-size:54px;font-weight:700;">中</span>` +
    `<span style="font-size:72px;font-weight:700;">中電</span></div></div>` +
    // 正文
    `<div style="height:${CANVAS_HEIGHT - 227}px;padding:150px 110px 94px;display:flex;flex-direction:column;box-sizing:border-box;">` +
    // 客户块 + 注册客户及供电地址（右块比左块高 56px，与参考图一致）
    `<div style="display:flex;justify-content:space-between;">` +
    `<div style="margin-left:64px;"><div style="font-size:40px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div style="width:810px;margin-top:-56px;"><div style="font-size:30px;font-weight:700;color:#3f5aa8;">註冊客戶及供電地址</div>` +
    `<div style="font-size:30px;font-weight:700;color:#3f5aa8;">Registered Customer &amp; Supply Address</div>` +
    `<div style="font-size:32px;margin-top:8px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div></div>` +
    // 账户条码 + 编账号码
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px;">` +
    `<div style="margin-left:22%;text-align:center;">${acctBarcode}</div>` +
    `<div style="text-align:left;">` +
    `<div style="font-size:26px;color:#5a656c;">編賬號碼 Account Number</div>` +
    `<div style="font-size:56px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:2px;">${escapeHtml(acct.formatted)}</div>` +
    `<div style="font-size:30px;font-weight:700;margin-top:4px;">賬類及商戶編號：<b>02</b></div></div></div>` +
    // 住宅用電 / 发单日期 / 账期 / 按金 / 页码（参考图为非均布定位）
    `<div style="display:flex;align-items:flex-end;margin-top:76px;">` +
    `<div style="margin-left:-34px;width:470px;"><div style="font-size:40px;">住宅用電</div>` +
    `<div style="font-size:26px;color:#5a656c;margin-top:2px;">發單日期（日 - 月 - 年）</div>` +
    `<div style="font-size:40px;font-weight:800;">${escapeHtml(fmtDash2(billIso))}</div></div>` +
    `<div style="font-size:30px;line-height:1.6;">由 ${escapeHtml(fmtDash2(startIso))} 至 ${escapeHtml(fmtDash2(endIso))}<br/>共 ${vm.periodDays} 日用電量</div>` +
    `<div style="font-size:32px;margin-left:286px;">按金 <b style="font-size:36px;">${escapeHtml(hkMoney(deposit))}</b></div>` +
    `<div style="font-size:30px;margin-left:auto;">第 1/2 頁</div></div>` +
    // 主区：左（公式块 + 奶黄明细框[内嵌柱图]） 右（應繳總數圆徽 + 电表小表 + 補貼餘額 + 转数快）
    // 负外边距让明细框/圆徽比正文文字更靠边缘（参考图：框 x≈44、圆徽右缘 x≈2432）
    `<div style="display:flex;gap:56px;margin:44px -66px 0;height:1832px;flex:none;">` +
    `<div style="flex:2.3;min-width:0;display:flex;flex-direction:column;">` +
    `<div style="display:flex;gap:16px;align-items:stretch;width:100%;">` +
    formulaBox("電力費用", "Energy Charge", energy, formulaIcon("energy")) +
    connector("+") +
    formulaBox("燃料調整費", "Fuel Cost Adjustment", fuel, formulaIcon("fuel")) +
    connector("+") +
    formulaBox("其他", "Others", others, formulaIcon("others")) +
    connector("=") +
    `</div>` +
    // 费用明细框（奶黄底、虚线中分双栏；柱图内嵌框底；固定高度与参考图对齐）
    `<div style="margin-top:59px;border:3px solid #6d7872;border-radius:14px;background:#fdfbe6;` +
    `padding:38px 40px;height:1560px;display:flex;flex-direction:column;box-sizing:border-box;">` +
    `<div style="display:flex;gap:40px;flex:1;">` +
    `<div style="flex:1.05;min-width:0;">` +
    `<div style="font-size:34px;font-weight:700;text-decoration:underline;">電力費用：</div>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:8px;">` +
    `<tr style="font-size:27px;">` +
    `<th style="${thL}">用電級別</th><th style="${thR}">每度（¢）</th>` +
    `<th style="${thR}">度數</th><th style="${thR}">費用（HK$）</th></tr>` +
    blockRowsHtml +
    `<tr style="font-size:31px;font-weight:800;">` +
    `<td style="${tdL}">小計</td><td style="${tdR}"></td>` +
    `<td style="${tdR}border-top:2px solid #1b2327;">${escapeHtml(kwhText)}</td>` +
    `<td style="${tdR}border-top:2px solid #1b2327;">$${fmtNum2(energy)}</td></tr></table>` +
    `<div style="margin-top:30px;font-size:34px;font-weight:700;text-decoration:underline;">燃料調整費：</div>` +
    `<div style="display:flex;justify-content:space-between;font-size:31px;margin-top:10px;">` +
    `<span>小計（ ${escapeHtml(kwhText)} 度）</span>` +
    `<span style="font-weight:800;font-variant-numeric:tabular-nums;">$${fmtNum2(fuel)}</span></div></div>` +
    `<div style="flex:none;width:0;border-left:3px dashed #1b2327;"></div>` +
    `<div style="flex:1;min-width:0;">` +
    `<div style="font-size:34px;font-weight:700;text-decoration:underline;">其他：</div>` +
    `<div style="margin-top:8px;">${otherRowsHtml}</div>` +
    `<div style="display:flex;justify-content:space-between;font-size:32px;font-weight:800;` +
    `border-top:2px solid #1b2327;margin-top:8px;padding-top:10px;">` +
    `<span>小計</span><span style="font-variant-numeric:tabular-nums;">${others < 0 ? `-${fmtNum2(Math.abs(others))}` : fmtNum2(others)}</span></div></div>` +
    `</div>` +
    `<div style="margin-top:auto;padding-top:30px;width:62%;">${powerChart(vm, billIso)}</div>` +
    `</div>` +
    `</div>` +
    // 右栏
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;">` +
    `<div style="width:640px;height:640px;border-radius:50%;border:16px solid ${POWER_GREEN};background:#ffffff;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;margin:0 auto;">` +
    `<div style="font-size:40px;">應繳總數</div>` +
    `<div style="font-size:88px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15;">${escapeHtml(hkMoney(vm.total))}</div>` +
    `<div style="font-size:30px;margin-top:10px;">繳款限期</div>` +
    `<div style="font-size:56px;font-weight:800;">${escapeHtml(fmtDash2(dueIso))}</div>` +
    `<div style="font-size:27px;color:#333c42;margin-top:18px;line-height:1.6;">上次繳費 ${escapeHtml(hkMoney(lastPayment))}<br/>已於 ${escapeHtml(lastPayDate)} 收到　謝謝</div></div>` +
    `<div style="margin-top:320px;">` +
    `<div style="display:flex;gap:14px;font-size:24px;">` +
    `<span style="flex:1.3;text-decoration:underline;">電錶號碼</span>` +
    `<span style="flex:1;text-decoration:underline;">讀錶倍數</span>` +
    `<span style="flex:1;text-decoration:underline;">前次讀數</span>` +
    `<span style="flex:1;text-decoration:underline;">今次讀數</span></div>` +
    `<div style="display:flex;gap:14px;font-size:29px;font-weight:600;margin-top:8px;font-variant-numeric:tabular-nums;">` +
    `<span style="flex:1.3;">${escapeHtml(meterNo)}</span><span style="flex:1;">1</span>` +
    `<span style="flex:1;">${escapeHtml(meter?.previous ?? "")}</span>` +
    `<span style="flex:1;">${escapeHtml(meter?.current ?? "")}</span></div>` +
    `<div style="margin-top:16px;font-size:26px;line-height:1.6;">政府電費紓緩計劃餘額為 ${escapeHtml(hkMoney(0))}<br/>政府電費補貼餘額為 ${escapeHtml(hkMoney(0))}</div></div>` +
    `<div style="margin-top:auto;border:3px solid #6d7872;border-radius:14px;padding:26px;text-align:center;` +
    `height:430px;box-sizing:border-box;background:#fdfbe6;">` +
    `<div style="font-size:32px;font-weight:700;">「轉數快」繳費</div>` +
    `<div style="margin-top:12px;display:inline-block;">${pseudoQrSvg(vm.qrSeed, { module: 10 })}</div></div>` +
    `</div></div>` +
    // 存根
    `<div style="margin-top:auto;padding-top:88px;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="font-size:32px;">編賬號碼：　<b style="font-size:36px;">${escapeHtml(acct.formatted)}</b></div>` +
    `<div style="display:flex;align-items:center;gap:60px;">` +
    `<div style="font-size:32px;">應繳總數：　<b style="font-size:42px;font-variant-numeric:tabular-nums;">${escapeHtml(hkMoney(vm.total))}</b></div>` +
    `<div style="font-size:28px;color:#333c42;">存根</div></div>` +
    `<div style="border:3px solid #1b2327;text-align:center;">` +
    `<div style="padding:12px 24px;font-size:26px;line-height:1.4;">${emissionYear} 年平均每度電<br/>二氧化碳當量排放：</div>` +
    `<div style="border-top:3px solid #1b2327;padding:10px 24px;font-size:30px;">${emissionFactor} 千克</div></div></div>` +
    `<div style="margin-top:18px;">${stubBarcode}</div>` +
    `<div style="margin-top:18px;font-family:'Courier New',monospace;font-size:40px;letter-spacing:6px;color:#1b2327;">${escapeHtml(ocr)}</div>` +
    `<div style="margin-top:16px;">${notesHtml}</div>` +
    fictionalFooter() +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const hkElectricityPower: BillTemplate = {
  docType: POWER_META.docType,
  regionId: "hongkong",
  label: "電費單 · 港式版式 B",
  kind: "power",
  fields: HK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, POWER_META);
    const kwh = 320 + Math.floor(rng() * 880);
    const previousReading = 20000 + Math.floor(rng() * 8000);
    const currentReading = previousReading + kwh;
    // 分级电量电价（双月）：首 400 度 / 次 600 度 / 超逾 1,000 度（仙/度，整数分运算）
    const b1 = Math.min(kwh, 400);
    const b2 = Math.min(Math.max(kwh - 400, 0), 600);
    const b3 = Math.max(kwh - 1000, 0);
    const a1c = Math.round(b1 * 94.5);
    const a2c = Math.round(b2 * 107.9);
    const a3c = Math.round(b3 * 120.8);
    // 燃料调整费：每度 45.15 仙
    const fuelC = Math.round(kwh * 45.15);
    // 其他：政府电费补贴（负）+ 零数拨来（正）− 零数拨入下次（总数取整到角）
    const subsidyC = -(5000 + Math.floor(rng() * 3) * 2500);
    const carryInC = Math.floor(rng() * 90);
    const preTotalC = a1c + a2c + a3c + fuelC + subsidyC + carryInC;
    const totalC = Math.floor(preTotalC / 10) * 10;
    const carryOutC = preTotalC - totalC;
    const acct = powerAccountCode(base.accountNumber);
    // 平均每日用電量柱图：近 12 期（双月账期，跨年），值 = 各期用量 / 60 天
    const bars = Array.from({ length: 12 }, (_, i) => {
      const back = 11 - i;
      const iso = addDaysIso(base.billDateIso, -60 * back);
      const periodKwh = i === 11 ? kwh : Math.round(kwh * (0.65 + rng() * 0.7));
      return {
        label: `${Number(iso.slice(5, 7))}`,
        value: Math.round((periodKwh / 60) * 10) / 10,
      };
    });
    return {
      docType: POWER_META.docType,
      regionId: "hongkong",
      kind: "power",
      utilityName: POWER_META.utilityName,
      utilityNameZh: POWER_META.utilityNameZh,
      tagline: POWER_META.tagline,
      currency: POWER_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays: POWER_META.periodDays,
      meterRows: [
        {
          label: "住宅用電 Residential supply",
          previous: formatInt(previousReading),
          current: formatInt(currentReading),
          usage: `${formatInt(kwh)} 度 kWh`,
        },
      ],
      usageSummary: `${formatInt(kwh)} 度 kWh · 共 ${POWER_META.periodDays} 日`,
      bars,
      barUnit: "度/日 kWh per day",
      barTitle: "平均每日用電量 Average daily consumption",
      charges: [
        {
          label: `電力費用 Energy charge · 首級 First block · ${formatInt(b1)} 度 kWh × 94.5¢/度`,
          amount: fromCents(a1c),
        },
        {
          label: `電力費用 Energy charge · 次級 Next block · ${formatInt(b2)} 度 kWh × 107.9¢/度`,
          amount: fromCents(a2c),
        },
        {
          label: `電力費用 Energy charge · 超逾 Above 1,000 · ${formatInt(b3)} 度 kWh × 120.8¢/度`,
          amount: fromCents(a3c),
        },
        {
          label: `燃料調整費 Fuel cost adjustment · ${formatInt(kwh)} 度 kWh × 45.15¢/度`,
          amount: fromCents(fuelC),
        },
        {
          label: "其他｜政府電費紓緩/補貼 Government electricity subsidy",
          amount: fromCents(subsidyC),
        },
        { label: "其他｜上期零數撥來 Odd cents brought forward", amount: fromCents(carryInC) },
        { label: "其他｜零數撥入下次 Odd cents carried forward", amount: fromCents(-carryOutC) },
      ],
      subtotal: fromCents(totalC),
      taxLabel: "無稅項 No tax",
      tax: 0,
      total: fromCents(totalC),
      barcodePayload: `${acct.payload}${`${totalC}`.padStart(8, "0")}`,
      qrSeed: `${base.invoiceNumber}|${fromCents(totalC).toFixed(2)}|${base.dueDate}`,
      notes: [
        "燃料調整費按實報實銷原則調整。The fuel cost adjustment is reconciled at cost.",
        "請參閱電費單背頁或中電網站了解更多中電資訊。 For more information, please read overleaf or the last page of your electricity bill or visit our website.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderPowerHtml(vm, opts);
  },
};

/* ---------------- 水务版式 B ---------------- */

/** 每日平均用水量柱图：0.0–1.0 网格 + 黑柱 + MM/YY 轴（贴近参考图） */
function waterChart(vm: BillViewModel): string {
  if (vm.bars.length === 0) return "";
  const H = 245;
  const maxV = Math.max(...vm.bars.map((b) => b.value), 0.2);
  const axisMax = Math.max(1, Math.ceil(maxV * 5) / 5);
  const grid: string[] = [];
  const steps = Math.round(axisMax / 0.2);
  for (let i = 1; i <= steps; i++) {
    const v = i * 0.2;
    const y = Math.round(H - (v / axisMax) * H);
    grid.push(
      `<div style="position:absolute;left:80px;right:0;top:${y}px;border-top:2px solid #c9c4b8;"></div>` +
        `<div style="position:absolute;left:0;top:${y - 15}px;width:64px;text-align:right;font-size:22px;color:#5a656c;">${v.toFixed(1)}</div>`,
    );
  }
  const bars = vm.bars
    .map((bar) => {
      const h = Math.max(12, Math.round((bar.value / axisMax) * H));
      return (
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${H}px;">` +
        `<div style="width:44%;height:${h}px;background:#1b2327;"></div></div>`
      );
    })
    .join("");
  const labels = vm.bars
    .map(
      (bar) =>
        `<div style="flex:1;text-align:center;font-size:26px;color:#333c42;">${escapeHtml(bar.label)}</div>`,
    )
    .join("");
  return (
    `<div style="margin-top:36px;">` +
    `<div style="font-size:26px;color:#333c42;margin-bottom:8px;">立方米 m³</div>` +
    `<div style="position:relative;height:${H}px;">${grid.join("")}` +
    `<div style="position:absolute;left:80px;right:0;top:0;bottom:0;border-left:3px solid #1b2327;border-bottom:3px solid #1b2327;"></div>` +
    `<div style="position:absolute;left:88px;right:8px;top:0;bottom:0;display:flex;gap:26px;align-items:flex-end;">${bars}</div></div>` +
    `<div style="display:flex;gap:26px;margin-left:88px;margin-top:8px;">${labels}</div>` +
    `<div style="text-align:center;font-size:28px;font-weight:700;margin-top:8px;">每日平均用水量</div></div>`
  );
}

function renderWaterHtml(vm: BillViewModel, opts: RenderOptions): string {
  const meta = WATER_META;
  const accent = meta.accent;
  const soft = WATER_BOX_BLUE;
  const billIso = parseEnDate(vm.billDate);
  const dueIso = parseEnDate(vm.dueDate);
  const startIso = parseEnDate(vm.periodStart);
  const endIso = parseEnDate(vm.periodEnd);
  const acct = waterAccountCode(vm.accountNumber);
  const h = fnv1a(`hkwater::${vm.accountNumber}`);
  const summary = vm.accountSummary;
  const carryIn = summary?.previousBalance ?? 0;
  const carryOut = summary?.paymentsReceived ?? 0;
  // 展示项：上次缴款 / 现存按金（hash 确定性派生）
  const lastPayDate = fmtSlash(addDaysIso(billIso, -WATER_META.periodDays));
  const lastPayAmount = fromCents((200 + (fnv1a(`hkwater-lp::${vm.accountNumber}`) % 400)) * 100);
  const depositHeld = fromCents((300 + (h % 6) * 100) * 100);
  // 页眉下方的小号流水数字（参考图样式，hash 确定性派生）
  const serialNo = `${10000000 + (fnv1a(`hkwsn::${vm.accountNumber}`) % 89999999)}`;
  const meter = vm.meterRows[0];
  const waterLines = vm.charges.filter((c) => c.label.startsWith("水費"));
  const sewageLines = vm.charges.filter((c) => c.label.startsWith("排污費"));
  const waterSub = round2(waterLines.reduce((s, c) => s + c.amount, 0));
  const sewageSub = round2(sewageLines.reduce((s, c) => s + c.amount, 0));
  const usageParts = vm.usageSummary.split("｜");
  const usagePart = usageParts[0] ?? "";
  const dailyPart = usageParts[1] ?? "";
  const addressHtml = vm.addressLines
    .map(
      (line) =>
        `<div style="font-size:32px;color:#1b2327;line-height:1.55;">${escapeHtml(line)}</div>`,
    )
    .join("");

  const tierRowHtml = (line: ChargeLine): string => {
    const { caption, detail } = splitLabel(line.label);
    const m = /([\d.]+) 立方米 m³ @ HK\$([\d.]+)/.exec(detail);
    return (
      `<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:31px;">` +
      `<span>${escapeHtml(caption)} ${escapeHtml(m?.[1] ?? "-")} 立方米 @ $${escapeHtml(m?.[2] ?? "-")}</span>` +
      `<span style="font-variant-numeric:tabular-nums;">${fmtNum2(line.amount)}</span></div>`
    );
  };
  const sumRow = (label: string, value: string, bold: boolean, extra = ""): string =>
    `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:${bold ? 34 : 31}px;` +
    `${bold ? "font-weight:800;" : ""}${extra}">` +
    `<span>${label}</span><span style="font-variant-numeric:tabular-nums;">${value}</span></div>`;

  const slipBarcode = code128Svg(vm.barcodePayload, { moduleWidth: 3, height: 140 });
  const notesHtml = vm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  const periodText = `${fmtSlash(startIso)} - ${fmtSlash(endIso)}`;

  return (
    `<div style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden;` +
    `background:#ffffff;color:#1b2327;font-family:${HK_FONT};">` +
    `<div style="height:${CANVAS_HEIGHT}px;padding:56px 70px 50px 180px;display:flex;flex-direction:column;box-sizing:border-box;">` +
    // 页眉：左标志 + 双语机构名，右 付款通知書 / 發出日期
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
    `<div style="display:flex;gap:26px;align-items:center;">${waterLogoMark(accent)}` +
    `<div><div style="font-size:52px;font-weight:800;color:${accent};">${escapeHtml(vm.utilityNameZh)}</div>` +
    `<div style="font-size:42px;font-weight:800;color:${accent};margin-top:2px;">${escapeHtml(vm.utilityName)}</div></div></div>` +
    `<div style="display:flex;font-size:32px;">` +
    `<span style="background:#b9cde6;padding:14px 30px;">付款通知書</span>` +
    `<span style="background:#d9dee6;padding:14px 30px;">發出日期 : ${escapeHtml(fmtSlash(billIso))}</span></div></div>` +
    // 流水小数字（参考图位于页眉与地址块之间、约 1/3 页宽处）
    `<div style="margin-left:34%;margin-top:84px;font-size:26px;color:#1b2327;">${serialNo}</div>` +
    // 客户块 + 用水楼宇地址
    `<div style="display:flex;justify-content:space-between;margin-top:16px;">` +
    `<div style="margin-left:30px;"><div style="font-size:34px;">${escapeHtml(vm.customerName)}</div>${addressHtml}</div>` +
    `<div><div style="font-size:30px;font-weight:700;text-decoration:underline;">用水樓宇地址</div>` +
    `<div style="margin-top:6px;">${addressHtml}</div></div></div>` +
    // 用户编号
    `<div style="text-align:center;font-size:38px;margin-top:190px;">用戶編號 : ` +
    `<b style="letter-spacing:2px;">${escapeHtml(acct.formatted)}</b></div>` +
    // 主区：左（用量条 + 柱图 + 水表行） 右（應繳總額大框 + 缴款历史）
    `<div style="display:flex;gap:56px;margin-top:20px;height:735px;flex:none;">` +
    `<div style="flex:1.6;min-width:0;">` +
    `<div style="display:flex;text-align:center;gap:6px;">` +
    `<div style="flex:1;background:${WATER_CHIP_HEAD};border-radius:14px;font-size:32px;font-weight:700;color:#17375e;padding:12px 0;">用水量</div>` +
    `<div style="flex:1;background:${WATER_CHIP_HEAD};border-radius:14px;font-size:32px;font-weight:700;color:#17375e;padding:12px 0;">每日平均用水量</div></div>` +
    `<div style="display:flex;text-align:center;gap:6px;margin-top:6px;">` +
    `<div style="flex:1;background:${WATER_CHIP_BODY};border-radius:14px;font-size:32px;padding:12px 0;">${escapeHtml(usagePart)}</div>` +
    `<div style="flex:1;background:${WATER_CHIP_BODY};border-radius:14px;font-size:32px;padding:12px 0;">${escapeHtml(dailyPart)}</div></div>` +
    waterChart(vm) +
    `<div style="border-radius:14px;overflow:hidden;margin-top:36px;">` +
    `<table style="width:100%;border-collapse:collapse;text-align:center;">` +
    `<tr style="background:${WATER_CHIP_HEAD};font-size:30px;font-weight:700;color:#17375e;">` +
    `<td style="padding:12px 6px;">水錶編號</td><td style="padding:12px 6px;">日期</td>` +
    `<td style="padding:12px 6px;">度數</td><td style="padding:12px 6px;">日期</td>` +
    `<td style="padding:12px 6px;">度數</td></tr>` +
    `<tr style="background:${WATER_CHIP_BODY};font-size:30px;font-variant-numeric:tabular-nums;">` +
    `<td style="padding:12px 6px;">${escapeHtml(meter?.label ?? "")}</td>` +
    `<td style="padding:12px 6px;">${escapeHtml(periodText.split(" - ")[0] ?? "")}</td>` +
    `<td style="padding:12px 6px;">${escapeHtml(meter?.previous ?? "")}</td>` +
    `<td style="padding:12px 6px;">${escapeHtml(periodText.split(" - ")[1] ?? "")}</td>` +
    `<td style="padding:12px 6px;">${escapeHtml(meter?.current ?? "")}</td></tr></table></div>` +
    `<div style="font-size:26px;margin-top:10px;">A：抄錶度數　E：估計度數　S：客戶報讀度數</div>` +
    `</div>` +
    // 右栏
    `<div style="flex:1;min-width:0;">` +
    `<div style="position:relative;margin-top:-38px;margin-left:76px;">` +
    `<div style="position:absolute;left:-76px;top:-124px;width:220px;height:220px;border-radius:50%;` +
    `background:${soft};display:flex;align-items:center;justify-content:center;z-index:2;">${dropletGlyph()}</div>` +
    `<div style="height:720px;box-sizing:border-box;border:10px solid ${soft};border-radius:42px;padding:80px 40px 50px;text-align:center;background:#ffffff;">` +
    `<div style="font-size:38px;">應繳總額</div>` +
    `<div style="font-size:72px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2;">${escapeHtml(hkMoney(vm.total))}</div>` +
    `<div style="font-size:32px;margin-top:8px;">繳款限期</div>` +
    `<div style="font-size:56px;font-weight:800;">${escapeHtml(fmtSlash(dueIso))}</div>` +
    `<div style="font-size:27px;margin-top:6px;">在此日期後加收5%附加費</div>` +
    `<div style="font-size:31px;font-weight:700;margin-top:30px;">繳款單編號 : ${escapeHtml(acct.payload)}</div></div></div>` +
    `<div style="margin-top:30px;font-size:29px;line-height:1.8;">` +
    `<div>上次繳款日期 : ${escapeHtml(lastPayDate)}</div>` +
    `<div>上次繳款金額 : ${escapeHtml(hkMoney(lastPayAmount))}</div>` +
    `<div>現存按金款額 : ${escapeHtml(hkMoney(depositHeld))}</div>` +
    `<div>爭議金額 : ${escapeHtml(hkMoney(0))}</div>` +
    `<div>分期付款金額 : ${escapeHtml(hkMoney(0))}</div></div>` +
    `</div></div>` +
    // 供水性质 + 双栏试算
    `<div style="margin-top:180px;font-size:31px;">供水性質：住宅供水（010030）</div>` +
    `<div style="display:flex;gap:48px;margin-top:60px;">` +
    `<div style="flex:1;min-width:0;">` +
    `<div style="text-align:right;font-size:27px;color:#5a656c;">HK$</div>` +
    sumRow("餘額承前", fmtNum2(carryIn), false) +
    `<div style="font-size:33px;font-weight:800;margin-top:8px;">水費</div>` +
    `<div style="font-size:30px;margin-top:4px;">${escapeHtml(periodText)}</div>` +
    `<div style="margin-top:6px;">${waterLines.map(tierRowHtml).join("")}</div>` +
    sumRow("小計", fmtNum2(waterSub), false, "border-top:3px solid #1b2327;margin-top:4px;") +
    `</div>` +
    `<div style="flex:none;width:9px;background:#1b2327;"></div>` +
    `<div style="flex:1;min-width:0;">` +
    `<div style="text-align:right;font-size:27px;color:#5a656c;">HK$</div>` +
    `<div style="font-size:33px;font-weight:800;">排污費</div>` +
    `<div style="font-size:30px;margin-top:4px;">${escapeHtml(periodText)}</div>` +
    `<div style="margin-top:6px;">${sewageLines.map(tierRowHtml).join("")}</div>` +
    sumRow("小計", fmtNum2(sewageSub), false, "border-top:3px solid #1b2327;margin-top:4px;") +
    `<div style="margin-top:18px;">` +
    sumRow("<b>收費總額</b>", fmtNum2(vm.subtotal), false) +
    sumRow("餘額撥入下期", `${fmtNum2(carryOut)} CR`, false) +
    sumRow(
      "應繳款額",
      fmtNum2(vm.total),
      true,
      "border-top:3px solid #1b2327;border-bottom:9px double #1b2327;margin-top:4px;",
    ) +
    `</div></div></div>` +
    // 账单附注
    `<div style="margin-top:60px;">` +
    `<div style="font-size:31px;font-weight:800;">有關上述用水樓宇或收費項目的帳單附註 :</div>` +
    `<ul style="margin:10px 0 0;padding-left:44px;font-size:28px;line-height:1.7;">${notesHtml}</ul></div>` +
    // 缴款回条
    `<div style="margin-top:auto;padding-top:150px;">` +
    `<div style="border-top:4px dashed #8a9298;"></div>` +
    `<div style="display:flex;justify-content:space-between;font-size:31px;font-weight:700;margin-top:18px;">` +
    `<span>如以支票付款，請把本郵寄付款回條連同支票寄上 。</span>` +
    `<span>繳款單編號 : ${escapeHtml(acct.payload)}</span></div>` +
    `<div style="display:flex;gap:36px;align-items:center;margin-top:22px;">` +
    `<div style="text-align:center;font-size:29px;line-height:1.5;flex:none;">` +
    `<div>繳費靈</div><div>商戶編號「08」</div>` +
    `<div style="border:3px solid #1b2327;padding:6px 22px;margin-top:4px;">CRC131</div></div>` +
    `<div style="border:4px solid ${soft};border-radius:24px;padding:18px 30px;font-size:34px;` +
    `text-align:center;line-height:1.5;flex:none;">節省用水<br/>節省金錢</div>` +
    `<div style="flex:1;border:10px solid ${soft};border-radius:30px;padding:14px 36px;` +
    `display:flex;justify-content:space-around;text-align:center;">` +
    `<div><div style="font-size:32px;font-weight:700;">應繳總額</div>` +
    `<div style="font-size:46px;font-weight:800;font-variant-numeric:tabular-nums;">${escapeHtml(hkMoney(vm.total))}</div></div>` +
    `<div><div style="font-size:32px;font-weight:700;">繳款限期</div>` +
    `<div style="font-size:42px;font-weight:800;">${escapeHtml(fmtSlash(dueIso))}</div>` +
    `<div style="font-size:22px;">在此日期後加收5%附加費</div></div></div>` +
    `<div style="text-align:center;flex:none;">${pseudoQrSvg(vm.qrSeed, { module: 9 })}` +
    `<div style="font-size:25px;margin-top:6px;">轉數快FPS</div></div></div>` +
    `<div style="font-size:34px;letter-spacing:2px;margin-top:22px;font-variant-numeric:tabular-nums;">${escapeHtml(vm.barcodePayload)}</div>` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px;">` +
    `<div>${slipBarcode}</div>` +
    `<div style="text-align:right;">` +
    `<div style="font-size:30px;">發出日期　${escapeHtml(fmtSlash(billIso))}</div>` +
    `<div style="display:flex;justify-content:flex-end;gap:44px;margin-top:8px;font-size:26px;">` +
    `<span style="color:#8a9298;">BC v2.0.5 - 92FC</span>` +
    `<span style="font-size:27px;color:#5a656c;">總數1頁的第1頁</span></div></div></div>` +
    fictionalFooter() +
    `</div>` +
    `</div>` +
    (opts.watermark ? watermarkLayer() : "") +
    `</div>`
  );
}

export const hkWaterBill: BillTemplate = {
  docType: WATER_META.docType,
  regionId: "hongkong",
  label: "水費單 · 港式版式 B",
  kind: "water",
  fields: HK_FIELDS,
  compute(input: BillInput, rng: () => number): BillViewModel {
    const base = buildBase(input, WATER_META);
    const periodDays = WATER_META.periodDays;
    const m3 = 35 + Math.floor(rng() * 55);
    const previousReading = 600 + Math.floor(rng() * 700);
    const currentReading = previousReading + m3;
    // 分级水价（按账期天数对 121 天基准期折算级距）：首级免费，逐级加价
    const factor = periodDays / 121;
    const cap1 = 12 * factor;
    const cap2 = 31 * factor;
    const cap3 = 19 * factor;
    const q3d = (n: number): number => Math.round(n * 1000) / 1000;
    const q1 = q3d(Math.min(m3, cap1));
    const q2 = q3d(Math.min(Math.max(m3 - cap1, 0), cap2));
    const q3 = q3d(Math.min(Math.max(m3 - cap1 - cap2, 0), cap3));
    const q4 = q3d(Math.max(m3 - cap1 - cap2 - cap3, 0));
    const a2c = Math.round(q2 * 416);
    const a3c = Math.round(q3 * 645);
    const a4c = Math.round(q4 * 905);
    // 排污费：首级免费，其余用水量 @ HK$2.92/立方米
    const s2q = q3d(m3 - q1);
    const s2c = Math.round(s2q * 292);
    const subtotalC = a2c + a3c + a4c + s2c;
    // 余额承前（上期零数）+ 应收取整到角，零数拨入下期（CR）
    const carryInC = Math.floor(rng() * 10);
    const preTotalC = subtotalC + carryInC;
    const totalC = Math.floor(preTotalC / 10) * 10;
    const carryOutC = preTotalC - totalC;
    const acct = waterAccountCode(base.accountNumber);
    // 回条长数字串（装饰性）：8710 + 商户08 + 8×0 + 缴款单编号 + 金额分 + 8 位随机
    const extraDigits = Array.from({ length: 8 }, () => `${Math.floor(rng() * 10)}`).join("");
    const slipDigits = `87100800000000${acct.payload}${`${totalC}`.padStart(8, "0")}${extraDigits}`;
    const daily = m3 / periodDays;
    // 每日平均用水量柱图：近 7 期（约四月一期）
    const bars = Array.from({ length: 7 }, (_, i) => {
      const back = 6 - i;
      const iso = addDaysIso(base.billDateIso, -122 * back);
      const periodM3 = i === 6 ? m3 : Math.round(m3 * (0.7 + rng() * 0.6));
      return {
        label: `${iso.slice(5, 7)}/${iso.slice(2, 4)}`,
        value: Math.round((periodM3 / periodDays) * 1000) / 1000,
      };
    });
    const meterNo = `MSL${58000000 + Math.floor(rng() * 999999)}`;
    return {
      docType: WATER_META.docType,
      regionId: "hongkong",
      kind: "water",
      utilityName: WATER_META.utilityName,
      utilityNameZh: WATER_META.utilityNameZh,
      tagline: WATER_META.tagline,
      currency: WATER_META.currency,
      accountNumber: base.accountNumber,
      invoiceNumber: base.invoiceNumber,
      customerName: input.name,
      addressLines: base.addressLines,
      billDate: base.billDate,
      dueDate: base.dueDate,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      periodDays,
      meterRows: [
        {
          label: meterNo,
          previous: `${previousReading}A`,
          current: `${currentReading}A`,
          usage: `${formatInt(m3)} 立方米 m³`,
        },
      ],
      usageSummary: `${formatInt(m3)} 立方米/${periodDays}日｜${daily.toFixed(3)}立方米 (${formatInt(daily * 1000)} 公升)`,
      bars,
      barUnit: "立方米/日 m³ per day",
      barTitle: "每日平均用水量 Daily average consumption",
      charges: [
        {
          label: `水費 Water charge · 第一級 Tier 1 · ${q1.toFixed(3)} 立方米 m³ @ HK$0.00`,
          amount: 0,
        },
        {
          label: `水費 Water charge · 第二級 Tier 2 · ${q2.toFixed(3)} 立方米 m³ @ HK$4.16`,
          amount: fromCents(a2c),
        },
        {
          label: `水費 Water charge · 第三級 Tier 3 · ${q3.toFixed(3)} 立方米 m³ @ HK$6.45`,
          amount: fromCents(a3c),
        },
        {
          label: `水費 Water charge · 第四級 Tier 4 · ${q4.toFixed(3)} 立方米 m³ @ HK$9.05`,
          amount: fromCents(a4c),
        },
        {
          label: `排污費 Sewage charge · 第一級 Tier 1 · ${q1.toFixed(3)} 立方米 m³ @ HK$0.00`,
          amount: 0,
        },
        {
          label: `排污費 Sewage charge · 第二級 Tier 2 · ${s2q.toFixed(3)} 立方米 m³ @ HK$2.92`,
          amount: fromCents(s2c),
        },
      ],
      subtotal: fromCents(subtotalC),
      taxLabel: "無稅項 No tax",
      tax: 0,
      total: fromCents(totalC),
      accountSummary: {
        previousBalance: fromCents(carryInC),
        paymentsReceived: fromCents(carryOutC),
        currentCharges: fromCents(subtotalC),
      },
      barcodePayload: slipDigits,
      qrSeed: `${base.invoiceNumber}|${fromCents(totalC).toFixed(2)}|${base.dueDate}`,
      notes: [
        "香港人均每日用水量為150公升。Average daily per capita consumption is 150 litres.",
        "將貴戶的每日用水量除以用水期間的人數便可得出貴戶的人均每日用水量。Divide your daily consumption by the number of occupants during the period.",
      ],
    };
  },
  renderHtml(vm: BillViewModel, opts: RenderOptions): string {
    return renderWaterHtml(vm, opts);
  },
};
