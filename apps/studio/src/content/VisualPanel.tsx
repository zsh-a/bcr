import { useState } from "react";
import { Button, Input, Select } from "@bcr/react";
import type { VisualSpec } from "@bcr/visual-renderer/model";
import { evidenceSource, runModel, type ContentProject } from "./model";
import { ChartPreview } from "./ChartPreview";
import { Field, useUnsavedForm, type SaveProject, type RunAction } from "./forms";

export function VisualPanel({
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
  const [visuals, setVisuals] = useState<VisualSpec[]>(() => structuredClone([...project.visuals]));
  const dirty = JSON.stringify(visuals) !== JSON.stringify(project.visuals);
  useUnsavedForm(dirty);
  const result = runModel(project).result;
  const change = (index: number, patch: Partial<VisualSpec>) =>
    setVisuals(visuals.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">一份数据，多种表达</p>
          <h2>图表与版式</h2>
          <p>图表始终读取已保存的模型结果。发布时固定模板、参数与字体。</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(() => save({ ...project, visuals }));
        }}
      >
        <fieldset disabled={busy} className="content-stack">
          {visuals.map((spec, index) => (
            <section className="content-visual" key={index}>
              <div className="content-visual-controls">
                <span className="content-eyebrow">图 {String(index + 1).padStart(2, "0")}</span>
                <Field label="图表标题">
                  <Input
                    value={spec.title}
                    required
                    maxLength={160}
                    onChange={(e) => change(index, { title: e.target.value })}
                  />
                </Field>
                <Field label="画面比例">
                  <Select
                    value={spec.layout}
                    onChange={(e) =>
                      change(index, { layout: e.target.value as VisualSpec["layout"] })
                    }
                  >
                    <option value="landscape">横版 · 1440 × 900</option>
                    <option value="portrait">竖版 · 1080 × 1440</option>
                  </Select>
                </Field>
                <Field label="画面主题">
                  <Select
                    value={spec.theme}
                    onChange={(e) =>
                      change(index, { theme: e.target.value as VisualSpec["theme"] })
                    }
                  >
                    <option value="paper">暖纸与松绿</option>
                    <option value="night">深绿与浅金</option>
                  </Select>
                </Field>
                <Field label="补充来源说明" hint="留空时由参数关联的证据自动生成">
                  <Input
                    value={spec.source}
                    maxLength={1000}
                    onChange={(e) => change(index, { source: e.target.value })}
                  />
                </Field>
              </div>
              <div className="content-visual-preview">
                <ChartPreview
                  spec={{ ...spec, source: spec.source || evidenceSource(project) }}
                  result={result}
                />
              </div>
            </section>
          ))}
          <div className="content-form-actions">
            <span>SVG 与 PNG 随发布包导出，第一张图同时作为封面。</span>
            {dirty && (
              <Button
                type="button"
                onClick={() => setVisuals(structuredClone([...project.visuals]))}
              >
                撤销修改
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!dirty}>
              保存版式
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
