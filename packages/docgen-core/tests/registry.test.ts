import { describe, expect, it } from "vitest";
import { listAddresses, randomAddress } from "../src/address";
import { mulberry32 } from "../src/hash";
import { getTemplate, listTemplates, REGIONS, TEMPLATES } from "../src/registry";
import { validateBillInput } from "../src/validate";
import type { BillInput } from "../src/model";

describe("registry", () => {
  it("2 个虚构地区、4 个模板、docType 唯一", () => {
    expect(REGIONS).toHaveLength(2);
    expect(TEMPLATES).toHaveLength(4);
    expect(new Set(TEMPLATES.map((t) => t.docType)).size).toBe(4);
  });

  it("listTemplates 按地区过滤；getTemplate 往返", () => {
    expect(listTemplates("nordhavn").map((t) => t.docType)).toEqual(["nh_water", "nh_power"]);
    expect(listTemplates("caldera").map((t) => t.docType)).toEqual(["ci_gas", "ci_telecom"]);
    expect(listTemplates()).toHaveLength(4);
    for (const t of TEMPLATES) expect(getTemplate(t.docType)).toBe(t);
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("每个模板的字段 key 唯一", () => {
    for (const t of TEMPLATES) {
      expect(new Set(t.fields.map((f) => f.key)).size).toBe(t.fields.length);
    }
  });

  it("全部为虚构机构，不含真实公用事业公司名", () => {
    const banned = /thames|bc hydro|british gas|edf|anglian|severn|octopus|sse\b|e\.on|veolia|suez/i;
    for (const t of TEMPLATES) {
      const input: BillInput = {
        docType: t.docType,
        name: "Test",
        address: {},
        billDate: "2026-09-09",
      };
      const vm = t.compute(input, (() => {
        let i = 0;
        return () => (i = (i + 0.37) % 1);
      })());
      expect(vm.utilityName).not.toMatch(banned);
      expect(t.renderHtml(vm, { watermark: true })).not.toMatch(banned);
    }
  });
});

describe("validateBillInput", () => {
  const gas = getTemplate("ci_gas");
  if (gas === undefined) throw new Error("missing ci_gas");

  const okInput: BillInput = {
    docType: "ci_gas",
    name: "Ana Ribeiro",
    address: {
      streetNumber: "12",
      streetName: "Cinder Lane",
      town: "Port Ember",
      postcode: "CE14 2PA",
    },
    billDate: "2026-09-09",
  };

  it("合法输入 ok", () => {
    expect(validateBillInput(gas, okInput)).toEqual({ ok: true, errors: {} });
  });

  it("缺必填字段 → 逐字段错误", () => {
    const result = validateBillInput(gas, {
      ...okInput,
      name: "",
      address: { streetNumber: "", streetName: "Cinder Lane", town: "", postcode: "CE14 2PA" },
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["name", "streetNumber", "town"]);
  });

  it("postcode pattern 校验", () => {
    const bad = validateBillInput(gas, {
      ...okInput,
      address: { ...okInput.address, postcode: "abcde" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors["postcode"]).toContain("邮编");
    const good = validateBillInput(gas, {
      ...okInput,
      address: { ...okInput.address, postcode: "CE142PA" }, // 空格可选
    });
    expect(good.ok).toBe(true);
  });

  it("maxLength 校验", () => {
    const result = validateBillInput(gas, {
      ...okInput,
      address: { ...okInput.address, streetName: "x".repeat(60) },
    });
    expect(result.errors["streetName"]).toContain("过长");
  });

  it("billDate 为 null 合法，非法格式报错", () => {
    expect(validateBillInput(gas, { ...okInput, billDate: null }).ok).toBe(true);
    const bad = validateBillInput(gas, { ...okInput, billDate: "09/09/2026" });
    expect(bad.errors["billDate"]).toBeDefined();
  });
});

describe("randomAddress", () => {
  it("每地区 ≥12 条，且键与模板字段一致", () => {
    for (const t of TEMPLATES) {
      const entries = listAddresses(t.regionId);
      expect(entries.length).toBeGreaterThanOrEqual(12);
      const keys = t.fields.map((f) => f.key).sort();
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(keys);
        for (const key of keys) expect(entry[key]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("确定性：同 seed 同结果", () => {
    const a = randomAddress("nordhavn", mulberry32(42));
    const b = randomAddress("nordhavn", mulberry32(42));
    expect(a).toEqual(b);
    expect(listAddresses("nordhavn")).toContainEqual(a);
  });

  it("caldera 邮编均满足模板 pattern", () => {
    const gas = getTemplate("ci_gas");
    if (gas === undefined) throw new Error("missing ci_gas");
    const postcodeField = gas.fields.find((f) => f.key === "postcode");
    for (const entry of listAddresses("caldera")) {
      expect(entry["postcode"] ?? "").toMatch(postcodeField?.pattern ?? /$^/);
    }
  });
});
