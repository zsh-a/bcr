import { describe, expect, it } from "vitest";
import { getTemplate, rngForInput, TEMPLATES } from "../src/registry";
import { validateBillInput } from "../src/validate";
import { addDaysIso, formatMoney } from "../src/templates/common";
import type { BillInput } from "../src/model";

const ADDRESSES: Record<string, Record<string, string>> = {
  au_agl_gas: {
    streetNo: "14",
    streetName: "Banksia Street",
    suburb: "Bondi",
    state: "NSW",
    postcode: "2026",
  },
  au_energyau_power: {
    streetNo: "27",
    streetName: "Chapel Street",
    suburb: "South Yarra",
    state: "VIC",
    postcode: "3141",
  },
  ca_bchydro_power: {
    streetNo: "142",
    streetName: "Granville Street",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6B 1P1",
  },
  ca_enmax_power: {
    streetNo: "36",
    streetName: "17 Avenue SW",
    city: "Calgary",
    province: "AB",
    postalCode: "T2S 0A1",
  },
  ca_hydroone_power: {
    streetNo: "7",
    streetName: "Yonge Street",
    city: "Toronto",
    province: "ON",
    postalCode: "M5C 1W7",
  },
  hk_electricity_power: {
    flat: "Flat A, 12/F",
    estate: "Mei Foo Sun Chuen, Block 3",
    district: "Kowloon",
  },
  hk_water_bill: {
    flat: "Flat 5B, 23/F",
    estate: "Taikoo Shing, Harbour View Gardens",
    district: "Hong Kong Island",
  },
  sg_singtel_telecom: {
    blockStreet: "Blk 128 Bishan Street 12",
    unitNo: "#12-34",
    postalCode: "570128",
  },
  uk_britishgas_gas: {
    streetNo: "12",
    streetName: "Mill Lane",
    city: "London",
    postcode: "SW1A 1AA",
  },
  uk_eonnext_power: {
    streetNo: "27",
    streetName: "Foxglove Row",
    city: "Manchester",
    postcode: "M1 1AE",
  },
  uk_thameswater_water: {
    streetNo: "3",
    streetName: "Abbey Close",
    city: "Oxford",
    postcode: "OX1 2JD",
  },
  wl_heizkosten: { strasse: "Hauptstraße 12", plz: "10115", ort: "Berlin" },
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
        // 账户摘要流派：total = 上期余额 − 已收款 + 本期费用（subtotal + tax）
        const current = vm.subtotal + vm.tax;
        expect(Math.abs(vm.accountSummary.currentCharges - current)).toBeLessThan(0.005);
        const expected =
          vm.accountSummary.previousBalance - vm.accountSummary.paymentsReceived + current;
        expect(Math.abs(expected - vm.total)).toBeLessThan(0.005);
      } else {
        expect(Math.abs(vm.subtotal + vm.tax - vm.total)).toBeLessThan(0.005);
      }
      expect(vm.total).toBeGreaterThan(0);
      // 真实货币：en-US 下渲染为符号（$ / £ / €，含 HK$ / A$ 等复合符号）或代码前缀
      const formatted = formatMoney(vm.currency, vm.total);
      expect(formatted.includes(vm.currency) || /[$€£]/.test(formatted)).toBe(true);
    });

    it(`${template.docType}：dueDate = billDate + 21 天，账期长度正确`, () => {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      expect(vm.dueDate).toBe("30 Sep 2026");
      expect(vm.billDate).toBe("09 Sep 2026");
      expect(addDaysIso("2026-09-09", 21)).toBe("2026-09-30");
      const periodDays: Record<string, number> = {
        au_agl_gas: 90,
        au_energyau_power: 90,
        ca_bchydro_power: 30,
        ca_enmax_power: 30,
        ca_hydroone_power: 30,
        hk_electricity_power: 60,
        hk_water_bill: 123,
        sg_singtel_telecom: 30,
        uk_britishgas_gas: 31,
        uk_eonnext_power: 31,
        uk_thameswater_water: 190,
        wl_heizkosten: 184,
      };
      expect(vm.periodDays).toBe(periodDays[template.docType]);
    });
  }

  it("billDate 为 null 时自动取当天（合法 ISO 日期）", () => {
    const template = getTemplate("sg_singtel_telecom");
    expect(template).toBeDefined();
    if (template === undefined) return;
    const input: BillInput = { ...makeInput("sg_singtel_telecom"), billDate: null };
    const vm = template.compute(input, rngForInput(input));
    expect(vm.billDate).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
  });
});

