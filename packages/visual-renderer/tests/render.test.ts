import { describe, expect, it } from "vitest";
import { evaluate, gymModel } from "@bcr/economics-core";
import { renderAt, type VisualSpec } from "../src/index";

describe("reproducible visual frames", () => {
  const spec: VisualSpec = {
    version: 1,
    template: "break-even",
    layout: "landscape",
    theme: "paper",
    title: "健身卡成本",
    source: "自设示例",
  };
  it("renders independent repeatable SVG frames", () => {
    const result = evaluate(gymModel());
    const first = renderAt({ spec, result });
    renderAt({ spec: { ...spec, template: "comparison" }, result, time: 0.4 });
    expect(renderAt({ spec, result })).toBe(first);
    expect(first).toContain("1440");
    expect(first).toContain("第 41 次起");
    expect(first).not.toContain("@keyframes");
  });
  it("supports portrait output and escapes authored labels", () => {
    const svg = renderAt({
      spec: { ...spec, layout: "portrait", title: "<script>alert(1)</script>" },
      result: evaluate(gymModel()),
    });
    expect(svg).toContain('width="1080"');
    expect(svg).not.toContain("<script>");
  });
  it("changes frames from explicit time and model input", () => {
    const model = gymModel(),
      result = evaluate(model);
    expect(renderAt({ spec, result, time: 0.4 })).not.toBe(renderAt({ spec, result, time: 1 }));
    model.parameters.fixed.value = "3000";
    expect(renderAt({ spec, result: evaluate(model) })).toContain("第 51 次起");
  });
});
