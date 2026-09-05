import { hashReadableStream, type ArtifactRef } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect } from "effect";
import { persistProject } from "./pipeline";
import { studio } from "./store";

/** 导入媒体文件：流式写入 OPFS（FileArtifact，§4），不整段进内存。 */
export async function importSource(services: RuntimeServices, file: File): Promise<void> {
  // File.stream() 可重复打开：先流式计算内容摘要，再以新流写入 OPFS，全程不聚合大文件。
  const hash = await hashReadableStream(file.stream());
  const ref: ArtifactRef = {
    id: `source/${hash}`,
    type: `file/${file.name.split(".").pop() ?? "bin"}`,
    storage: "opfs",
    hash,
  };
  await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
  studio.setSource({
    ref,
    name: file.name,
    size: file.size,
    objectUrl: URL.createObjectURL(file),
  });
  studio.log("info", `import · ${file.name} · ${file.size} bytes → opfs`);
  void persistProject(services);
}

export async function clearProject(services: RuntimeServices): Promise<void> {
  studio.setSource(null);
  const db = services.metadata;
  if (db !== undefined) {
    try {
      await db.set("project", JSON.stringify({ source: null, cues: [] }));
    } catch {
      // 持久化失败不阻塞 UI
    }
  }
  studio.log("info", "project · cleared");
}
