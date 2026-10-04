import Papa from "papaparse";
import {
  PARAMETER_KEYS,
  validateModel,
  type ParameterKey,
  type FixedUseModel,
} from "@bcr/economics-core";
import { decodeProject, type ContentProject, type Evidence } from "./model";
import type { ContentStore } from "./store";

export async function preparePriceImport(
  file: File,
  project: ContentProject,
): Promise<ContentProject> {
  if (file.size > 1024 * 1024) throw new Error("价格 CSV 上限为 1 MiB");
  const raw = await file.text();
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (
    parsed.errors.length ||
    !parsed.meta.fields?.includes("parameter") ||
    !parsed.meta.fields.includes("value")
  )
    throw new Error("CSV 需包含 parameter,value 两列，且不能有解析错误");
  if (!parsed.data.length || parsed.data.length > 512)
    throw new Error("价格 CSV 需包含 1–512 行参数");
  if (!project.model) {
    const models = structuredClone([...(project.models ?? [])]),
      seen = new Set<string>(),
      evidenceId = crypto.randomUUID();
    for (const row of parsed.data) {
      const modelId = row.model?.trim() || (models.length === 1 ? models[0]!.id : "");
      const model = models.find((m) => m.id === modelId),
        key = row.parameter?.trim();
      if (!model || !key || !model.parameters.some((p) => p.id === key))
        throw new Error("CSV 的 model / parameter 引用不存在");
      const identity = `${modelId}:${key}`;
      if (seen.has(identity)) throw new Error("CSV 参数重复");
      seen.add(identity);
      const i = models.indexOf(model);
      models[i] = {
        ...model,
        parameters: model.parameters.map((p) =>
          p.id === key
            ? { ...p, value: row.value?.trim() ?? "", evidenceId, provenance: "external" }
            : p,
        ),
      };
    }
    const evidence: Evidence = {
      id: evidenceId,
      title: file.name,
      url: "",
      capturedAt: Date.now(),
      applicableDate: "",
      region: "",
      store: "",
      specification: "",
      author: "",
      license: "",
      text: raw,
      asset: null,
    };
    const candidate = decodeProject({
      ...project,
      models,
      evidence: [...project.evidence, evidence],
    });
    return candidate;
  }
  const model: FixedUseModel = structuredClone(project.model),
    seen = new Set<string>(),
    evidenceId = crypto.randomUUID();
  for (const row of parsed.data) {
    const key = row.parameter?.trim();
    if (!PARAMETER_KEYS.includes(key as ParameterKey) || seen.has(key!))
      throw new Error("参数必须为 fixed、variable、alternative、weeks，且不能重复");
    seen.add(key!);
    model.parameters[key as ParameterKey] = {
      value: row.value?.trim() ?? "",
      evidenceId,
      provenance: "external",
    };
  }
  validateModel(model);
  const evidence: Evidence = {
    id: evidenceId,
    title: file.name,
    url: "",
    capturedAt: Date.now(),
    applicableDate: "",
    region: "",
    store: "",
    specification: "",
    author: "",
    license: "",
    text: raw,
    asset: null,
  };
  return decodeProject({ ...project, model, evidence: [...project.evidence, evidence] });
}

export async function importPrices(
  file: File,
  project: ContentProject,
  store: ContentStore,
): Promise<ContentProject> {
  const candidate = await preparePriceImport(file, project);
  const evidence = candidate.evidence.at(-1)!;
  const asset = await store.assets.import(file, file.name);
  return decodeProject({ ...candidate, evidence: [...project.evidence, { ...evidence, asset }] });
}
