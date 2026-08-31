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
    inputs: [{ name: "source", type: "file/wav" }],
    outputs: [
      { name: "pcm", type: "audio/pcm-f32" },
      { name: "info", type: "media/info" },
    ],
  },
  {
    operation: "asr.transcribe",
    label: "ASR",
    detail: "",
    runtime: "wasm",
    inputs: [{ name: "pcm", type: "audio/pcm-f32" }],
    outputs: [{ name: "chunks", type: "subtitle/asr-chunks" }],
    config: [
      { key: "model", label: "模型", kind: "string", default: "whisper-tiny" },
      // 后期新增的字段：旧持久化图的节点 config 里不会有它
      { key: "device", label: "设备", kind: "string", default: "auto" },
    ],
  },
  {
    operation: "subtitle.segment",
    label: "Segment",
    detail: "",
    runtime: "wasm",
    inputs: [{ name: "chunks", type: "subtitle/asr-chunks" }],
    outputs: [{ name: "cues", type: "subtitle/cues" }],
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

  it("同类型多端口必须显式选择，并可分别连线", () => {
    const source: OperationDef = {
      operation: "test.source",
      label: "Source",
      detail: "",
      runtime: "js",
      inputs: [],
      outputs: [
        { name: "primary", type: "data/value" },
        { name: "secondary", type: "data/value" },
      ],
    };
    const sink: OperationDef = {
      operation: "test.sink",
      label: "Sink",
      detail: "",
      runtime: "js",
      inputs: [
        { name: "left", type: "data/value" },
        { name: "right", type: "data/value" },
      ],
      outputs: [],
    };
    const ops = [source, sink];
    let graph = addNode(emptyGraph, source, "source", 0, 0);
    graph = addNode(graph, sink, "sink", 200, 0);

    expect(addEdge(graph, ops, "source", "sink")).toBeNull();
    graph =
      addEdge(graph, ops, "source", "sink", {
        fromPort: "secondary",
        toPort: "right",
      }) ?? graph;
    graph = addEdge(graph, ops, "source", "sink", { fromPort: "primary", toPort: "left" }) ?? graph;

    const compiled = compile(graph, ops);
    expect(compiled.find((node) => node.id === "sink")?.bindings).toEqual([
      { from: "source", output: "primary", input: "left" },
      { from: "source", output: "secondary", input: "right" },
    ]);
  });
});

describe("autoWire", () => {
  it("类型唯一可推导时自动接线", () => {
    let g = addNode(emptyGraph, OPS[0]!, "decode", 0, 0);
    g = addNode(g, OPS[1]!, "asr", 200, 0);
    g = autoWire(g, OPS, "asr");
    expect(g.edges).toEqual([
      {
        id: "decode.pcm->asr.pcm",
        from: "decode",
        to: "asr",
        fromPort: "pcm",
        toPort: "pcm",
        type: "audio/pcm-f32",
      },
    ]);
  });
});

