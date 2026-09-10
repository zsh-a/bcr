import { describe, expect, it } from "vitest";
import { listAddresses, randomAddress } from "../src/address";
import { mulberry32 } from "../src/hash";
import { getTemplate, listTemplates, REGIONS, TEMPLATES } from "../src/registry";
import { validateBillInput } from "../src/validate";
import type { BillInput } from "../src/model";

describe("registry", () => {
  it("6 个地区、12 个模板、docType 唯一", () => {
    expect(REGIONS).toHaveLength(6);
    expect(TEMPLATES).toHaveLength(12);
    expect(new Set(TEMPLATES.map((t) => t.docType)).size).toBe(12);
  });

  it("listTemplates 按地区过滤；getTemplate 往返", () => {
    expect(listTemplates("australia").map((t) => t.docType)).toEqual([
      "au_agl_gas",
      "au_energyau_power",
    ]);
    expect(listTemplates("canada").map((t) => t.docType)).toEqual([
      "ca_bchydro_power",
      "ca_enmax_power",
      "ca_hydroone_power",
    ]);
    expect(listTemplates("hongkong").map((t) => t.docType)).toEqual([
      "hk_electricity_power",
      "hk_water_bill",
    ]);
    expect(listTemplates("singapore").map((t) => t.docType)).toEqual(["sg_singtel_telecom"]);
    expect(listTemplates("uk").map((t) => t.docType)).toEqual([
      "uk_britishgas_gas",
      "uk_eonnext_power",
      "uk_thameswater_water",
    ]);
    expect(listTemplates("germany").map((t) => t.docType)).toEqual(["wl_heizkosten"]);
    expect(listTemplates()).toHaveLength(12);
    for (const t of TEMPLATES) expect(getTemplate(t.docType)).toBe(t);
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("每个模板的字段 key 唯一", () => {
    for (const t of TEMPLATES) {
      expect(new Set(t.fields.map((f) => f.key)).size).toBe(t.fields.length);
    }
  });
});

describe("validateBillInput", () => {
  const gas = getTemplate("uk_britishgas_gas");
  if (gas === undefined) throw new Error("missing uk_britishgas_gas");

  const okInput: BillInput = {
    docType: "uk_britishgas_gas",
    name: "Oliver Smith",
    address: {
      streetNo: "12",
      streetName: "Mill Lane",
      city: "London",
      postcode: "SW1A 1AA",
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
      address: { streetNo: "", streetName: "Mill Lane", city: "", postcode: "SW1A 1AA" },
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["city", "name", "streetNo"]);
  });

  it("postcode pattern 校验", () => {
    const bad = validateBillInput(gas, {
      ...okInput,
      address: { ...okInput.address, postcode: "abcde" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors["postcode"]).toBeDefined();
    const good = validateBillInput(gas, {
      ...okInput,
      address: { ...okInput.address, postcode: "SW1A1AA" }, // 空格可选
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
    const a = randomAddress("australia", mulberry32(42));
    const b = randomAddress("australia", mulberry32(42));
    expect(a).toEqual(b);
    expect(listAddresses("australia")).toContainEqual(a);
  });

  it("每地区地址库均满足其模板字段 pattern（州/省缩写、邮编格式等）", () => {
    for (const t of TEMPLATES) {
      for (const entry of listAddresses(t.regionId)) {
        for (const field of t.fields) {
          const value = entry[field.key] ?? "";
          if (field.pattern !== undefined) {
            expect(value, `${t.docType}.${field.key}=${value}`).toMatch(field.pattern);
          }
        }
      }
    }
  });
});
