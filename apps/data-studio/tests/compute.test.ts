import { artifactPath, type ArtifactRef } from "@bcr/core";
import { createArtifactIO } from "@bcr/runtime-worker";
import { MemoryStore } from "@bcr/storage-opfs";
import { expect, it } from "vitest";
import { createDataCompute } from "../src/compute";

it("runs the domain parser against an injected data plane without OPFS", async () => {
  const store = new MemoryStore();
  const source: ArtifactRef = {
    id: "table",
    type: "data/source",
    storage: "memory",
    hash: "source",
  };
  const bytes = new TextEncoder().encode("name,value\nalpha,2\nbeta,3");
  await store.put(artifactPath(source), bytes);
  const io = createArtifactIO(store, "memory");
  const { dataParseTable } = createDataCompute(io);
  const outputs = await dataParseTable(
    { inputs: [source], config: { format: "csv", sizeBytes: bytes.length } },
    { signal: new AbortController().signal, progress: () => undefined, emitChunk: () => undefined },
  );
  expect(outputs[0]?.storage).toBe("memory");
  const result = await io.getBlob(outputs[0]!);
  expect(await result.text()).toContain("alpha");
});
