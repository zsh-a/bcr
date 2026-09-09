/**
 * 按 FieldSchema 校验用户输入，返回逐字段错误（驱动表单行内提示）。
 */

import type { BillInput, BillTemplate } from "./model";

export interface ValidationResult {
  readonly ok: boolean;
  /** key 为字段 key 或 "name" / "billDate" */
  readonly errors: Record<string, string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateBillInput(template: BillTemplate, input: BillInput): ValidationResult {
  const errors: Record<string, string> = {};

  const name = input.name.trim();
  if (name.length === 0) {
    errors["name"] = "请填写客户姓名";
  } else if (name.length > 80) {
    errors["name"] = "姓名过长（最多 80 字符）";
  }

  for (const field of template.fields) {
    const value = (input.address[field.key] ?? "").trim();
    if (value.length === 0) {
      if (field.required) errors[field.key] = `请填写${field.label}`;
      continue;
    }
    if (value.length > field.maxLength) {
      errors[field.key] = `${field.label}过长（最多 ${field.maxLength} 字符）`;
      continue;
    }
    if (field.pattern !== undefined && !field.pattern.test(value)) {
      errors[field.key] = `${field.label}格式不正确（示例：${field.placeholder}）`;
    }
  }

  if (input.billDate !== null) {
    if (!ISO_DATE.test(input.billDate)) {
      errors["billDate"] = "日期格式应为 YYYY-MM-DD";
    } else {
      const date = new Date(`${input.billDate}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) errors["billDate"] = "日期无效";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
