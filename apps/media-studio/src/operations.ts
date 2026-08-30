import type { Graph, OperationDef } from "@bcr/graph";
import { addEdge, addNode, emptyGraph, removeNode, updateNodeConfig } from "@bcr/graph";
import type { StudioSettings } from "./store";

/**
 * Media Studio 的 operation 目录：现有流水线节点的声明化。
 * 目录即面板（palette 投影）、即连线规则（端口类型交集）、即配置表单（config 字段）。
 */

const MODEL_FIELD = {
  key: "model",
  label: "Whisper 模型（参与缓存键）",
  kind: "select",
  options: [
    { value: "Xenova/whisper-tiny", label: "whisper-tiny" },
    { value: "Xenova/whisper-base", label: "whisper-base" },
  ],
  default: "Xenova/whisper-tiny",
} as const;

export const OPERATIONS: ReadonlyArray<OperationDef> = [
  {
    operation: "media.decode-audio",
    label: "Decode",
    detail: "解码 → 16kHz 单声道 PCM",
    runtime: "js",
    inputs: [{ type: "file/*", label: "源文件" }],
    outputs: [
      { type: "audio/pcm-f32", label: "PCM" },
      { type: "media/info", label: "媒体信息" },
    ],
  },
  {
    operation: "audio.waveform",
    label: "Waveform",
    detail: "RMS/峰值包络（WASM kernel）",
    runtime: "wasm",
    inputs: [{ type: "audio/pcm-f32", label: "PCM" }],
    outputs: [{ type: "audio/waveform-peaks", label: "peaks" }],
  },
  {
    operation: "asr.transcribe",
    label: "ASR",
    detail: "Whisper 语音识别（分窗推理）",
    runtime: "wasm",
    inputs: [{ type: "audio/pcm-f32", label: "PCM" }],
    outputs: [{ type: "subtitle/asr-chunks", label: "chunks" }],
    config: [
      MODEL_FIELD,
      {
        key: "device",
        label: "计算设备（§10.1 探测降级）",
        kind: "select",
        options: [
          { value: "auto", label: "自动（GPU 优先）" },
          { value: "webgpu", label: "WebGPU" },
          { value: "wasm", label: "CPU (WASM)" },
        ],
        default: "auto",
      },
      {
        key: "words",
        label: "词级时间戳（卡拉 OK ASS）",
        kind: "boolean",
        default: true,
      },
      {
        key: "engine",
        label: "识别引擎",
        kind: "select",
        options: [
          { value: "auto", label: "自动回退" },
          { value: "whisper", label: "仅 Whisper" },
          { value: "demo", label: "演示" },
        ],
        default: "auto",
      },
    ],
  },
  {
    operation: "subtitle.segment",
    label: "Segment",
    detail: "字幕分段规范化",
    runtime: "wasm",
    inputs: [{ type: "subtitle/asr-chunks", label: "chunks" }],
    outputs: [{ type: "subtitle/cues", label: "cues" }],
    config: [
      { key: "maxDurationS", label: "单条最长（秒）", kind: "number", default: 5 },
      { key: "maxChars", label: "单条最多字符", kind: "number", default: 30 },
    ],
  },
  {
    operation: "subtitle.translate",
    label: "Translate",
    detail: "opus-mt 文本翻译 → 双语（逐条 cue，1:1 对齐）",
    runtime: "wasm",
    inputs: [{ type: "subtitle/cues", label: "cues" }],
    outputs: [{ type: "subtitle/cues", label: "双语 cues" }],
    config: [
      {
        key: "direction",
        label: "翻译方向",
        kind: "select",
        options: [
          { value: "en-zh", label: "英 → 中" },
          { value: "zh-en", label: "中 → 英" },
        ],
        default: "en-zh",
      },
    ],
  },
];

function op(operation: string): OperationDef {
  const found = OPERATIONS.find((o) => o.operation === operation);
  if (found === undefined) throw new Error(`unknown operation ${operation}`);
  return found;
}

/** 默认流水线（即原硬编码 DAG）：decode ─┬─ wave / └─ asr ─ segment ─┬─ (translate)。 */
export function defaultGraph(settings: StudioSettings): Graph {
  let g = addNode(emptyGraph, op("media.decode-audio"), "decode", 32, 96);
  g = addNode(g, op("audio.waveform"), "wave", 288, 24);
  g = addNode(g, op("asr.transcribe"), "asr", 288, 176);
  g = addNode(g, op("subtitle.segment"), "segment", 544, 176);
  g = updateNodeConfig(g, "asr", { model: settings.model, engine: settings.engine });
  g = addEdge(g, OPERATIONS, "decode", "wave") ?? g;
  g = addEdge(g, OPERATIONS, "decode", "asr") ?? g;
  g = addEdge(g, OPERATIONS, "asr", "segment") ?? g;
  return settings.translate ? withTranslate(g, settings) : g;
}

/** 顶栏"英文翻译"开关：增删 translate 节点及其边（与图单一事实源保持一致）。 */
export function withTranslate(graph: Graph, settings: StudioSettings): Graph {
  // 节点已存在（如恢复的旧图缺边）时也要补齐输入边——缺边的 translate 必然无法运行。
  // 节点 id 按 operation 查找，兼容自定义编排里的非默认 id。
  let g = graph;
  let translateId = g.nodes.find((n) => n.operation === "subtitle.translate")?.id;
  if (translateId === undefined) {
    translateId = "translate";
    g = addNode(g, op("subtitle.translate"), translateId, 544, 328);
  }
  g = updateNodeConfig(g, translateId, { direction: settings.direction });
  const decodeId = g.nodes.find((n) => n.operation === "media.decode-audio")?.id;
  const segmentId = g.nodes.find((n) => n.operation === "subtitle.segment")?.id;
  if (decodeId !== undefined) {
    g = addEdge(g, OPERATIONS, decodeId, translateId, "audio/pcm-f32") ?? g;
  }
  if (segmentId !== undefined) {
    g = addEdge(g, OPERATIONS, segmentId, translateId, "subtitle/cues") ?? g;
  }
  return g;
}

export function withoutTranslate(graph: Graph): Graph {
  const node = graph.nodes.find((n) => n.operation === "subtitle.translate");
  return node === undefined ? graph : removeNode(graph, node.id);
}
