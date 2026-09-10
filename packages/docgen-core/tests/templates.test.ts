import { describe, expect, it } from "vitest";
import { getTemplate, rngForInput, TEMPLATES } from "../src/registry";
import { validateBillInput } from "../src/validate";
import { addDaysIso, formatMoney } from "../src/templates/common";
import type { BillInput } from "../src/model";

const ADDRESSES: Record<string, Record<string, string>> = {
  nh_water: { street: "14 Fjordgate", city: "Nordhavn", province: "Havnmark" },
  nh_power: { street: "27 Havnevej", city: "Nordhavn", province: "Havnmark" },
  ci_gas: { streetNumber: "12", streetName: "Cinder Lane", town: "Port Ember", postcode: "CE14 2PA" },
  ci_telecom: { streetNumber: "7", streetName: "Obsidian Way", town: "Caldera City", postcode: "CC02 9QR" },
  vd_power: { streetNumber: "742", streetName: "Birchwood Lane", city: "Bluehill", state: "VD", zip: "74210" },
  vd_water: { streetNumber: "15", streetName: "Kestrel Court", city: "Kestrel Ridge", state: "VD", zip: "74318" },
  cs_power: { street: "24 Rue des Tilleuls", city: "Castelbrun", postcode: "4812 EX" },
  cs_water: { street: "8 Avenue du Clocher", city: "Montaubray", postcode: "3407 LM" },
  wl_power: { strasse: "Falkenstraße 12", plz: "91240", ort: "Falkenheim" },
  wl_gas: { strasse: "Waldweg 7", plz: "91244", ort: "Waldbrück" },
  lc_water: { flat: "Flat A, 12/F", estate: "Lung Wah Estate, Block 3", district: "Lung Shing East" },
  lc_power: { flat: "Flat 5B, 23/F", estate: "Harbour Jade Court", district: "Harbourpoint" },
  co_power: { streetNo: "14", streetName: "Banksia Street", suburb: "Coral Cove", state: "CQL", postcode: "4820" },
  co_gas: { streetNo: "27", streetName: "Banyan Parade", suburb: "Banyan Bay", state: "CQL", postcode: "4822" },
  nl_power: { streetNo: "142", streetName: "Spruce Hollow Road", city: "Northpine", province: "NP", postalCode: "N4P 2K1" },
  nl_gas: { streetNo: "28", streetName: "Borealis Crescent", city: "Borealis Falls", province: "NP", postalCode: "N7B 3T9" },
  eq_utilities: { blockStreet: "Blk 128 Equator Avenue", unitNo: "#12-34", postalCode: "560128" },
  eq_telecom: { blockStreet: "Blk 45 Meridian Walk", unitNo: "#03-08", postalCode: "541045" },
  wn_energy: { streetNo: "12", streetName: "Mill Lane", city: "Wenlock", postcode: "WN4 2QA" },
  wn_water: { streetNo: "3", streetName: "Abbey Close", city: "Wealdminster", postcode: "WM1 8TR" },
};

function makeInput(docType: string): BillInput {
  return {
    docType,
    name: "Elin Sorensen",
    address: ADDRESSES[docType] ?? {},
    billDate: "2026-09-09",
  };
}

describe("compute 确定性", () => {
  for (const template of TEMPLATES) {
    it(`${template.docType}：同输入同 vm`, () => {
      const input = makeInput(template.docType);
      const a = template.compute(input, rngForInput(input));
      const b = template.compute({ ...input }, rngForInput({ ...input }));
      expect(a).toEqual(b);
    });

    it(`${template.docType}：换名字 → 单号变化`, () => {
      const input = makeInput(template.docType);
      const other = { ...input, name: "Marek Volkov" };
      expect(template.compute(other, rngForInput(other)).invoiceNumber).not.toBe(
        template.compute(input, rngForInput(input)).invoiceNumber,
      );
    });
  }
});

