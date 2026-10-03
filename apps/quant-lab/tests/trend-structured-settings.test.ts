import {
  Children,
  createElement,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Select } from "@bcr/react";
import {
  STRUCTURED_PULLBACK_VALUES,
  createTrendConfig,
  structuredPullbackResearchConfig,
  validateTrendConfig,
  type StructuredPullbackPolicy,
} from "@bcr/quant-core/trend";
import { StructuredPullbackSettings } from "../src/trend/workbench/StructuredPullbackSettings";
import { STRUCTURED_PULLBACK_LABELS } from "../src/trend/workbench/structured-pullback-labels";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;
function selects(node: ReactNode): ReactElement<SelectProps>[] {
  const found: ReactElement<SelectProps>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === Select) found.push(child as ReactElement<SelectProps>);
    found.push(...selects(child.props.children));
  });
  return found;
}
const fields = [
  ["keyLevel", "关键位要求"],
  ["shape", "回调结构要求"],
  ["confirmation", "结构确认时点"],
  ["keyRole", "关键位用途"],
  ["candle", "K 线确认"],
] as const;

describe("structured pullback settings boundary", () => {
  it("renders all and only core choices, preserving control order, labels and selected values", () => {
    const config = structuredPullbackResearchConfig(createTrendConfig());
    const policy = config.strategy.structuredPullback!;
    const onChange = vi.fn();
    const controls = selects(StructuredPullbackSettings({ policy, tradeMinutes: 30, onChange }));
    expect(controls.map((control) => control.props["aria-label"])).toEqual(
      fields.map(([, label]) => label),
    );
    expect(Object.keys(STRUCTURED_PULLBACK_LABELS).sort()).toEqual(
      Object.keys(STRUCTURED_PULLBACK_VALUES).sort(),
    );
    for (const [index, [field]] of fields.entries()) {
      const control = controls[index]!;
      expect(control.props.value).toBe(policy[field]);
      const options = Children.toArray(control.props.children).filter(
        isValidElement<{ value: string; children: string }>,
      );
      expect(options.map((option) => option.props.value)).toEqual(
        STRUCTURED_PULLBACK_VALUES[field],
      );
      const labels: Record<string, string> = STRUCTURED_PULLBACK_LABELS[field];
      expect(Object.keys(labels).sort()).toEqual([...STRUCTURED_PULLBACK_VALUES[field]].sort());
      for (const option of options) {
        expect(option.props.children).toBe(labels[option.props.value]);
        expect(option.props.children.trim()).not.toBe("");
      }
    }
    const markup = renderToStaticMarkup(
      createElement(StructuredPullbackSettings, { policy, tradeMinutes: 30, onChange }),
    );
    expect((markup.match(/<select\b/gu) ?? []).length).toBe(5);
    expect(markup).toContain("较大周期为2 小时");
    expect(markup).toContain("允许突破 K 线收盘确认");
    expect(markup).toContain("预设保留突破前确认与回调重测");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(fields)("changes only %s and preserves every other policy field", (field, label) => {
    const policy: StructuredPullbackPolicy = {
      keyLevel: "validated-ema",
      shape: "double-test",
      candle: "reversal",
      confirmation: "signal-close",
      keyRole: "impulse-context",
    };
    const before = structuredClone(policy);
    const onChange = vi.fn();
    const control = selects(
      StructuredPullbackSettings({ policy, tradeMinutes: 30, onChange }),
    ).find((element) => element.props["aria-label"] === label)!;
    for (const value of STRUCTURED_PULLBACK_VALUES[field]) {
      onChange.mockClear();
      control.props.onChange!({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...before, [field]: value });
      expect(onChange.mock.calls[0]![0]).not.toBe(policy);
      expect(policy).toEqual(before);
      const config = structuredPullbackResearchConfig(createTrendConfig());
      config.strategy.structuredPullback = onChange.mock.calls[0]![0];
      validateTrendConfig(config);
    }
  });
});
