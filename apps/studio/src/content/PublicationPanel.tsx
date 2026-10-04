import { useState } from "react";
import { Button, Input, Select } from "@bcr/react";
import type { ContentProject, Publication } from "./model";
import { Field, useUnsavedForm, type SaveProject, type RunAction } from "./forms";

const localDate = (time: number) =>
  new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const blank = (project: ContentProject): Publication => ({
  id: crypto.randomUUID(),
  releaseId: project.releases.at(-1) ?? "",
  platform: "",
  url: "",
  title: project.title,
  publishedAt: Date.now(),
  hours: null,
  aiCost: null,
  materialCost: null,
  platformRevenue: null,
  adRevenue: null,
  observations: [],
});
const costFields = {
  hours: "制作工时（小时）",
  aiCost: "AI 费用（元）",
  materialCost: "素材费用（元）",
  platformRevenue: "平台分成（元）",
  adRevenue: "广告收入（元）",
} as const;
export function PublicationPanel({
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
  const [record, setRecord] = useState<Publication | null>(null);
  useUnsavedForm(record !== null);
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">让制作投入可衡量</p>
          <h2>发布与经营记录</h2>
          <p>保留平台原始指标定义。空白代表缺失，零代表实际观测为零。</p>
        </div>
        <Button
          variant="primary"
          disabled={busy || !project.releases.length || !!record}
          onClick={() => setRecord(blank(project))}
        >
          添加发布记录
        </Button>
      </div>
      {!project.releases.length && (
        <p className="content-notice">先在“发布与归档”中生成作品快照，再关联实际发布记录。</p>
      )}
      {record && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await save({
                ...project,
                status: "published",
                publications: [...project.publications.filter((p) => p.id !== record.id), record],
              });
              setRecord(null);
            });
          }}
        >
          <fieldset disabled={busy} className="content-stack">
            <div className="content-field-pair">
              <Field label="发布平台">
                <Input
                  required
                  maxLength={100}
                  value={record.platform}
                  onChange={(e) => setRecord({ ...record, platform: e.target.value })}
                />
              </Field>
              <Field label="作品快照">
                <Select
                  value={record.releaseId}
                  onChange={(e) => setRecord({ ...record, releaseId: e.target.value })}
                >
                  {project.releases.map((id, i) => (
                    <option key={id} value={id}>
                      版本 {i + 1} · {id.slice(-8)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="实际发布标题">
              <Input
                required
                maxLength={300}
                value={record.title}
                onChange={(e) => setRecord({ ...record, title: e.target.value })}
              />
            </Field>
            <div className="content-field-pair">
              <Field label="作品链接">
                <Input
                  type="url"
                  value={record.url}
                  onChange={(e) => setRecord({ ...record, url: e.target.value })}
                />
              </Field>
              <Field label="发布时间">
                <Input
                  type="datetime-local"
                  required
                  value={localDate(record.publishedAt)}
                  onChange={(e) => {
                    if (e.target.value)
                      setRecord({ ...record, publishedAt: new Date(e.target.value).getTime() });
                  }}
                />
              </Field>
            </div>
            <div className="content-cost-grid">
              {Object.entries(costFields).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    inputMode="decimal"
                    placeholder="未记录"
                    value={record[key as keyof typeof costFields] ?? ""}
                    onChange={(e) => setRecord({ ...record, [key]: e.target.value || null })}
                  />
                </Field>
              ))}
            </div>
            <div className="content-section-head">
              <h3>指标观测</h3>
              <Button
                type="button"
                onClick={() =>
                  setRecord({
                    ...record,
                    observations: [
                      ...record.observations,
                      {
                        id: crypto.randomUUID(),
                        observedAt: Date.now(),
                        windowDays: 7,
                        metric: "播放量",
                        value: null,
                        unit: "次",
                        definition: "平台显示的累计播放量",
                      },
                    ],
                  })
                }
              >
                添加观测指标
              </Button>
            </div>
            {record.observations.map((o, index) => {
              const change = (patch: Partial<typeof o>) =>
                setRecord({
                  ...record,
                  observations: record.observations.map((v, i) =>
                    i === index ? { ...v, ...patch } : v,
                  ),
                });
              return (
                <div className="content-observation" key={o.id}>
                  <div className="content-field-pair">
                    <Field label="指标名称">
                      <Input
                        required
                        value={o.metric}
                        onChange={(e) => change({ metric: e.target.value })}
                      />
                    </Field>
                    <Field label="观察窗口（天）">
                      <Input
                        type="number"
                        min={1}
                        max={3660}
                        required
                        value={o.windowDays}
                        onChange={(e) => change({ windowDays: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                  <div className="content-field-pair">
                    <Field label="观测值">
                      <Input
                        inputMode="decimal"
                        placeholder="缺失"
                        value={o.value ?? ""}
                        onChange={(e) => change({ value: e.target.value || null })}
                      />
                    </Field>
                    <Field label="单位">
                      <Input value={o.unit} onChange={(e) => change({ unit: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="指标定义与统计口径">
                    <Input
                      required
                      value={o.definition}
                      placeholder="例如累计播放量；完播率的分母为平台有效播放"
                      onChange={(e) => change({ definition: e.target.value })}
                    />
                  </Field>
                  <Field label="实际采集时间">
                    <Input
                      type="datetime-local"
                      required
                      value={localDate(o.observedAt)}
                      onChange={(e) => {
                        if (e.target.value)
                          change({ observedAt: new Date(e.target.value).getTime() });
                      }}
                    />
                  </Field>
                  <Button
                    type="button"
                    onClick={() =>
                      setRecord({
                        ...record,
                        observations: record.observations.filter((v) => v.id !== o.id),
                      })
                    }
                  >
                    移除指标
                  </Button>
                </div>
              );
            })}
            <div className="content-form-actions">
              <Button type="button" onClick={() => setRecord(null)}>
                取消
              </Button>
              <Button type="submit" variant="primary">
                保存发布记录
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {project.publications.map((p) => (
        <article className="content-evidence" key={p.id}>
          <div className="content-section-head">
            <div>
              <span className="content-eyebrow">
                {p.platform} · {new Date(p.publishedAt).toLocaleDateString()}
              </span>
              <h3>{p.title}</h3>
            </div>
            <Button disabled={busy || !!record} onClick={() => setRecord(p)}>
              编辑记录
            </Button>
          </div>
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer">
              查看已发布作品 ↗
            </a>
          )}
          <dl className="content-cost-summary">
            {Object.entries(costFields).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{p[key as keyof typeof costFields] ?? "未记录"}</dd>
              </div>
            ))}
          </dl>
          {p.observations.map((o) => (
            <p key={o.id}>
              第 {o.windowDays} 天 · {o.metric}：
              <strong>
                {o.value ?? "缺失"} {o.value === null ? "" : o.unit}
              </strong>
              <br />
              <small>
                {o.definition} · 采集于 {new Date(o.observedAt).toLocaleString()}
              </small>
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}
