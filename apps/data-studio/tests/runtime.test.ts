import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createDataTablePackage } from "@bcr/data-core";
import type { RuntimeServices } from "@bcr/react";
import { artifactStore, ArtifactStoreTag, type ArtifactRef } from "@bcr/core";
import { MemoryStore } from "../../../packages/storage-opfs/src/memory";
import {
  activateDataAsset,
  inspectDataStorage,
  persistDataTable,
  reclaimDataStorage,
  removeDataAsset,
  restoreDataCatalog,
  restoreDataTable,
  type DataTableSnapshot,
} from "../src/runtime";

async function makeArtifacts() {
  const memory = new MemoryStore();
  const context = await Effect.runPromise(Effect.scoped(Layer.build(artifactStore({ memory }))));
  return Context.get(context, ArtifactStoreTag);
}

function makeServices(
  artifacts: Awaited<ReturnType<typeof makeArtifacts>>,
  values: Map<string, string>,
): RuntimeServices {
  return {
    artifacts,
    scheduler: undefined as never,
    metadata: {
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
      },
    },
  };
}

function refs(hash: string): { readonly sourceRef: ArtifactRef; readonly tableRef: ArtifactRef } {
  return {
    sourceRef: {
      id: `data/source/${hash}`,
      type: "file/json",
      storage: "memory",
      hash,
    },
    tableRef: {
      id: `data/table/${hash}`,
      type: "data/table",
      storage: "memory",
      format: "json",
    },
  };
}

async function snapshot(
  artifacts: Awaited<ReturnType<typeof makeArtifacts>>,
  name: string,
  hash: string,
  createdAt: number,
): Promise<DataTableSnapshot> {
  const { sourceRef, tableRef } = refs(hash);
  const table = createDataTablePackage({
    id: `data-table/${hash}`,
    format: "json",
    sourceName: name,
    sourceRef,
    sourceHash: hash,
    rows: [
      [name, 1],
      ["second", 2],
    ],
    columnNames: ["name", "value"],
    createdAt,
  });
  await Effect.runPromise(artifacts.put(tableRef, new TextEncoder().encode(JSON.stringify(table))));
  return { table, sourceRef, tableRef, sizeBytes: 128 };
}

describe("Data Studio asset catalog", () => {
  it("persists multiple content-addressed assets and switches the active table", async () => {
    const artifacts = await makeArtifacts();
    const metadata = new Map<string, string>();
    const services = makeServices(artifacts, metadata);
    const first = await snapshot(artifacts, "first.json", "hash-first", 10);
    const second = await snapshot(artifacts, "second.json", "hash-second", 20);

    await persistDataTable(services, first);
    await persistDataTable(services, second);
    const restored = await restoreDataCatalog(services);

    expect(restored.catalog.assets.map((asset) => asset.sourceName)).toEqual([
      "second.json",
      "first.json",
    ]);
    expect(restored.catalog.activeAssetId).toBe("data-asset/hash-second");
    expect(restored.active?.table.sourceName).toBe("second.json");

    const selected = await activateDataAsset(services, "data-asset/hash-first");
    expect(selected?.table.sourceName).toBe("first.json");
    expect((await restoreDataTable(services))?.table.sourceName).toBe("first.json");

    const afterRemove = await removeDataAsset(services, "data-asset/hash-first");
    expect(afterRemove.assets.map((asset) => asset.sourceName)).toEqual(["second.json"]);
    expect(afterRemove.activeAssetId).toBe("data-asset/hash-second");
    expect(await Effect.runPromise(artifacts.has(second.tableRef))).toBe(true);
  });

  it("migrates the previous single snapshot without losing the table Artifact", async () => {
    const artifacts = await makeArtifacts();
    const metadata = new Map<string, string>();
    const services = makeServices(artifacts, metadata);
    const legacy = await snapshot(artifacts, "legacy.json", "hash-legacy", 30);
    metadata.set(
      "data-studio.snapshot.v1",
      JSON.stringify({ version: 1, sourceRef: legacy.sourceRef, tableRef: legacy.tableRef }),
    );

    const restored = await restoreDataCatalog(services);

    expect(restored.migratedLegacy).toBe(true);
    expect(restored.catalog.assets).toHaveLength(1);
    expect(restored.active?.table.sourceName).toBe("legacy.json");
    expect(metadata.get("data-studio.catalog.v1")).toContain("hash-legacy");
  });

  it("plans and reclaims only unreferenced data artifacts", async () => {
    const artifacts = await makeArtifacts();
    const metadata = new Map<string, string>();
    const services = makeServices(artifacts, metadata);
    const active = await snapshot(artifacts, "active.json", "hash-active", 40);
    await persistDataTable(services, active);
    const orphan: ArtifactRef = {
      id: "data/source/orphan",
      type: "file/json",
      storage: "memory",
    };
    const unrelated: ArtifactRef = {
      id: "reader/source/book",
      type: "file/epub",
      storage: "memory",
    };
    await Effect.runPromise(artifacts.put(active.sourceRef, new Uint8Array([0])));
    await Effect.runPromise(artifacts.put(orphan, new Uint8Array([1, 2, 3])));
    await Effect.runPromise(artifacts.put(unrelated, new Uint8Array([4])));

    const report = await inspectDataStorage(services);
    expect(report.dataUsage).toMatchObject({ objects: 3 });
    expect(report.orphaned.map((entry) => entry.id)).toEqual([orphan.id]);
    expect(report.plan.candidates.map((entry) => entry.id)).toEqual([orphan.id]);

    const result = await reclaimDataStorage(services, report.plan);
    expect(result.deleted.map((entry) => entry.id)).toEqual([orphan.id]);
    expect(await Effect.runPromise(artifacts.has(active.tableRef))).toBe(true);
    expect(await Effect.runPromise(artifacts.has(unrelated))).toBe(true);
  });
});