describe("金额与日期推导", () => {
  for (const template of TEMPLATES) {
    it(`${template.docType}：金额勾稽正确`, () => {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      const chargesSum = vm.charges.reduce((sum, c) => sum + c.amount, 0);
      expect(Math.abs(chargesSum - vm.subtotal)).toBeLessThan(0.005);
      if (vm.accountSummary !== undefined) {
        // 美式流派：total = 上期余额 − 已收款 + 本期费用（subtotal + tax）
        const current = vm.subtotal + vm.tax;
        expect(Math.abs(vm.accountSummary.currentCharges - current)).toBeLessThan(0.005);
        const expected =
          vm.accountSummary.previousBalance - vm.accountSummary.paymentsReceived + current;
        expect(Math.abs(expected - vm.total)).toBeLessThan(0.005);
      } else {
        expect(Math.abs(vm.subtotal + vm.tax - vm.total)).toBeLessThan(0.005);
      }
      expect(vm.total).toBeGreaterThan(0);
      // EUR 用 de-DE 渲染为 "1.234,56 €"；虚构货币用 en-US 渲染为 "NDK 1,234.56"
      const formatted = formatMoney(vm.currency, vm.total);
      expect(formatted.includes(vm.currency) || formatted.includes("€")).toBe(true);
    });

    it(`${template.docType}：dueDate = billDate + 21 天，账期长度正确`, () => {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      expect(vm.dueDate).toBe("30 Sep 2026");
      expect(vm.billDate).toBe("09 Sep 2026");
      expect(addDaysIso("2026-09-09", 21)).toBe("2026-09-30");
      const periodDays: Record<string, number> = {
        nh_water: 90,
        cs_water: 90,
        wl_power: 365,
        wl_gas: 365,
        lc_water: 90,
        lc_power: 60,
        co_power: 90,
        co_gas: 90,
        nl_power: 60,
        wn_energy: 90,
        wn_water: 180,
      };
      expect(vm.periodDays).toBe(periodDays[template.docType] ?? 30);
    });
  }

  it("billDate 为 null 时自动取当天（合法 ISO 日期）", () => {
    const template = getTemplate("nh_water");
    expect(template).toBeDefined();
    if (template === undefined) return;
    const input: BillInput = { ...makeInput("nh_water"), billDate: null };
    const vm = template.compute(input, rngForInput(input));
    expect(vm.billDate).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
  });

  it("nh_power 有 6 期用量柱、最后一期等于本期用量", () => {
    const template = getTemplate("nh_power");
    if (template === undefined) throw new Error("missing nh_power");
    const input = makeInput("nh_power");
    const vm = template.compute(input, rngForInput(input));
    expect(vm.bars).toHaveLength(6);
    expect(vm.barUnit).toBe("kWh");
    const current = vm.bars[5];
    expect(current).toBeDefined();
    expect(vm.usageSummary).toContain(`${current?.value ?? -1} kWh`);
  });
});

describe("renderHtml", () => {
  it("包含姓名（转义后）、金额、画布尺寸、条码与伪 QR", () => {
    const template = getTemplate("nh_water");
    if (template === undefined) throw new Error("missing nh_water");
    const input: BillInput = { ...makeInput("nh_water"), name: "O'Neil <script>" };
    const vm = template.compute(input, rngForInput(input));
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("O&#39;Neil &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("width:2481px");
    expect(html).toContain("height:3509px");
    expect(html).toContain("<svg"); // barcode / qr / logo
    expect(html).toContain(vm.invoiceNumber);
    expect(html).toContain("FICTIONAL SAMPLE DOCUMENT");
  });

  it("watermark 开关：仅开启时出现水印短语", () => {
    const template = getTemplate("ci_gas");
    if (template === undefined) throw new Error("missing ci_gas");
    const input = makeInput("ci_gas");
    const vm = template.compute(input, rngForInput(input));
    const on = template.renderHtml(vm, { watermark: true });
    const off = template.renderHtml(vm, { watermark: false });
    expect(on).toContain("FICTIONAL SAMPLE · 虚构文档 · 仅供学习");
    expect(off).not.toContain("FICTIONAL SAMPLE · 虚构文档 · 仅供学习");
  });

  it("nh_power 渲染包含用量柱状图区", () => {
    const template = getTemplate("nh_power");
    if (template === undefined) throw new Error("missing nh_power");
    const input = makeInput("nh_power");
    const vm = template.compute(input, rngForInput(input));
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Consumption history");
  });
});

/* ================= 新流派模板的结构 / 勾稽断言 ================= */

describe("vd_power（美式：账户摘要 + 12 期用量 + 回单存根）", () => {
  const template = getTemplate("vd_power");
  if (template === undefined) throw new Error("missing vd_power");
  const input = makeInput("vd_power");
  const vm = template.compute(input, rngForInput(input));

  it("账户摘要勾稽：total = prev − payments + current", () => {
    const s = vm.accountSummary;
    expect(s).toBeDefined();
    if (s === undefined) return;
    const current = vm.subtotal + vm.tax;
    expect(Math.abs(s.currentCharges - current)).toBeLessThan(0.005);
    expect(Math.abs(s.previousBalance - s.paymentsReceived + current - vm.total)).toBeLessThan(0.005);
    expect(s.paymentsReceived).toBeLessThanOrEqual(s.previousBalance + 0.005);
  });

  it("12 期用量柱状图，最后一期等于本期用量", () => {
    expect(vm.bars).toHaveLength(12);
    const last = vm.bars[11];
    expect(last).toBeDefined();
    expect(vm.usageSummary).toContain(`${last?.value ?? -1} kWh`);
  });

  it("明细含 delivery / supply / 固定费 / 税分行", () => {
    const labels = vm.charges.map((c) => c.label).join("|");
    expect(labels).toContain("Delivery charge");
    expect(labels).toContain("Supply charge");
    expect(vm.taxLabel).toContain("%");
  });

  it("渲染含 Amount Due 大框、撕线存根与 OCR 扫描行", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Amount due");
    expect(html).toContain("Detach and return with payment");
    expect(html).toContain("dashed"); // perforation 撕线
    expect(html).toContain("Amount enclosed"); // 空心金额填写框
    expect(html).toMatch(/monospace[^>]*>\s*\d{10,} /); // OCR 等宽数字串
    expect(html).toContain(vm.accountNumber);
  });
});

