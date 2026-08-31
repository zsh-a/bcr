import { describe, expect, it } from "vitest";
import { compile, removeEdge } from "@bcr/graph";
import { OPERATIONS, defaultGraph, withTranslate } from "../src/operations";
import type { StudioSettings } from "../src/store";

const SETTINGS: StudioSettings = {
  model: "Xenova/whisper-tiny",
  engine: "auto",
  translate: true,
  direction: "en-zh",
  language: "auto",
};

describe("withTranslate", () => {
  it("默认图带 translate：单条 cues 输入边（opus-mt 文本翻译）", () => {
    const g = defaultGraph(SETTINGS);
    const into = g.edges.filter((e) => e.to === "translate").map((e) => e.type);
    expect(into).toEqual(["subtitle/cues"]);
  });

  it("节点已存在但缺边（旧持久化图）时补齐输入边", () => {
    let g = defaultGraph(SETTINGS);
    const cuesEdge = g.edges.find((e) => e.to === "translate" && e.type === "subtitle/cues");
    g = removeEdge(g, cuesEdge!.id);

    const healed = withTranslate(g, SETTINGS);
    const into = healed.edges.filter((e) => e.to === "translate").map((e) => e.type);
    expect(into).toEqual(["subtitle/cues"]);
    // 不重复加节点
    expect(healed.nodes.filter((n) => n.operation === "subtitle.translate")).toHaveLength(1);
  });

  it("已完整时不产生重复边", () => {
    const g = defaultGraph(SETTINGS);
    const again = withTranslate(g, SETTINGS);
    expect(again.edges).toEqual(g.edges);
  });

  it("旧版图（translate 带 pcm 入边）仍可编译：废弃边被迁移器忽略", () => {
    let g = defaultGraph(SETTINGS);
    // 模拟旧版持久化图：手动补一条 decode→translate 的 pcm 边（新目录已无此端口）
    g = {
      ...g,
      edges: [
        ...g.edges,
        {
          id: "decode->translate:audio/pcm-f32",
          from: "decode",
          to: "translate",
          type: "audio/pcm-f32",
        },
      ],
    };
    const nodes = compile(g, OPERATIONS, {
      sourceInputs: [{ id: "s", type: "file/wav", storage: "opfs" }],
    });
    const translate = nodes.find((n) => n.id === "translate");
    expect(translate?.after).toEqual(["segment"]);
    expect(translate?.bindings).toEqual([{ from: "segment", output: "cues", input: "cues" }]);
  });
});
