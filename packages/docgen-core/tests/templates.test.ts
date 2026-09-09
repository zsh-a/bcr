import { describe, expect, it } from "vitest";
import { getTemplate, rngForInput, TEMPLATES } from "../src/registry";
import { addDaysIso, formatMoney } from "../src/templates/common";
import type { BillInput } from "../src/model";

const ADDRESSES: Record<string, Record<string, string>> = {
  nh_water: { street: "14 Fjordgate", city: "Nordhavn", province: "Havnmark" },
  nh_power: { street: "27 Havnevej", city: "Nordhavn", province: "Havnmark" },
  ci_gas: { streetNumber: "12", streetName: "Cinder Lane", town: "Port Ember", postcode: "CE14 2PA" },
  ci_telecom: { streetNumber: "7", streetName: "Obsidian Way", town: "Caldera City", postcode: "CC02 9QR" },
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
      expect(Math.abs(vm.subtotal + vm.tax - vm.total)).toBeLessThan(0.005);
      expect(vm.total).toBeGreaterThan(0);
      expect(formatMoney(vm.currency, vm.total)).toContain(vm.currency);
    });

    it(`${template.docType}：dueDate = billDate + 21 天，账期长度正确`, () => {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      expect(vm.dueDate).toBe("30 Sep 2026");
      expect(vm.billDate).toBe("09 Sep 2026");
      expect(addDaysIso("2026-09-09", 21)).toBe("2026-09-30");
      const expectedDays = template.docType === "nh_water" ? 90 : 30;
      expect(vm.periodDays).toBe(expectedDays);
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