describe("vd_water（美式变体：HCF 阶梯水价）", () => {
  const template = getTemplate("vd_water");
  if (template === undefined) throw new Error("missing vd_water");
  const input = makeInput("vd_water");
  const vm = template.compute(input, rngForInput(input));

  it("阶梯水价：各档用量之和 = 总用量，各档金额 = 用量 × 单价", () => {
    const tierLines = vm.charges.filter((c) => c.label.startsWith("Tier"));
    expect(tierLines).toHaveLength(3);
    const usageHcf = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    const rates = [3.82, 4.96, 6.35];
    let qtySum = 0;
    for (let i = 0; i < tierLines.length; i++) {
      const line = tierLines[i];
      if (line === undefined) throw new Error("missing tier line");
      const match = /Tier \d · ([\d,]+) HCF × VDR ([\d.]+)/.exec(line.label);
      expect(match).not.toBeNull();
      const qty = Number((match?.[1] ?? "0").replaceAll(",", ""));
      const rate = Number(match?.[2] ?? "0");
      qtySum += qty;
      expect(rate).toBe(rates[i]);
      expect(Math.abs(line.amount - Math.round(qty * rate * 100) / 100)).toBeLessThan(0.005);
    }
    expect(qtySum).toBe(usageHcf);
    // 阶梯档位语义：1 档 ≤12、2 档 ≤16、3 档 ≥0
  });

  it("渲染含存根与阶梯明细", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Tier 1");
    expect(html).toContain("HCF");
    expect(html).toContain("Detach and return with payment");
  });
});

describe("cs_power（欧式：standing charge + unit rate + VAT）", () => {
  const template = getTemplate("cs_power");
  if (template === undefined) throw new Error("missing cs_power");
  const input = makeInput("cs_power");
  const vm = template.compute(input, rngForInput(input));

  it("standing + usage + VAT = total", () => {
    const standing = vm.charges.find((c) => c.label.startsWith("Standing charge"));
    const usage = vm.charges.find((c) => c.label.startsWith("Electricity ·"));
    expect(standing).toBeDefined();
    expect(usage).toBeDefined();
    expect(standing?.label).toContain(`${vm.periodDays} days ×`);
    expect(vm.taxLabel).toContain("8.5%");
    const expected = (standing?.amount ?? 0) + (usage?.amount ?? 0) + vm.tax;
    expect(Math.abs(expected - vm.total)).toBeLessThan(0.005);
  });

  it("渲染含 Direct Debit 提示与欧式标题", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Direct Debit");
    expect(html).toContain("How we worked it out");
    expect(html).toContain("electricity bill");
  });
});

describe("cs_water（欧式变体：供水 / 污水处理分行 + VAT）", () => {
  const template = getTemplate("cs_water");
  if (template === undefined) throw new Error("missing cs_water");
  const input = makeInput("cs_water");
  const vm = template.compute(input, rngForInput(input));

  it("供水 + 污水处理 + VAT = total，账期为季度 90 天", () => {
    const water = vm.charges.find((c) => c.label.startsWith("Water supply"));
    const sewerage = vm.charges.find((c) => c.label.startsWith("Sewerage"));
    expect(water).toBeDefined();
    expect(sewerage).toBeDefined();
    expect(vm.taxLabel).toContain("5.5%");
    const expected = (water?.amount ?? 0) + (sewerage?.amount ?? 0) + vm.tax;
    expect(Math.abs(expected - vm.total)).toBeLessThan(0.005);
    expect(vm.periodDays).toBe(90);
  });

  it("渲染为欧式极简双栏（含 water bill 标题与 Direct Debit 行）", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("water bill");
    expect(html).toContain("Direct Debit");
    expect(html).toContain("Sewerage");
  });
});

