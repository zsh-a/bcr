import type { OperationDef } from "../model";

/** Operation 目录面板：点击添加节点（GraphCanvas 侧 autoWire 自动接线）。 */
export function OperationPalette(props: {
  readonly registry: ReadonlyArray<OperationDef>;
  readonly onAdd: (operation: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {props.registry.map((op) => (
        <button
          key={op.operation}
          type="button"
          data-testid={`palette-${op.operation}`}
          onClick={() => props.onAdd(op.operation)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            textAlign: "left",
            padding: "6px 8px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            color: "var(--color-text)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ fontWeight: 600 }}>{op.label}</span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--color-faint)" }}>
              {op.runtime}
            </span>
          </span>
          <span style={{ fontSize: 9, color: "var(--color-faint)", lineHeight: 1.4 }}>
            {op.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
