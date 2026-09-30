import { contentHash, type ArtifactRef, type RuntimeServices } from "@bcr/core";
import { Effect } from "effect";
import initKernels, { StreamingBlake3 } from "../../../../crates/kernels/pkg/bcr_kernels.js";
import {
  MAX_MANIFEST_BYTES,
  parseManifest,
  validateConfig,
  type JsgConfig,
  type ResearchDataset,
} from "./model";

let kernelsReady: Promise<unknown> | undefined;
async function hashPartition(file: File): Promise<string> {
  kernelsReady ??= initKernels();
  await kernelsReady;
  const hasher = new StreamingBlake3();
  const reader = file.stream().getReader();
  let yieldedAt = performance.now();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return hasher.finalize_hex();
      // Keep the import window bounded even if a stream supplies unusually large chunks.
      for (let offset = 0; offset < value.length; offset += 1024 * 1024) {
        hasher.update(value.subarray(offset, offset + 1024 * 1024));
        if (performance.now() - yieldedAt >= 16) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          yieldedAt = performance.now();
        }
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
    hasher.free();
  }
}

export async function readJson<T>(services: RuntimeServices, ref: ArtifactRef): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
export async function importResearch(
  services: Pick<RuntimeServices, "artifacts">,
  files: readonly File[],
  progress: (text: string) => void,
): Promise<ResearchDataset> {
  const jsons = files.filter((f) => f.name.endsWith(".json"));
  const manifestFile = jsons[0];
  if (jsons.length !== 1 || manifestFile === undefined || manifestFile.size > MAX_MANIFEST_BYTES)
    throw new Error("请选择一个 manifest.json 和清单中的所有 .arrow 文件（清单 ≤ 4 MB）");
  const manifest = parseManifest(JSON.parse(await manifestFile.text()));
  const byName = new Map(files.map((file) => [file.name, file]));
  if (byName.size !== files.length || files.length !== manifest.partitions.length + 1)
    throw new Error("文件集合有重复或与清单不一致");
  for (const p of manifest.partitions) {
    if (byName.get(p.file)?.size !== p.bytes) throw new Error(`分片缺失或字节数不符：${p.file}`);
  }
  const written: ArtifactRef[] = [];
  try {
    const partitions: ArtifactRef[] = [];
    // Hash and copy one stream at a time. Never materialize the full research universe in JS.
    for (const [index, p] of manifest.partitions.entries()) {
      const file = byName.get(p.file);
      if (file === undefined) throw new Error(`分片缺失：${p.file}`);
      progress(`导入 ${index + 1}/${manifest.partitions.length} · ${p.file}`);
      const hash = await hashPartition(file);
      const ref: ArtifactRef = {
        id: `jsg/input/${hash}`,
        hash,
        type: "quant/jsg-daily",
        format: "arrow-ipc",
        storage: "opfs",
      };
      if (!(await Effect.runPromise(services.artifacts.has(ref)))) {
        written.push(ref);
        await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
      }
      partitions.push(ref);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const hash = contentHash(bytes);
    const manifestRef: ArtifactRef = {
      id: `jsg/manifest/${hash}`,
      hash,
      type: "quant/jsg-manifest",
      format: "json",
      storage: "opfs",
    };
    if (!(await Effect.runPromise(services.artifacts.has(manifestRef)))) {
      written.push(manifestRef);
      await Effect.runPromise(services.artifacts.put(manifestRef, bytes));
    }
    return { manifest, manifestRef, partitions };
  } catch (error) {
    await Promise.allSettled(
      written.map((ref) => Effect.runPromise(services.artifacts.delete(ref))),
    );
    throw error;
  }
}
export async function saveResearch(
  services: RuntimeServices,
  dataset: ResearchDataset,
  config: JsgConfig,
  resultRef: ArtifactRef | null,
): Promise<void> {
  await services.metadata?.set(
    "jsg-project-v1",
    JSON.stringify({
      dataset: { manifestRef: dataset.manifestRef, partitions: dataset.partitions },
      config,
      resultRef,
    }),
  );
}
export async function restoreResearch(
  services: RuntimeServices,
): Promise<{ dataset: ResearchDataset; config: JsgConfig; resultRef: ArtifactRef | null } | null> {
  const raw = await services.metadata?.get("jsg-project-v1");
  if (raw === undefined) return null;
  const project = JSON.parse(raw) as {
    dataset: Pick<ResearchDataset, "manifestRef" | "partitions">;
    config: JsgConfig;
    resultRef: ArtifactRef | null;
  };
  const manifest = parseManifest(await readJson<unknown>(services, project.dataset.manifestRef));
  validateConfig(project.config);
  if (project.dataset.partitions.length !== manifest.partitions.length)
    throw new Error("本地研究清单与分片不一致");
  for (const ref of project.dataset.partitions) {
    if (!(await Effect.runPromise(services.artifacts.has(ref))))
      throw new Error("本地研究分片已被删除，请重新导入");
  }
  return { ...project, dataset: { ...project.dataset, manifest } };
}
