import { describe, expect, it } from "vitest";
import { removeEdge } from "@bcr/graph";
import { defaultGraph, withTranslate } from "../src/operations";
import type { StudioSettings } from "../src/store";

const SETTINGS: StudioSettings = {
  model: "Xenova/whisper-tiny",
  engine: "auto",
  translate: true,
};

describe("withTranslate", () => {
  it("默认图带 translate 时两条输入边齐全", () => {
    const g = defaultGraph(SETTINGS);
    const into = g.edges.filter((e) => e.to === "translate").map((e) => e.type);
    expect(into.sort()).toEqual(["audio/pcm-f32", "subtitle/cues"]);
  });

  it("节点已存在但缺边（旧持久化图）时补齐输入边", () => {
    let g = defaultGraph(SETTINGS);
    const pcmEdge = g.edges.find((e) => e.to === "translate" && e.type === "audio/pcm-f32");
    g = removeEdge(g, pcmEdge!.id);

    const healed = withTranslate(g, SETTINGS);
    const into = healed.edges.filter((e) => e.to === "translate").map((e) => e.type);
    expect(into.sort()).toEqual(["audio/pcm-f32", "subtitle/cues"]);
    // 不重复加节点
    expect(healed.nodes.filter((n) => n.operation === "subtitle.translate")).toHaveLength(1);
  });

  it("已完整时不产生重复边", () => {
    const g = defaultGraph(SETTINGS);
    const again = withTranslate(g, SETTINGS);
    expect(again.edges).toEqual(g.edges);
  });
});