describe("veridia/castellan 地址 pattern 校验", () => {
  it("veridia：state 必须 2 位大写字母，zip 必须 5 位数字", () => {
    const tpl = getTemplate("vd_power");
    if (tpl === undefined) throw new Error("missing vd_power");
    const base = makeInput("vd_power");
    expect(validateBillInput(tpl, base).ok).toBe(true);
    const badState = validateBillInput(tpl, {
      ...base,
      address: { ...base.address, state: "vd" },
    });
    expect(badState.errors["state"]).toBeDefined();
    const badZip = validateBillInput(tpl, {
      ...base,
      address: { ...base.address, zip: "7421" },
    });
    expect(badZip.errors["zip"]).toBeDefined();
  });

  it("castellan：postcode 必须 4 数字 + 2 字母", () => {
    const tpl = getTemplate("cs_power");
    if (tpl === undefined) throw new Error("missing cs_power");
    const base = makeInput("cs_power");
    expect(validateBillInput(tpl, base).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...base,
      address: { ...base.address, postcode: "ABC-123" },
    });
    expect(bad.errors["postcode"]).toBeDefined();
  });
});

/* ================= 德国流派（Jahresabrechnung）专项断言 ================= */

describe("wl_power（Strom-Jahresabrechnung）", () => {
  const template = getTemplate("wl_power");
  if (template === undefined) throw new Error("missing wl_power");
  const input = makeInput("wl_power");
  const vm = template.compute(input, rngForInput(input));

  it("netto = arbeit + grund + 税费；brutto = netto × 1.19", () => {
    const chargesSum = vm.charges.reduce((s, c) => s + c.amount, 0);
    expect(Math.abs(chargesSum - vm.subtotal)).toBeLessThan(0.005);
    expect(Math.abs(vm.subtotal * 1.19 - vm.total)).toBeLessThan(0.015); // 分项四舍五入容差
    expect(vm.taxLabel).toContain("19 %");
    const labels = vm.charges.map((c) => c.label).join("|");
    expect(labels).toContain("Arbeitspreis");
    expect(labels).toContain("Grundpreis · 12 Monate");
    expect(labels).toContain("Stromsteuer");
    expect(labels).toContain("Konzessionsabgabe");
  });

  it("Abschlag 对冲：11 期、schlussbetrag = brutto − 预缴总额", () => {
    const s = vm.settlement;
    expect(s).toBeDefined();
    if (s === undefined) return;
    expect(s.installments).toHaveLength(11);
    const instSum = s.installments.reduce((sum, i) => sum + i.amount, 0);
    expect(Math.abs(instSum - s.installmentsTotal)).toBeLessThan(0.02);
    expect(Math.abs(vm.total - s.installmentsTotal - s.schlussbetrag)).toBeLessThan(0.02);
  });

  it("Schlussbetrag 标签随符号切换（Guthaben / Nachzahlung）", () => {
    const s = vm.settlement;
    if (s === undefined) throw new Error("missing settlement");
    const html = template.renderHtml(vm, { watermark: false });
    if (s.schlussbetrag < 0) {
      expect(html).toContain("Guthaben zu Ihren Gunsten");
      expect(html).not.toContain("Nachzahlung fällig");
    } else {
      expect(html).toContain("Nachzahlung fällig");
      expect(html).not.toContain("Guthaben zu Ihren Gunsten");
    }
  });

  it("付款块：IBAN 格式合法、SEPA 提示、Verwendungszweck", () => {
    const s = vm.settlement;
    if (s === undefined) throw new Error("missing settlement");
    expect(s.iban).toMatch(/^DE\d{2}( \d{4}){4} \d{2}$/);
    expect(s.iban.replaceAll(" ", "")).toHaveLength(22);
    const html = template.renderHtml(vm, { watermark: false });
    // SEPA 扣款提示仅在补收（Nachzahlung）时出现；结余（Guthaben）时为退款提示
    if (s.schlussbetrag < 0) {
      expect(html).toContain("erstattet");
    } else {
      expect(html).toContain("SEPA-Lastschrift");
    }
    expect(html).toContain("Verwendungszweck");
    expect(html).toContain("Jahresabrechnung");
    expect(html).toContain("Zählerstände");
  });

  it("德语数字格式：千分位点 + 小数逗号", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toMatch(/\d{1,3}(\.\d{3})*,\d{2} €/);
  });
});

