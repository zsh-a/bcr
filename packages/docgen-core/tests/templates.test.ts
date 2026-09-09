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
      expect(formatMoney(vm.currency, vm.total)).toContain(vm.currency);
    });

    it(`${template.docType}：dueDate = billDate + 21 天，账期长度正确`, () => {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      expect(vm.dueDate).toBe("30 Sep 2026");
      expect(vm.billDate).toBe("09 Sep 2026");
      expect(addDaysIso("2026-09-09", 21)).toBe("2026-09-30");
      const quarterly = new Set(["nh_water", "cs_water"]);
      expect(vm.periodDays).toBe(quarterly.has(template.docType) ? 90 : 30);
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
