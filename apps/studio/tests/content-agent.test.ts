import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { evaluateAnalysis } from "@bcr/economics-core/analysis";
import { requiresApproval } from "@bcr/agent";
import { ContentStore } from "../src/content/store";
import { KnowledgeStore } from "../src/knowledge/session/store";
import { contentCapability } from "../src/content/agent";
import { analysisRuns, decodeProject, newWorkspaceProject } from "../src/content/model";
import { applyChanges, prepareChanges } from "../src/content/commands";
import { presetContent } from "../src/content/pages/presets";
import { pageHtml, pageSvg } from "../src/content/pages/export";
import { createRelease, decodeRelease } from "../src/content/release";
import { exportArchive, prepareArchive, restoreArchive } from "../src/content/archive";
import { importPrices } from "../src/content/importPrices";

function setup(records = new Map<string, string>(), binary = new MemoryStore()) {
  const metadata = {
    get: async (key: string) => records.get(key),
    set: async (key: string, value: string) => {
      records.set(key, value);
    },
    batch: vi.fn(async (entries: readonly (readonly [string, string | undefined])[]) => {
      for (const [key, value] of entries) {
        if (value === undefined) records.delete(key);
        else records.set(key, value);
      }
    }),
  };
  const store = new ContentStore(metadata, binary),
    knowledge = new KnowledgeStore(metadata, binary);
  const capability = contentCapability(store, knowledge);
  const tool = (name: string) => capability.tools.find((t) => t.spec.name === `content_${name}`)!;
  const call = async (name: string, args: unknown) =>
    JSON.parse(await tool(name).call(JSON.stringify(args)));
  return { store, knowledge, tool, call, metadata, records, binary };
}

describe("general content models", () => {
  it("evaluates structurally different questions with separate units and deterministic decimals", () => {
    const gym = evaluateAnalysis(presetContent("gym").models[0]!);
    expect(gym.rows[0]!.values.threshold).toBe("40");
    expect(gym.rows[0]!.values.average).toBe("50");
    const cooking = evaluateAnalysis(presetContent("cooking").models[0]!, { loss: "0.4" });
    expect(cooking.rows[0]!.values.home).toBe("20");
    expect(cooking.rows[0]!.values.time).toBe("35");
    const commute = evaluateAnalysis(presetContent("commute").models[0]!);
    expect(commute.rows[0]!.values.cash).toBe("3264");
    expect(commute.rows[0]!.values.time).toBe("1760");
    expect(newWorkspaceProject("blank").models).toEqual([]);
  });
  it("rejects cycles, missing values, zero divisors, mismatched units and broken page references", () => {
    const model = presetContent("gym").models[0]!;
    expect(() => evaluateAnalysis(model, { visits: "" })).toThrow();
    expect(() => evaluateAnalysis(model, { visits: "0" })).toThrow("除数");
    expect(() =>
      evaluateAnalysis({
        ...model,
        formulas: [{ id: "loop", label: "循环", unit: "CNY", expression: { ref: "loop" } }],
      }),
    ).toThrow("循环");
    expect(() =>
      evaluateAnalysis({
        ...model,
        formulas: [
          {
            id: "bad",
            label: "混算",
            unit: "CNY",
            expression: { op: "add", args: [{ ref: "fixed" }, { ref: "visits" }] },
          },
        ],
      }),
    ).toThrow("单位");
    expect(() => prepareChanges(newWorkspaceProject("gym"), { removeModels: ["cost"] })).toThrow(
      "模型缺失",
    );
    const p = newWorkspaceProject("cooking");
    expect(() =>
      prepareChanges(p, {
        pagePatches: [
          {
            id: "main",
            upsert: {
              "chart-1": {
                type: "Chart",
                props: { model: "cost", outputs: ["home", "time"], kind: "bar", title: "bad" },
              },
            },
          },
        ],
      }),
    ).toThrow("单位");
  });
  it("imports generic CSV with preserved decimal strings and provenance", async () => {
    const s = setup(),
      p = newWorkspaceProject("cooking");
    const next = await importPrices(
      new File(["model,parameter,value\ncost,ingredients,10.50\ncost,loss,0.25"], "prices.csv"),
      p,
      s.store,
    );
    expect(next.models![0]!.parameters[0]!.value).toBe("10.50");
    expect(analysisRuns(next)[0]!.result.rows[0]!.values.home).toBe("14");
    expect(next.evidence[0]!.asset).not.toBeNull();
    expect(next.models![0]!.parameters[0]!.evidenceId).toBe(next.evidence[0]!.id);
  });
});