describe("wl_gas（Gas-Jahresabrechnung：热值换算）", () => {
  const template = getTemplate("wl_gas");
  if (template === undefined) throw new Error("missing wl_gas");
  const input = makeInput("wl_gas");
  const vm = template.compute(input, rngForInput(input));

  it("换算：m³ × Brennwert × Zustandszahl = kWh", () => {
    const conv = vm.conversion;
    expect(conv).toBeDefined();
    if (conv === undefined) return;
    expect(Math.abs(conv.cubicMeters * conv.brennwert * conv.zustandszahl - conv.kwh)).toBeLessThan(0.51);
    expect(conv.brennwert).toBeGreaterThan(11);
    expect(conv.zustandszahl).toBeGreaterThan(0.9);
    expect(conv.zustandszahl).toBeLessThan(1);
  });

  it("勾稽：netto + USt = brutto；brutto − Abschläge = schlussbetrag", () => {
    const s = vm.settlement;
    if (s === undefined) throw new Error("missing settlement");
    expect(Math.abs(vm.subtotal + vm.tax - vm.total)).toBeLessThan(0.005);
    expect(Math.abs(vm.total - s.installmentsTotal - s.schlussbetrag)).toBeLessThan(0.02);
  });

  it("渲染含换算块与 Erdgassteuer", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Thermische Abrechnung");
    expect(html).toContain("Brennwert");
    expect(html).toContain("Zustandszahl");
    expect(html).toContain("Erdgassteuer");
  });

  it("PLZ pattern：必须恰好 5 位数字", () => {
    const base = makeInput("wl_gas");
    expect(validateBillInput(template, base).ok).toBe(true);
    const bad = validateBillInput(template, {
      ...base,
      address: { ...base.address, plz: "9124" },
    });
    expect(bad.errors["plz"]).toBeDefined();
    const bad2 = validateBillInput(template, {
      ...base,
      address: { ...base.address, plz: "9124A" },
    });
    expect(bad2.errors["plz"]).toBeDefined();
  });
});

/* ================= 港/澳/加/新/英 五个流派专项断言 ================= */

function computeVm(docType: string) {
  const template = getTemplate(docType);
  if (template === undefined) throw new Error(`missing ${docType}`);
  const input = makeInput(docType);
  const vm = template.compute(input, rngForInput(input));
  return { template, input, vm };
}

describe("lc_water（香港：分级水价 + 排污费 + 缴款回条）", () => {
  const { template, vm } = computeVm("lc_water");

  it("四级水价：各档用量之和 = 总用量，首级免费", () => {
    const tierLines = vm.charges.filter((c) => c.label.startsWith("Tier"));
    expect(tierLines).toHaveLength(4);
    const m3 = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    const rates = [0, 4.16, 6.45, 9.05];
    let qtySum = 0;
    for (let i = 0; i < 4; i++) {
      const line = tierLines[i];
      if (line === undefined) throw new Error("missing tier");
      const match = /Tier (\d)[^·]*· ([\d,]+) m³ × LKD ([\d.]+)/.exec(line.label);
      expect(match).not.toBeNull();
      const qty = Number((match?.[2] ?? "0").replaceAll(",", ""));
      qtySum += qty;
      expect(Number(match?.[3])).toBe(rates[i]);
      expect(Math.abs(line.amount - Math.round(qty * (rates[i] ?? 0) * 100) / 100)).toBeLessThan(0.005);
    }
    expect(qtySum).toBe(m3);
    expect(tierLines[0]?.amount).toBe(0); // 首级免费
  });

  it("排污费 = 用水量 × 70% × 2.92，账单无税项", () => {
    const sewage = vm.charges.find((c) => c.label.includes("Sewage"));
    expect(sewage).toBeDefined();
    const m3 = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    expect(Math.abs((sewage?.amount ?? 0) - Math.round(m3 * 0.7 * 2.92 * 100) / 100)).toBeLessThan(0.01);
    expect(vm.tax).toBe(0);
    expect(vm.total).toBe(vm.subtotal);
  });

  it("双语 + 缴款回条：含 CJK、商户编号、缴款限期", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("水費單");
    expect(html).toContain("繳款回條");
    expect(html).toContain("繳費靈商戶編號");
    expect(html).toContain("繳款限期");
    expect(html).toContain("PingFang TC"); // CJK 字体栈
    expect(/[\u4e00-\u9fff]/.test(html)).toBe(true);
  });
});

