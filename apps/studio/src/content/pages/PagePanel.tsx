import { useMemo, useState } from "react";
import { Button, Input, Select, Textarea } from "@bcr/react";
import { analysisRuns, decodeProject, type ContentProject } from "../model";
import { Field, useUnsavedForm, type RunAction, type SaveProject } from "../forms";
import { PageView, type ParameterOverrides } from "./PageView";
import { presetContent } from "./presets";
import type { PageSpec } from "./model";

export function PagePanel({
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
  const runs = useMemo(() => analysisRuns(project), [project]);
  const [pages, setPages] = useState([...(project.pages ?? [])]);
  const [selected, setSelected] = useState(pages[0]?.id ?? "");
  const [overrides, setOverrides] = useState<ParameterOverrides>({});
  const page = pages.find((p) => p.id === selected) ?? pages[0];
  const dirty =
    JSON.stringify(pages) !== JSON.stringify(project.pages ?? []) ||
    Object.keys(overrides).length > 0;
  useUnsavedForm(dirty);
  const change = (patch: Partial<PageSpec>) =>
    setPages(pages.map((p) => (p.id === page?.id ? { ...p, ...patch } : p)));
  return (
    <div className="content-page-editor">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">资料、数字与表达</p>
          <h2>创作页面</h2>
          <p>让助手组织页面，也可以在这里修改文字和参数。试算仅在保存后成为项目数据。</p>
        </div>
        <Button
          disabled={busy || pages.length >= 20}
          onClick={() => {
            const fresh = {
              ...presetContent("blank").pages[0]!,
              id: `page-${crypto.randomUUID()}`,
              title: `页面 ${pages.length + 1}`,
            };
            setPages([...pages, fresh]);
            setSelected(fresh.id);
          }}
        >
          添加页面
        </Button>
      </div>
      {page && (
        <>
          <fieldset disabled={busy} className="content-page-controls">
            <Field label="页面">
              <Select value={page.id} onChange={(e) => setSelected(e.target.value)}>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="页面名称">
              <Input
                value={page.title}
                maxLength={200}
                onChange={(e) => change({ title: e.target.value })}
              />
            </Field>
            <Field label="版式">
              <Select
                value={page.layout}
                onChange={(e) => change({ layout: e.target.value as PageSpec["layout"] })}
              >
                <option value="landscape">宽屏</option>
                <option value="portrait">竖版</option>
              </Select>
            </Field>
            <Field label="主题">
              <Select
                value={page.theme}
                onChange={(e) => change({ theme: e.target.value as PageSpec["theme"] })}
              >
                <option value="paper">纸张</option>
                <option value="night">深色</option>
              </Select>
            </Field>
          </fieldset>
          <div className="content-form-actions">
            <span>{dirty ? "页面或试算参数尚未保存" : "已保存 · 可通过助手继续编辑"}</span>
            {dirty && (
              <Button
                disabled={busy}
                onClick={() => {
                  setPages([...(project.pages ?? [])]);
                  setOverrides({});
                }}
              >
                撤销修改
              </Button>
            )}
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() =>
                action(async () => {
                  const models = project.models?.map((m) => ({
                    ...m,
                    parameters: m.parameters.map((p) => ({
                      ...p,
                      value: overrides[m.id]?.[p.id] ?? p.value,
                    })),
                  }));
                  await save(decodeProject({ ...project, pages, ...(models ? { models } : {}) }));
                })
              }
            >
              保存页面与参数
            </Button>
          </div>
          <PageView
            project={project}
            page={page}
            overrides={overrides}
            onParameter={(model, parameter, value) =>
              setOverrides({ ...overrides, [model]: { ...overrides[model], [parameter]: value } })
            }
          />
          <details className="content-block-editor">
            <summary>编辑页面文字</summary>
            {Object.entries(page.elements).flatMap(([id, block]) =>
              block.type === "Heading" || block.type === "Text"
                ? [
                    <Field
                      key={id}
                      label={block.type === "Heading" ? `标题 · ${id}` : `正文 · ${id}`}
                    >
                      <Textarea
                        aria-label={block.type === "Heading" ? `标题 · ${id}` : `正文 · ${id}`}
                        disabled={busy}
                        value={block.props.text}
                        maxLength={10000}
                        rows={3}
                        onChange={(e) =>
                          change({
                            elements: {
                              ...page.elements,
                              [id]:
                                block.type === "Heading"
                                  ? { ...block, props: { ...block.props, text: e.target.value } }
                                  : { ...block, props: { ...block.props, text: e.target.value } },
                            },
                          })
                        }
                      />
                      {block.type === "Text" && block.props.model && (
                        <Button
                          disabled={
                            busy ||
                            Object.keys(overrides).length > 0 ||
                            block.props.reviewedRun ===
                              runs.find((r) => r.model.id === block.props.model)?.id
                          }
                          onClick={() => {
                            const run = runs.find((r) => r.model.id === block.props.model);
                            if (run)
                              change({
                                elements: {
                                  ...page.elements,
                                  [id]: {
                                    ...block,
                                    props: { ...block.props, reviewedRun: run.id },
                                  },
                                },
                              });
                          }}
                        >
                          确认判断仍成立
                        </Button>
                      )}
                    </Field>,
                  ]
                : [],
            )}
          </details>
        </>
      )}
      {!page && <p>添加一个页面，或让助手根据资料和模型生成页面。</p>}
    </div>
  );
}