describe("compile", () => {
  it("skipCache：全局选项或节点 config 均可跳过缓存（cache.enabled=false）", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;

    // 全局：所有节点跳过
    const all = compile(g, OPS, { sourceInputs: [SOURCE], skipCache: true });
    for (const node of all) expect(node.cache).toEqual({ enabled: false });

    // 节点级：只有勾选的节点跳过
    let g2 = g;
    g2 = {
      ...g2,
      nodes: g2.nodes.map((n) =>
        n.operation === "asr.transcribe" ? { ...n, config: { ...n.config, skipCache: true } } : n,
      ),
    };
    const mixed = compile(g2, OPS, { sourceInputs: [SOURCE] });
    expect(mixed.find((n) => n.id === "decode")?.cache).toBeUndefined();
    expect(mixed.find((n) => n.id === "asr")?.cache).toEqual({ enabled: false });
    expect(mixed.find((n) => n.id === "segment")?.cache).toBeUndefined();
  });

  it("config 注入目录默认值：旧图节点缺新字段时编译产物仍带默认（参与缓存键）", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;
    // 模拟旧持久化图：节点 config 只有旧字段 model，缺后来新增的 device 等
    g = {
      ...g,
      nodes: g.nodes.map((n) =>
        n.operation === "asr.transcribe" ? { ...n, config: { model: "whisper-tiny" } } : n,
      ),
    };

    const nodes = compile(g, OPS, { sourceInputs: [SOURCE] });
    const asr = nodes.find((n) => n.id === "asr");
    // 目录里声明的字段全部补上默认，节点显式值优先
    expect(asr?.config?.["model"]).toBe("whisper-tiny");
    for (const field of OPS.find((op) => op.operation === "asr.transcribe")?.config ?? []) {
      expect(asr?.config).toHaveProperty(field.key);
    }
  });

  it("拓扑排序 + after 推导 + 根节点注入 sourceInputs + config 透传", () => {
    let g = chain();
    g = addEdge(g, OPS, "decode", "asr") ?? g;
    g = addEdge(g, OPS, "asr", "segment") ?? g;

    const nodes = compile(g, OPS, { sourceInputs: [SOURCE] });
    expect(nodes.map((n) => n.id)).toEqual(["decode", "asr", "segment"]);

    const decode = nodes[0]!;
    expect(decode.inputs).toEqual([{ ...SOURCE, port: "source" }]);
    expect(decode.after).toBeUndefined();
    expect(decode.outputs).toEqual([
      { name: "pcm", type: "audio/pcm-f32" },
      { name: "info", type: "media/info" },
    ]);

    const asr = nodes[1]!;
    expect(asr.after).toEqual(["decode"]);
    expect(asr.bindings).toEqual([{ from: "decode", output: "pcm", input: "pcm" }]);
    expect(asr.inputs).toBeUndefined();
    expect(asr.config).toEqual({ model: "whisper-tiny", device: "auto" });

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
        inputs: [{ ...SOURCE, port: "source" }],
        outputs: [
          { name: "pcm", type: "audio/pcm-f32" },
          { name: "info", type: "media/info" },
        ],
      },
      {
        id: "asr",
        runtime: "wasm",
        operation: "asr.transcribe",
        after: ["decode"],
        bindings: [{ from: "decode", output: "pcm", input: "pcm" }],
        outputs: [{ name: "chunks", type: "subtitle/asr-chunks" }],
        config: { model: "whisper-tiny", device: "auto" },
      },
      {
        id: "segment",
        runtime: "wasm",
        operation: "subtitle.segment",
        after: ["asr"],
        bindings: [{ from: "asr", output: "chunks", input: "chunks" }],
        outputs: [{ name: "cues", type: "subtitle/cues" }],
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
      inputs: [
        { name: "pcm", type: "audio/pcm-f32" },
        { name: "cues", type: "subtitle/cues" },
      ],
      outputs: [{ name: "translated", type: "subtitle/cues" }],
    };
    const ops = [...OPS, TRANSLATE];
    let g = chain();
    g = addEdge(g, ops, "decode", "asr") ?? g;
    g = addEdge(g, ops, "asr", "segment") ?? g;
    g = addNode(g, TRANSLATE, "translate", 600, 0);
    // 只接 cues 边，缺 decode→translate 的 pcm 边（editor 删边/旧持久化图的情形）
    g = addEdge(g, ops, "segment", "translate", "subtitle/cues") ?? g;

    expect(() => compile(g, ops, { sourceInputs: [SOURCE] })).toThrow(
      'node "translate" (subtitle.translate) missing inputs: pcm',
    );

    g = addEdge(g, ops, "decode", "translate", "audio/pcm-f32") ?? g;
    expect(() => compile(g, ops, { sourceInputs: [SOURCE] })).not.toThrow();
  });

  it("根节点通配端口 file/* 匹配任意 file/xx 源", () => {
    const WILDCARD: OperationDef = {
      ...OPS[0]!,
      inputs: [{ name: "source", type: "file/*" }],
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
    ).toThrow('node "decode" (media.decode-audio) missing inputs: source');
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

  it("旧版 type-only 边在候选唯一时自动迁移为命名 binding", () => {
    let graph = chain();
    graph = {
      ...graph,
      edges: [
        {
          id: "decode->asr:audio/pcm-f32",
          from: "decode",
          to: "asr",
          type: "audio/pcm-f32",
        },
        {
          id: "asr->segment:subtitle/asr-chunks",
          from: "asr",
          to: "segment",
          type: "subtitle/asr-chunks",
        },
      ],
    };
    const restored = decodeGraph(encodeGraph(graph));
    expect(restored).not.toBeNull();
    expect(compile(restored!, OPS, { sourceInputs: [SOURCE] })[1]?.bindings).toEqual([
      { from: "decode", output: "pcm", input: "pcm" },
    ]);
  });
});
