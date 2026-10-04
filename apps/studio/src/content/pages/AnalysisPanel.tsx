import { useState } from "react";
import { Button, Select, Textarea } from "@bcr/react";
import { evaluateAnalysis } from "@bcr/economics-core/analysis";
import { decodeProject, type ContentProject } from "../model";
import { Field, useUnsavedForm, type SaveProject, type RunAction } from "../forms";
import { presetContent, presetLabels, type ContentPreset } from "./presets";

export function AnalysisPanel({
  project,
  save,
  action,
  busy,
}: {
  project: ContentProject;
  save: SaveProject;
  action: RunAction;
  busy: boolean;
}) {
  const [source, setSource] = useState(JSON.stringify(project.models ?? [], null, 2));
  const [preset, setPreset] = useState<ContentPreset>("gym");
  const dirty = source !== JSON.stringify(project.models ?? [], null, 2);
  useUnsavedForm(dirty);
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">可复算的条件与假设</p>
          <h2>计算模型</h2>
          <p>参数在页面中调整。助手可以建立公式、情景和敏感性范围，现金与时间分别计算。</p>
        </div>
      </div>
      {!project.models?.length && (
        <div className="content-actions">
          <Select
            aria-label="模型预设"
            value={preset}
            onChange={(e) => setPreset(e.target.value as ContentPreset)}
          >
            {Object.entries(presetLabels)
              .filter(([id]) => id !== "blank")
              .map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
          </Select>
          <Button
            disabled={busy || dirty}
            onClick={() =>
              action(async () => {
                const content = presetContent(preset);
                await save(
                  decodeProject({
                    ...project,
                    models: content.models,
                    pages: [
                      ...(project.pages ?? []),
                      ...content.pages.map((p) => ({ ...p, id: `page-${crypto.randomUUID()}` })),
                    ],
                  }),
                );
              })
            }
          >
            添加示例模型与页面
          </Button>
        </div>
      )}
      {project.models?.map((model) => {
        const result = evaluateAnalysis(model);
        return (
          <section className="content-parameter" key={model.id}>
            <h3>{model.title}</h3>
            <p>
              {model.parameters.length} 个参数 · {model.formulas.length} 个输出 ·{" "}
              {model.scenarios.length} 个情景
            </p>
            <dl>
              {model.formulas.map((f) => (
                <div key={f.id}>
                  <dt>{f.label}</dt>
                  <dd>
                    {result.rows[0]!.values[f.id]} <small>{f.unit}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      <details>
        <summary>高级模型定义</summary>
        <p>可以让助手修改这些定义。保存时会检查公式、单位、循环依赖以及页面引用。</p>
        <Field label="模型定义 JSON">
          <Textarea
            className="content-model-json"
            value={source}
            disabled={busy}
            onChange={(e) => setSource(e.target.value)}
          />
        </Field>
        <div className="content-form-actions">
          <Button
            disabled={busy || !dirty}
            onClick={() => setSource(JSON.stringify(project.models ?? [], null, 2))}
          >
            撤销修改
          </Button>
          <Button
            disabled={busy || !dirty}
            variant="primary"
            onClick={() =>
              action(async () => {
                await save(decodeProject({ ...project, models: JSON.parse(source) }));
              })
            }
          >
            保存模型
          </Button>
        </div>
      </details>
    </div>
  );
}
