import { describe, expect, it } from "vitest";
import type { ArtifactRef } from "@bcr/core";
import type { Graph, OperationDef } from "../src/model";
import {
  addEdge,
  addNode,
  autoWire,
  compile,
  connectableTypes,
  createsCycle,
  emptyGraph,
  removeNode,
} from "../src/model";
import { decodeGraph, encodeGraph } from "../src/schema";

const OPS: ReadonlyArray<OperationDef> = [
  {
    operation: "media.decode-audio",
    label: "Decode",
    detail: "",
    runtime: "js",
    inputs: [{ type: "file/wav" }],
    outputs: [{ type: "audio/pcm-f32" }, { type: "media/info" }],
  },
  {
    operation: "asr.transcribe",
    label: "ASR",
    detail: "",
    runtime: "wasm",
    inputs: [{ type: "audio/pcm-f32" }],
    outputs: [{ type: "subtitle/asr-chunks" }],
    config: [{ key: "model", label: "模型", kind: "string", default: "whisper-tiny" }],
  },
  {
    operation: "subtitle.segment",
    label: "Segment",
    detail: "",
    runtime: "wasm",
    inputs: [{ type: "subtitle/asr-chunks" }],
    outputs: [{ type: "subtitle/cues" }],
  },
];

const SOURCE: ArtifactRef = { id: "source/a.wav", type: "file/wav", storage: "opfs" };

function chain(): Graph {
  let g = addNode(emptyGraph, OPS[0]!, "decode", 0, 0);
  g = addNode(g, OPS[1]!, "asr", 200, 0);
  g = addNode(g, OPS[2]!, "segment", 400, 0);
  return g;
}

describe("connectableTypes / addEdge", () => {
  it("按类型交集连线", () => {
    expect(connectableTypes(OPS, "media.decode-audio", "asr.transcribe")).toEqual([
      "audio/pcm-f32",
    ]);
    expect(connectableTypes(OPS, "subtitle.segment", "asr.transcribe")).toEqual([]);
  });

  it("类型不兼容 / 自连 / 重复边返回 null", () => {
    let g = chain();
    expect(addEdge(g, OPS, "segment", "asr")).toBeNull();
    expect(addEdge(g, OPS, "asr", "asr")).toBeNull();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    expect(addEdge(g, OPS, "decode", "asr", "audio/pcm-f32")).toBeNull();
    expect(g.edges).toHaveLength(1);
  });

  it("拒绝成环", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;
    expect(createsCycle(g, "segment", "decode")).toBe(true);
    expect(addEdge(g, OPS, "segment", "decode")).toBeNull();
  });
});

describe("autoWire", () => {
  it("类型唯一可推导时自动接线", () => {
    let g = addNode(emptyGraph, OPS[0]!, "decode", 0, 0);
    g = addNode(g, OPS[1]!, "asr", 200, 0);
    g = autoWire(g, OPS, "asr");
    expect(g.edges).toEqual([
      { id: "decode->asr:audio/pcm-f32", from: "decode", to: "asr", type: "audio/pcm-f32" },
    ]);
  });
});

describe("compile", () => {
  it("拓扑排序 + after 推导 + 根节点注入 sourceInputs + config 透传", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;

    const nodes = compile(g, OPS, { sourceInputs: [SOURCE] });
    expect(nodes.map((n) => n.id)).toEqual(["decode", "asr", "segment"]);

    const decode = nodes[0]!;
    expect(decode.inputs).toEqual([SOURCE]);
    expect(decode.after).toBeUndefined();
    expect(decode.outputs).toEqual([{ type: "audio/pcm-f32" }, { type: "media/info" }]);

    const asr = nodes[1]!;
    expect(asr.after).toEqual(["decode"]);
    expect(asr.inputs).toBeUndefined();
    expect(asr.config).toEqual({ model: "whisper-tiny" });

    expect(nodes[2]!.after).toEqual(["asr"]);
  });

  it("编译结果与手写 pipeline 等价", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;
    const nodes = compile(g, OPS, { sourceInputs: [SOURCE] });
    expect(nodes).toEqual([
      {
        id: "decode",
        runtime: "js",
        operation: "media.decode-audio",
        inputs: [SOURCE],
        outputs: [{ type: "audio/pcm-f32" }, { type: "media/info" }],
      },
      {
        id: "asr",
        runtime: "wasm",
        operation: "asr.transcribe",
        after: ["decode"],
        outputs: [{ type: "subtitle/asr-chunks" }],
        config: { model: "whisper-tiny" },
      },
      {
        id: "segment",
        runtime: "wasm",
        operation: "subtitle.segment",
        after: ["asr"],
        outputs: [{ type: "subtitle/cues" }],
      },
    ]);
  });

  it("removeNode 连带清理边", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;
    g = removeNode(g, "asr");
    expect(g.nodes.map((n) => n.id)).toEqual(["decode", "segment"]);
    expect(g.edges).toEqual([]);
  });

  it("节点输入未接全时编译抛错（而非 worker 运行期才失败）", () => {
    const TRANSLATE: OperationDef = {
      operation: "subtitle.translate",
      label: "Translate",
      detail: "",
      runtime: "wasm",
      inputs: [{ type: "audio/pcm-f32" }, { type: "subtitle/cues" }],
      outputs: [{ type: "subtitle/cues" }],
    };
    const ops = [...OPS, TRANSLATE];
    let g = chain();
    g = addEdge(g, ops, "decode", "asr") ?? g;
    g = addEdge(g, ops, "asr", "segment") ?? g;
    g = addNode(g, TRANSLATE, "translate", 600, 0);
    // 只接 cues 边，缺 decode→translate 的 pcm 边（editor 删边/旧持久化图的情形）
    g = addEdge(g, ops, "segment", "translate", "subtitle/cues") ?? g;

    expect(() => compile(g, ops, { sourceInputs: [SOURCE] })).toThrow(
      'node "translate" (subtitle.translate) missing inputs: audio/pcm-f32',
    );

    g = addEdge(g, ops, "decode", "translate", "audio/pcm-f32") ?? g;
    expect(() => compile(g, ops, { sourceInputs: [SOURCE] })).not.toThrow();
  });

  it("根节点通配端口 file/* 匹配任意 file/xx 源", () => {
    const WILDCARD: OperationDef = {
      ...OPS[0]!,
      inputs: [{ type: "file/*" }],
    };
    const g = addNode(emptyGraph, WILDCARD, "decode", 0, 0);
    expect(() =>
      compile(g, [WILDCARD], {
        sourceInputs: [{ id: "source/a.mp4", type: "file/mp4", storage: "opfs" }],
      }),
    ).not.toThrow();
    expect(() => compile(g, [WILDCARD], { sourceInputs: [SOURCE] })).not.toThrow();
    expect(() =>
      compile(g, [WILDCARD], {
        sourceInputs: [{ id: "x", type: "audio/pcm-f32", storage: "opfs" }],
      }),
    ).toThrow('node "decode" (media.decode-audio) missing inputs: file/*');
  });
});

describe("schema", () => {
  it("encode/decode 往返", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    expect(decodeGraph(encodeGraph(g))).toEqual(g);
  });

  it("损坏数据返回 null", () => {
    expect(decodeGraph("not json")).toBeNull();
    expect(decodeGraph('{"nodes": "bad"}')).toBeNull();
  });
});