describe("lc_power（香港：分级电价 + 燃料调整费，双月账期）", () => {
  const { template, vm } = computeVm("lc_power");

  it("各档电量之和 = 总用量；燃料调整费 = kWh × 0.46", () => {
    const blockLines = vm.charges.filter((c) => c.label.startsWith("Block"));
    const kwh = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    let qtySum = 0;
    for (const line of blockLines) {
      const match = /Block \d[^·]*· ([\d,]+) kWh × LKD [\d.]+/.exec(line.label);
      expect(match).not.toBeNull();
      qtySum += Number((match?.[1] ?? "0").replaceAll(",", ""));
    }
    expect(qtySum).toBe(kwh);
    const fuel = vm.charges.find((c) => c.label.includes("Fuel cost adjustment"));
    expect(Math.abs((fuel?.amount ?? 0) - Math.round(kwh * 0.46 * 100) / 100)).toBeLessThan(0.01);
    expect(vm.periodDays).toBe(60);
  });

  it("双语渲染", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("電費單");
    expect(html).toContain("燃料調整費");
  });
});

describe("co_power（澳洲：NMI + GST 内含 + BPAY + 柱图）", () => {
  const { template, vm } = computeVm("co_power");

  it("NMI 10 位数字；GST = subtotal × 10%；total 内含 GST", () => {
    expect(vm.meterRows[0]?.label).toMatch(/NMI \d{10}/);
    expect(Math.abs(vm.tax - Math.round(vm.subtotal * 0.1 * 100) / 100)).toBeLessThan(0.005);
    expect(vm.taxLabel).toContain("included");
    expect(Math.abs(vm.subtotal + vm.tax - vm.total)).toBeLessThan(0.005);
  });

  it("6 期柱图；渲染含 BPAY 块", () => {
    expect(vm.bars).toHaveLength(6);
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("BPAY");
    expect(html).toContain("Biller Code");
    expect(html).toContain("Ref:");
  });
});

describe("co_gas（澳洲：MIRN + MJ）", () => {
  const { template, vm } = computeVm("co_gas");

  it("MIRN 10 位数字；MJ 单位；GST 内含", () => {
    expect(vm.meterRows[0]?.label).toMatch(/MIRN \d{10}/);
    expect(vm.usageSummary).toContain("MJ");
    expect(vm.taxLabel).toContain("included");
  });

  it("渲染含 BPAY 与 MJ", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("BPAY");
    expect(html).toContain("MJ");
  });
});

describe("nl_power（加拿大：Step 1 / Step 2 阶梯）", () => {
  const { template, vm } = computeVm("nl_power");

  it("Step1 + Step2 电量 = 总用量；GST 5%", () => {
    const kwh = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    const s1 = /Step 1 · ([\d,]+) kWh/.exec(vm.charges.find((c) => c.label.startsWith("Step 1"))?.label ?? "");
    const s2 = /Step 2 · ([\d,]+) kWh/.exec(vm.charges.find((c) => c.label.startsWith("Step 2"))?.label ?? "");
    const q1 = Number((s1?.[1] ?? "0").replaceAll(",", ""));
    const q2 = Number((s2?.[1] ?? "0").replaceAll(",", ""));
    expect(q1 + q2).toBe(kwh);
    expect(q1).toBeLessThanOrEqual(1350);
    expect(vm.taxLabel).toBe("GST (5%)");
    expect(Math.abs(vm.subtotal * 0.05 - vm.tax)).toBeLessThan(0.005);
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Step 1");
  });
});

describe("nl_gas（加拿大：carbon charge per m³ 分行）", () => {
  const { vm } = computeVm("nl_gas");

  it("carbon charge = m³ × 0.1535；delivery/commodity 分行", () => {
    const m3 = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    const carbon = vm.charges.find((c) => c.label.startsWith("Carbon charge"));
    expect(carbon).toBeDefined();
    expect(Math.abs((carbon?.amount ?? 0) - Math.round(m3 * 0.1535 * 100) / 100)).toBeLessThan(0.005);
    expect(vm.charges.some((c) => c.label.startsWith("Delivery charge"))).toBe(true);
    expect(vm.charges.some((c) => c.label.startsWith("Commodity charge"))).toBe(true);
  });
});

