import type { ArtifactRef } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect } from "effect";
import { persistProject } from "./pipeline";
import { studio } from "./store";

/** 导入媒体文件：流式写入 OPFS（FileArtifact，§4），不整段进内存。 */
export async function importSource(services: RuntimeServices, file: File): Promise<void> {
  const ref: ArtifactRef = {
    id: `source/${file.name}`,
    type: `file/${file.name.split(".").pop() ?? "bin"}`,
    storage: "opfs",
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

export async function clearProject(): Promise<void> {
  studio.setSource(null);
  const db = (await import("./runtime")).metaDatabase();
  if (db !== undefined) {
    try {
      await db.kvSet("project", JSON.stringify({ source: null, cues: [] }));
    } catch {
      // 持久化失败不阻塞 UI
    }
  }
  studio.log("info", "project · cleared");
}