describe("renderHtml", () => {
  it("包含姓名（转义后）、金额、画布尺寸、内联 SVG 与虚构声明", () => {
    const template = getTemplate("au_agl_gas");
    if (template === undefined) throw new Error("missing au_agl_gas");
    const input: BillInput = { ...makeInput("au_agl_gas"), name: "O'Neil <script>" };
    const vm = template.compute(input, rngForInput(input));
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("O&#39;Neil &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("width:2481px");
    expect(html).toContain("height:3509px");
    expect(html).toContain("<svg"); // barcode / qr / logo
    expect(html).toContain(vm.billDate);
    expect(html).toContain("FICTIONAL SAMPLE DOCUMENT");
  });

  it("watermark 开关：仅开启时出现水印短语", () => {
    const template = getTemplate("uk_eonnext_power");
    if (template === undefined) throw new Error("missing uk_eonnext_power");
    const input = makeInput("uk_eonnext_power");
    const vm = template.compute(input, rngForInput(input));
    const on = template.renderHtml(vm, { watermark: true });
    const off = template.renderHtml(vm, { watermark: false });
    expect(on).toContain("FICTIONAL SAMPLE · 虚构文档 · 仅供学习");
    expect(off).not.toContain("FICTIONAL SAMPLE · 虚构文档 · 仅供学习");
  });

  it("全模板 XML 安全：只含 XML 预定义/数值实体（foreignObject 栅格化前提）", () => {
    // rasterize 把 HTML 嵌入 SVG data URL 按 XML 解析：&nbsp; 等命名实体或未转义的 &
    // 会直接让 SVG 图像加载失败。这里静态拦截回归。
    const unsafeEntity = /&(?!amp;|lt;|gt;|quot;|apos;|#)/;
    for (const template of TEMPLATES) {
      const input = makeInput(template.docType);
      const vm = template.compute(input, rngForInput(input));
      const html = template.renderHtml(vm, { watermark: true });
      const match = unsafeEntity.exec(html);
      expect(
        match === null,
        `${template.docType} 含非 XML 实体: ${match?.[0] ?? ""} …${html.slice((match?.index ?? 0) - 30, (match?.index ?? 0) + 30)}`,
      ).toBe(true);
    }
  });
});

/* ================= 各地区字段 pattern 校验 ================= */

describe("字段 pattern 校验", () => {
  it("australia：state 必须 2–3 位大写字母", () => {
    const tpl = getTemplate("au_agl_gas");
    if (tpl === undefined) throw new Error("missing au_agl_gas");
    expect(validateBillInput(tpl, makeInput("au_agl_gas")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("au_agl_gas"),
      address: { ...makeInput("au_agl_gas").address, state: "nsw" },
    });
    expect(bad.errors["state"]).toBeDefined();
  });

  it("canada：postalCode 必须 A1A 1A1 格式", () => {
    const tpl = getTemplate("ca_bchydro_power");
    if (tpl === undefined) throw new Error("missing ca_bchydro_power");
    expect(validateBillInput(tpl, makeInput("ca_bchydro_power")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("ca_bchydro_power"),
      address: { ...makeInput("ca_bchydro_power").address, postalCode: "V6B 1P" },
    });
    expect(bad.errors["postalCode"]).toBeDefined();
  });

  it("singapore：unitNo 必须 #NN-NN，postalCode 必须 6 位", () => {
    const tpl = getTemplate("sg_singtel_telecom");
    if (tpl === undefined) throw new Error("missing sg_singtel_telecom");
    expect(validateBillInput(tpl, makeInput("sg_singtel_telecom")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("sg_singtel_telecom"),
      address: { ...makeInput("sg_singtel_telecom").address, unitNo: "12-34" },
    });
    expect(bad.errors["unitNo"]).toBeDefined();
  });

  it("uk：postcode 英制 pattern（SW1A 1AA / M1 1AE 均合法）", () => {
    const tpl = getTemplate("uk_britishgas_gas");
    if (tpl === undefined) throw new Error("missing uk_britishgas_gas");
    expect(validateBillInput(tpl, makeInput("uk_britishgas_gas")).ok).toBe(true);
    const m1 = validateBillInput(tpl, {
      ...makeInput("uk_britishgas_gas"),
      address: { ...makeInput("uk_britishgas_gas").address, postcode: "M1 1AE" },
    });
    expect(m1.ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("uk_britishgas_gas"),
      address: { ...makeInput("uk_britishgas_gas").address, postcode: "SW1A-1AA" },
    });
    expect(bad.errors["postcode"]).toBeDefined();
  });

  it("germany：plz 必须恰好 5 位数字", () => {
    const tpl = getTemplate("wl_heizkosten");
    if (tpl === undefined) throw new Error("missing wl_heizkosten");
    expect(validateBillInput(tpl, makeInput("wl_heizkosten")).ok).toBe(true);
    const bad = validateBillInput(tpl, {
      ...makeInput("wl_heizkosten"),
      address: { ...makeInput("wl_heizkosten").address, plz: "1011" },
    });
    expect(bad.errors["plz"]).toBeDefined();
  });
});

/* ============ wl_heizkosten（德国暖气费分摊结算单 · Techem 版式） ============ */

describe("wl_heizkosten（Heiz- und Hausnebenkostenabrechnung：分摊表 + Ablesewerte）", () => {
  const template = getTemplate("wl_heizkosten");
  if (template === undefined) throw new Error("missing wl_heizkosten");
  const input = makeInput("wl_heizkosten");
  const vm = template.compute(input, rngForInput(input));

  it("四类费用 = subtotal = total，无增值税分行", () => {
    expect(vm.charges).toHaveLength(4);
    const labels = vm.charges.map((c) => c.label).join("|");
    expect(labels).toContain("Heizkosten");
    expect(labels).toContain("Kaltwasserkosten");
    expect(labels).toContain("Betriebskosten");
    expect(labels).toContain("Direktkosten");
    expect(vm.tax).toBe(0);
    expect(vm.total).toBe(vm.subtotal);
  });

  it("分摊表：30% Grundkosten + 70% Verbrauchskosten = Ihre Heizkosten = Heizkosten 费用行", () => {
    const rows = vm.allocation;
    expect(rows).toBeDefined();
    if (rows === undefined) return;
    const heizkosten = vm.charges.find((c) => c.label.includes("Heizkosten"));
    const grund = rows.find((r) => r.label.includes("Grundkosten"));
    const verbrauch = rows.find((r) => r.label.includes("Verbrauchskosten"));
    const ihreHeiz = rows.find((r) => r.label.startsWith("Ihre Heizkosten"));
    const de = (s: string): number =>
      Number(
        s
          .replaceAll(".", "")
          .replaceAll(",", ".")
          .replace(/[^\d.\-−]/g, "")
          .replace("−", "-"),
      );
    const sum = de(grund?.ownCost ?? "0") + de(verbrauch?.ownCost ?? "0");
    expect(Math.abs(sum - de(ihreHeiz?.ownCost ?? "0"))).toBeLessThan(0.02);
    expect(Math.abs(de(ihreHeiz?.ownCost ?? "0") - (heizkosten?.amount ?? -1))).toBeLessThan(0.02);
    const finalRow = rows[rows.length - 1];
    expect(finalRow?.label).toContain("Ihr Anteil an den Gesamtkosten");
    expect(Math.abs(de(finalRow?.ownCost ?? "0") - vm.total)).toBeLessThan(0.02);
  });

  it("渲染含德式元素：EWPBG 信息框、Ablesewerte、Fortsetzung、Seite 1/3、DD.MM.YYYY 日期", () => {
    const html = template.renderHtml(vm, { watermark: false });
    expect(html).toContain("Information zur Energiekostenentlastung");
    expect(html).toContain("Ihre Ablesewerte");
    expect(html).toContain("Fortsetzung auf der Folgeseite");
    expect(html).toContain("Seite 1/3");
    expect(html).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(html).toMatch(/\d{1,3}(\.\d{3})*,\d{2}\s(?:€|EUR)/);
  });
});