describe("eq_utilities（新加坡：水电合一三 section + GIRO）", () => {
  const { template, vm } = computeVm("eq_utilities");

  it("三 section：Electricity / Water / Refuse；ΣsectionTotal = subtotal；GST 9% 外加", () => {
    expect(vm.sections).toHaveLength(3);
    const titles = (vm.sections ?? []).map((s) => s.title);
    expect(titles[0]).toContain("Electricity");
    expect(titles[1]).toContain("Water");
    expect(titles[2]).toContain("Refuse");
    const sum = (vm.sections ?? []).reduce((acc, s) => acc + s.sectionTotal, 0);
    expect(Math.abs(sum - vm.subtotal)).toBeLessThan(0.005);
    for (const s of vm.sections ?? []) {
      const lineSum = s.lines.reduce((acc, l) => acc + l.amount, 0);
      expect(Math.abs(lineSum - s.sectionTotal)).toBeLessThan(0.005);
    }
    expect(vm.taxLabel).toBe("GST (9%)");
    expect(Math.abs(vm.subtotal * 0.09 - vm.tax)).toBeLessThan(0.005);
  });

  it("水 section 内含 conservation tax + waterborne fee 分行", () => {
    const water = (vm.sections ?? [])[1];
    expect(water?.lines.some((l) => l.label.includes("Water Conservation Tax"))).toBe(true);
    expect(water?.lines.some((l) => l.label.includes("Waterborne Fee"))).toBe(true);
  });

  it("渲染含 GIRO 提示与三个 section 标题", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("GIRO");
    expect(html).toContain("Electricity");
    expect(html).toContain("Refuse removal");
  });
});

describe("eq_telecom（新加坡：月租 + 用量 itemized + GST 9%）", () => {
  const { vm } = computeVm("eq_telecom");
  it("subscription + usage 分行", () => {
    expect(vm.charges.some((c) => c.label.includes("subscription"))).toBe(true);
    expect(vm.charges.some((c) => c.label.includes("IDD voice usage"))).toBe(true);
    expect(vm.taxLabel).toBe("GST (9%)");
  });
});

describe("wn_energy（英国：dual fuel + MPAN/MPRN + VAT 5%）", () => {
  const { template, vm } = computeVm("wn_energy");

  it("Electricity + Gas 两 section，各 standing charge + unit rate", () => {
    expect(vm.sections).toHaveLength(2);
    const [elec, gas] = vm.sections ?? [];
    expect(elec?.title).toContain("Electricity");
    expect(gas?.title).toContain("Gas");
    for (const s of vm.sections ?? []) {
      expect(s.lines.some((l) => l.label.includes("standing charge"))).toBe(true);
      expect(s.lines.some((l) => l.label.includes("unit rate"))).toBe(true);
    }
    const sum = (elec?.sectionTotal ?? 0) + (gas?.sectionTotal ?? 0);
    expect(Math.abs(sum - vm.subtotal)).toBeLessThan(0.005);
    expect(vm.taxLabel).toBe("VAT at 5%");
  });

  it("MPAN / MPRN 表号格式；抄表读数带 e/a 标记", () => {
    const subtitles = (vm.sections ?? []).map((s) => s.subtitle ?? "").join("|");
    expect(subtitles).toMatch(/MPAN \d{2} \d{4} \d{4} \d{3}/);
    expect(subtitles).toMatch(/MPRN \d{10}/);
    const readings = vm.meterRows.flatMap((r) => [r.previous, r.current]).join(" ");
    expect(readings).toMatch(/ [ae] /);
  });

  it("渲染含 tariff name 与 Direct Debit", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Tariff: Standard Variable");
    expect(html).toContain("Direct Debit");
  });
});

describe("wn_water（英国：民用水免 VAT，半年账期）", () => {
  const { vm } = computeVm("wn_water");

  it("water + sewerage 分行；VAT 0 且带 zero-rated 说明", () => {
    expect(vm.charges.some((c) => c.label.startsWith("Water"))).toBe(true);
    expect(vm.charges.some((c) => c.label.startsWith("Sewerage"))).toBe(true);
    expect(vm.tax).toBe(0);
    expect(vm.taxLabel).toContain("zero-rated");
    expect(vm.total).toBe(vm.subtotal);
    expect(vm.periodDays).toBe(180);
  });
});

