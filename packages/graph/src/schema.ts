import { Schema } from "effect";
import type { Graph } from "./model";

/** 图的持久化 Schema（§6.3 统一建模 / §8 落 SQLite）。 */
const NodeInstanceSchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  config: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const EdgeSchema = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  fromPort: Schema.optional(Schema.String),
  toPort: Schema.optional(Schema.String),
  type: Schema.String,
});

const GraphSchema = Schema.Struct({
  nodes: Schema.Array(NodeInstanceSchema),
  edges: Schema.Array(EdgeSchema),
});

export function encodeGraph(graph: Graph): string {
  return JSON.stringify(graph);
}

/** 解析失败（旧数据 / 损坏）返回 null，由调用方回退默认图。 */
export function decodeGraph(raw: string): Graph | null {
  try {
    return Schema.decodeUnknownSync(GraphSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}
