import type { CSSProperties } from "react";
import type { ConfigField, OperationDef } from "../model";

/**
 * 节点配置表单：由 OperationDef.config 声明式字段自动生成，不手写表单。
 * 样式只依赖 --color-* 设计变量。
 */
export function ConfigForm(props: {
  readonly op: OperationDef;
  readonly value: Record<string, unknown>;
  readonly onChange: (patch: Record<string, unknown>) => void;
}) {
  const fields = props.op.config ?? [];
  if (fields.length === 0) {
    return <div style={{ fontSize: 10, color: "var(--color-faint)" }}>该节点无可配置项</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={props.value[field.key] ?? field.default}
          onChange={(v) => props.onChange({ [field.key]: v })}
        />
      ))}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text)",
  fontSize: 11,
  padding: "3px 6px",
  outline: "none",
};

function Field(props: {
  readonly field: ConfigField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  const { field, value } = props;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--color-faint)" }}>{field.label}</span>
      {field.kind === "boolean" ? (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => props.onChange(e.target.checked)}
          style={{ width: 13, height: 13, accentColor: "var(--color-accent)" }}
        />
      ) : field.kind === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => props.onChange(e.target.value)}
          style={inputStyle}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.kind === "number" ? (
        <input
          type="number"
          value={typeof value === "number" ? value : Number(value ?? field.default)}
          onChange={(e) => props.onChange(e.target.valueAsNumber)}
          style={inputStyle}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => props.onChange(e.target.value)}
          style={inputStyle}
        />
      )}
    </label>
  );
}
