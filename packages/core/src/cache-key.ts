import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ArtifactRef } from "./schema";

/**
 * 架构文档 §7：Content-Addressed Cache。
 *
 * cacheKey = BLAKE3(artifactHash + taskName + config + runtimeVersion)
 *
 * 输入 artifact 有 hash 用 hash（内容寻址），否则退化为 id（引用寻址）。
 */
export function cacheKey(input: {
  readonly operation: string;
  readonly inputs: ReadonlyArray<Pick<ArtifactRef, "id" | "hash" | "port">>;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly runtimeVersion: string;
}): string {
  const canonical = canonicalize({
    operation: input.operation,
    // 输入顺序与端口都属于任务语义：left/right 即使类型、内容相同也不可互换。
    inputs: input.inputs.map((ref, index) => ({
      port: ref.port ?? `#${index}`,
      artifact: ref.hash ?? ref.id,
    })),
    config: input.config ?? {},
    runtimeVersion: input.runtimeVersion,
  });
  return bytesToHex(blake3(utf8ToBytes(canonical)));
}

/** 递归排序对象键，保证等值输入得到等值字符串。 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