describe("新地区地址 pattern 校验", () => {
  it("northland postalCode：A1A 1A1 格式", () => {
    const { template, input } = computeVm("nl_power");
    void input;
    expect(validateBillInput(template, makeInput("nl_power")).ok).toBe(true);
    const bad = validateBillInput(template, {
      ...makeInput("nl_power"),
      address: { ...makeInput("nl_power").address, postalCode: "N4P2K" },
    });
    expect(bad.errors["postalCode"]).toBeDefined();
  });

  it("equatoria：unitNo 必须 #NN-NN，postalCode 必须 6 位", () => {
    const tpl = getTemplate("eq_utilities");
    if (tpl === undefined) throw new Error("missing eq_utilities");
    expect(validateBillInput(tpl, makeInput("eq_utilities")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("eq_utilities"),
      address: { ...makeInput("eq_utilities").address, unitNo: "12-34" },
    });
    expect(bad.errors["unitNo"]).toBeDefined();
  });

  it("wenlock postcode：英制 pattern", () => {
    const tpl = getTemplate("wn_energy");
    if (tpl === undefined) throw new Error("missing wn_energy");
    expect(validateBillInput(tpl, makeInput("wn_energy")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("wn_energy"),
      address: { ...makeInput("wn_energy").address, postcode: "WN4-2QA" },
    });
    expect(bad.errors["postcode"]).toBeDefined();
  });
});

/* ================= lc_power 升级（HK 住宅电费单流派特征） ================= */

describe("lc_power 升级：费用公式块 / 按金 / 日均柱图 / 账户条码 / 存根 OCR", () => {
  const template = getTemplate("lc_power");
  if (template === undefined) throw new Error("missing lc_power");
  const input = makeInput("lc_power");
  const vm = template.compute(input, rngForInput(input));

  it("费用公式勾稽：Energy + Fuel + Others = Total", () => {
    const energy = vm.charges
      .filter((c) => c.label.startsWith("Block"))
      .reduce((s, c) => s + c.amount, 0);
    const fuel = vm.charges.find((c) => c.label.includes("Fuel cost adjustment"))?.amount ?? -1;
    const others = vm.charges.find((c) => c.label.startsWith("Other charges"))?.amount ?? -1;
    expect(fuel).toBeGreaterThan(0);
    expect(others).toBe(0);
    expect(Math.abs(energy + fuel + others - vm.total)).toBeLessThan(0.005);
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Energy Charge");
    expect(html).toContain("Fuel Cost Adjustment");
    expect(html).toContain("Other Charges");
    expect(html).toContain("應繳總數");
  });

  it("按金：渲染含 Deposit 行且确定性（两次渲染一致）", () => {
    const html1 = template.renderHtml(vm, { watermark: false });
    const html2 = template.renderHtml(vm, { watermark: false });
    expect(html1).toBe(html2);
    expect(html1).toContain("客戶按金 Deposit on account");
    expect(html1).toMatch(/Deposit on account：<b[^>]*>LKD\s[\d,]+\.\d{2}<\/b>/);
  });

  it("平均每日用電量柱图：12 期、跨年、单位为度/日", () => {
    expect(vm.bars).toHaveLength(12);
    expect(vm.barUnit).toContain("度/日");
    expect(vm.barTitle).toBe("平均每日用電量");
    // 跨年：第一期与最后一期年份标签不同（billDate 2026-09-09，往前 11 个双月期）
    expect(vm.bars[0]?.label.endsWith("/24")).toBe(true);
    expect(vm.bars[11]?.label.endsWith("/26")).toBe(true);
    // 本期柱 = 本期用量 / 60 天（1 位小数）
    const kwh = Number((vm.meterRows[0]?.usage ?? "0").replace(/[^\d]/g, ""));
    expect(vm.bars[11]?.value).toBeCloseTo(Math.round((kwh / 60) * 10) / 10, 5);
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Average daily consumption");
  });

  it("顶部账户条码：XXXXX-XXXXX-X 格式", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("客戶號碼 Account number");
    expect(html).toMatch(/\d{5}-\d{5}-\d/);
  });

  it("存根：双语 + OCR 扫描行（hash 派生、确定性）", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("繳款回條");
    expect(html).toContain("繳款限期");
    expect(html).toMatch(/monospace;font-size:32px[^>]*>\d{10,}[\d ]+/);
    // OCR 行确定性：与 vm 内容绑定
    const vm2 = template.compute({ ...input }, rngForInput({ ...input }));
    expect(template.renderHtml(vm2, { watermark: false })).toBe(html);
  });

  it("不含真实机构字样（黑名单回归）", () => {
    const html = template.renderHtml(vm, { watermark: true });
    expect(html).not.toMatch(/clp|中電|港燈|hong ?kong electric/i);
  });
});