describe("content assistant commands", () => {
  it("exposes discoverable schemas and gates every persisted mutation", async () => {
    const s = setup(),
      catalog = await s.call("catalog", { preset: "commute" });
    expect(catalog.pageSchema.properties.elements).toBeDefined();
    expect(catalog.modelSchema.$defs.AnalysisExpression).toBeDefined();
    for (const name of ["create", "apply", "release", "export", "restore"]) {
      expect(requiresApproval(s.tool(name).spec)).toBe(true);
      expect(s.tool(name).preview).toBeTypeOf("function");
    }
    expect(requiresApproval(s.tool("evaluate").spec)).toBe(false);
  });
  it("creates and changes through real tools, preserves manual blocks, and replays durable receipts", async () => {
    const s = setup(),
      args = { requestId: "create-1", preset: "cooking", title: "午餐研究" };
    await s.tool("create").preview!(JSON.stringify(args));
    expect(s.store.getSnapshot()).toHaveLength(0);
    const created = await s.call("create", args);
    const p = s.store.getSnapshot()[0]!;
    const manual = await s.store.save(
      prepareChanges(p, {
        pagePatches: [
          { id: "main", upsert: { intro: { type: "Text", props: { text: "人工添加的解释" } } } },
        ],
      }),
      p.revision,
    );
    const edit = {
      id: p.id,
      revision: manual.revision,
      requestId: "edit-1",
      changes: {
        pagePatches: [
          {
            id: "main",
            upsert: { heading: { type: "Heading", props: { text: "新的标题", level: 1 } } },
          },
        ],
      },
    };
    const saved = await s.call("apply", edit);
    expect(s.store.getSnapshot()[0]!.pages![0]!.elements.intro!.props).toEqual({
      text: "人工添加的解释",
    });
    const reload = setup(s.records, s.binary);
    expect((await reload.tool("apply").preview!(JSON.stringify(edit))).before).toBe("该请求已保存");
    expect(await reload.call("apply", edit)).toEqual(saved);
    expect(await reload.call("create", args)).toEqual(created);
    expect(reload.store.getSnapshot()).toHaveLength(1);
    await expect(reload.call("create", { ...args, title: "different" })).rejects.toThrow(
      "requestId",
    );
  });
  it("previews CSV imports without writing and keeps repeated imports idempotent", async () => {
    const s = setup(),
      project = await s.store.save(newWorkspaceProject("cooking"), null);
    const artifact = await s.store.assets.importArtifact(
      new Blob(["model,parameter,value\ncost,loss,0.4"], { type: "text/csv" }),
      "prices.csv",
    );
    const args = {
      id: project.id,
      revision: project.revision,
      requestId: "csv",
      artifact,
      kind: "prices",
    };
    const writing = vi.spyOn(s.store.assets, "import");
    await s.tool("import").preview!(JSON.stringify(args));
    expect(writing).not.toHaveBeenCalled();
    const saved = await s.call("import", args);
    expect(analysisRuns(s.store.getSnapshot()[0]!)[0]!.result.rows[0]!.values.home).toBe("20");
    expect((await s.tool("import").preview!(JSON.stringify(args))).before).toBe("该请求已保存");
    expect(await s.call("import", args)).toEqual(saved);
    expect(s.store.getSnapshot()[0]!.evidence).toHaveLength(1);
  });
  it("updates related models/pages atomically and paginates sources at a fixed revision", async () => {
    const s = setup(),
      original = newWorkspaceProject("gym");
    const removed = prepareChanges(original, {
      removeModels: ["cost"],
      pagePatches: [
        {
          id: "main",
          upsert: { root: { type: "Stack", props: { gap: "wide" }, children: [] } },
          remove: Object.keys(original.pages![0]!.elements).filter((id) => id !== "root"),
        },
      ],
    });
    expect(removed.models).toEqual([]);
    const project = await s.store.save(
      prepareChanges(removed, {
        evidence: [
          {
            id: "source",
            title: "Long source",
            url: "",
            capturedAt: 0,
            applicableDate: "",
            region: "",
            store: "",
            specification: "",
            author: "",
            license: "",
            asset: null,
            text: "a".repeat(100000),
          },
        ],
      }),
      null,
    );
    const first = await s.call("read", { id: project.id, section: "evidence", itemId: "source" });
    expect(first.item.text).toHaveLength(30000);
    expect(first.nextOffset).toBe(30000);
    await expect(
      s.call("read", {
        id: project.id,
        section: "evidence",
        itemId: "source",
        offset: first.nextOffset,
      }),
    ).rejects.toThrow("revision");
    await s.store.save({ ...project, title: "changed" }, project.revision);
    await expect(
      s.call("read", {
        id: project.id,
        section: "evidence",
        itemId: "source",
        offset: first.nextOffset,
        revision: first.revision,
      }),
    ).rejects.toThrow("变化");
  });
  it("rejects stale writes after preview, unsaved edits, cancellation and failed commits", async () => {
    const s = setup(),
      p = await s.store.save(newWorkspaceProject("gym"), null);
    const input = {
      id: p.id,
      revision: p.revision,
      requestId: "race",
      changes: { metadata: { title: "AI title" } },
    };
    await s.tool("apply").preview!(JSON.stringify(input));
    await s.store.save({ ...p, title: "manual" }, p.revision);
    await expect(s.call("apply", input)).rejects.toThrow("变化");
    const current = s.store.getSnapshot()[0]!,
      clean = s.store.registerDraft(p.id, () => true);
    await expect(
      applyChanges(s.store, p.id, current.revision, input.changes, "draft"),
    ).rejects.toThrow("未保存");
    clean();
    const controller = new AbortController();
    controller.abort();
    await expect(
      applyChanges(s.store, p.id, current.revision, input.changes, "cancel", controller.signal),
    ).rejects.toThrow();
    s.metadata.batch.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      applyChanges(s.store, p.id, current.revision, input.changes, "retry"),
    ).rejects.toThrow("disk full");
    expect(s.store.getSnapshot()[0]!.title).toBe("manual");
    expect(
      (await applyChanges(s.store, p.id, current.revision, input.changes, "retry")).title,
    ).toBe("AI title");
  });
  it("does not persist trial parameters and invalidates bound prose on model/source changes", async () => {
    const s = setup(),
      p = await s.store.save(newWorkspaceProject("cooking"), null);
    const trial = await s.call("evaluate", {
      id: p.id,
      modelId: "cost",
      overrides: { loss: "0.4" },
    });
    expect(trial.result.rows[0].values.home).toBe("20");
    expect(
      s.store.getSnapshot()[0]!.models![0]!.parameters.find((p) => p.id === "loss")!.value,
    ).toBe("0.15");
    const run = analysisRuns(p)[0]!;
    const bound = prepareChanges(p, {
      pagePatches: [
        {
          id: "main",
          upsert: {
            intro: {
              type: "Text",
              props: { text: "成本受损耗影响", model: "cost", reviewedRun: run.id },
            },
          },
        },
      ],
    });
    const font = await s.store.assets.import(new Blob(["font"]), "font.woff");
    expect(() => createRelease(bound, null, font, [])).not.toThrow();
    const changed = decodeProject({
      ...bound,
      models: bound.models!.map((m) => ({
        ...m,
        parameters: m.parameters.map((p) => (p.id === "loss" ? { ...p, value: "0.4" } : p)),
      })),
    });
    expect(pageHtml(changed, changed.pages![0]!)).toContain("需要复核");
    expect(() => createRelease(changed, null, font, [])).toThrow("复核");
  });
  it("restores model/page snapshots offline and reproduces SVG and HTML while rejecting tampering", async () => {
    const s = setup(),
      p = newWorkspaceProject("commute"),
      font = await s.store.assets.import(new Blob(["font"]), "font.woff");
    const release = createRelease(p, null, font, []);
    const saved = await s.store.save({ ...p, releases: [release.id] }, null, [release]);
    const target = setup(),
      restored = await restoreArchive(
        await prepareArchive(await exportArchive(s.store, s.knowledge, saved)),
        target.store,
        target.knowledge,
      );
    expect(analysisRuns(restored)).toEqual(analysisRuns(saved));
    expect(pageSvg(restored, restored.pages![0]!)).toBe(pageSvg(saved, saved.pages![0]!));
    expect(pageHtml(restored, restored.pages![0]!)).toBe(pageHtml(saved, saved.pages![0]!));
    const corrupt = structuredClone(release);
    (corrupt.analysis![0]!.result.rows[0]!.values as Record<string, string>).cash = "1";
    expect(() => decodeRelease(corrupt)).toThrow("结果");
    const archive = await s.call("export", {
      id: saved.id,
      revision: saved.revision,
      kind: "archive",
    });
    expect(archive.status).toBe("exported");
    expect((await s.store.assets.readArtifact(archive.artifact)).size).toBeGreaterThan(0);
    const response = await s.call("restore", { artifact: archive.artifact });
    expect(response.status).toBe("saved");
  });
  it("escapes generated text and rejects executable props, orphan nodes and cycles", () => {
    const p = newWorkspaceProject("blank");
    const safe = prepareChanges(p, {
      pagePatches: [
        {
          id: "main",
          upsert: { intro: { type: "Text", props: { text: '<script>alert("x")</script>' } } },
        },
      ],
    });
    expect(pageHtml(safe, safe.pages![0]!)).not.toContain("<script>");
    expect(pageSvg(safe, safe.pages![0]!)).not.toContain("<script>");
    expect(() =>
      prepareChanges(p, {
        pagePatches: [
          {
            id: "main",
            upsert: { intro: { type: "Text", props: { text: "a", onClick: "alert(1)" } } },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      prepareChanges(p, {
        pagePatches: [
          {
            id: "main",
            upsert: { root: { type: "Stack", props: { gap: "wide" }, children: ["root"] } },
          },
        ],
      }),
    ).toThrow("循环");
  });
});
