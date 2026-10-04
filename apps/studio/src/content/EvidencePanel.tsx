import { useRef, useState } from "react";
import { Button, Input, Textarea } from "@bcr/react";
import type { ContentProject, Evidence } from "./model";
import type { ContentStore } from "./store";
import { Field, useUnsavedForm, type RunAction, type SaveProject } from "./forms";
import { importPrices } from "./importPrices";

const blank = (): Evidence => ({
  id: crypto.randomUUID(),
  title: "",
  url: "",
  capturedAt: Date.now(),
  applicableDate: "",
  region: "",
  store: "",
  specification: "",
  author: "",
  license: "",
  text: "",
  asset: null,
});
export function EvidencePanel({
  project,
  store,
  save,
  action,
  busy,
}: {
  project: ContentProject;
  store: ContentStore;
  save: SaveProject;
  action: RunAction;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<Evidence | null>(null),
    [file, setFile] = useState<File | null>(null);
  const csv = useRef<HTMLInputElement>(null);
  useUnsavedForm(editing !== null);
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">让数字有出处</p>
          <h2>资料与证据</h2>
          <p>保存原始报价、适用地区和日期，再把证据关联到模型参数。</p>
        </div>
        <div className="content-actions">
          <Button disabled={busy || !!editing} onClick={() => csv.current?.click()}>
            导入价格 CSV
          </Button>
          <Button
            variant="primary"
            disabled={busy || !!editing}
            onClick={() => setEditing(blank())}
          >
            添加证据
          </Button>
        </div>
      </div>
      <input
        ref={csv}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="导入价格 CSV 文件"
        onChange={(e) => {
          const incoming = e.target.files?.[0];
          e.target.value = "";
          if (incoming)
            action(async () => {
              await save(await importPrices(incoming, project, store));
            });
        }}
      />
      <details className="content-details">
        <summary>价格 CSV 格式</summary>
        <pre>
          {project.model
            ? "parameter,value\nfixed,2400\nvariable,0\nalternative,60\nweeks,52"
            : "model,parameter,value\ncost,fixed,2400\ncost,perUse,60"}
        </pre>
        <p>全部数值按原始十进制文本读取。导入后保留 CSV 原件；请补充其出处和适用日期。</p>
      </details>
      {editing && (
        <form
          className="content-editor-card"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const asset = file ? await store.assets.import(file, file.name) : editing.asset;
              const record = { ...editing, asset };
              await save({
                ...project,
                evidence: [...project.evidence.filter((e) => e.id !== record.id), record],
              });
              setEditing(null);
              setFile(null);
            });
          }}
        >
          <fieldset disabled={busy} className="content-stack">
            <div className="content-field-pair">
              <Field label="资料标题">
                <Input
                  required
                  maxLength={300}
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </Field>
              <Field label="网页来源">
                <Input
                  type="url"
                  placeholder="https://…"
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                />
              </Field>
            </div>
            <div className="content-field-pair">
              <Field label="适用日期">
                <Input
                  type="date"
                  value={editing.applicableDate}
                  onChange={(e) => setEditing({ ...editing, applicableDate: e.target.value })}
                />
              </Field>
              <Field label="适用地区">
                <Input
                  value={editing.region}
                  maxLength={100}
                  onChange={(e) => setEditing({ ...editing, region: e.target.value })}
                />
              </Field>
            </div>
            <div className="content-field-pair">
              <Field label="门店 / 机构">
                <Input
                  value={editing.store}
                  maxLength={200}
                  onChange={(e) => setEditing({ ...editing, store: e.target.value })}
                />
              </Field>
              <Field label="规格与条件">
                <Input
                  value={editing.specification}
                  maxLength={300}
                  onChange={(e) => setEditing({ ...editing, specification: e.target.value })}
                />
              </Field>
            </div>
            <div className="content-field-pair">
              <Field label="作者">
                <Input
                  value={editing.author}
                  maxLength={200}
                  onChange={(e) => setEditing({ ...editing, author: e.target.value })}
                />
              </Field>
              <Field label="许可 / 使用说明">
                <Input
                  value={editing.license}
                  maxLength={300}
                  onChange={(e) => setEditing({ ...editing, license: e.target.value })}
                />
              </Field>
            </div>
            <Field label="保存的原文或摘录">
              <Textarea
                rows={7}
                maxLength={500000}
                value={editing.text}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              />
            </Field>
            <Field label="原始文件或截图（最多 16 MiB）">
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            {editing.asset && <small>已保存：{editing.asset.name}</small>}
            <div className="content-form-actions">
              <Button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFile(null);
                }}
              >
                取消
              </Button>
              <Button type="submit" variant="primary">
                保存证据
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {!project.evidence.length && !editing && (
        <div className="content-empty">
          <h3>从一条可核验的报价开始</h3>
          <p>当前模型使用自设示例。添加真实资料后，在“模型”中关联对应参数。</p>
        </div>
      )}
      {project.evidence.map((e) => (
        <article className="content-evidence" key={e.id}>
          <div className="content-section-head">
            <div>
              <h3>{e.title}</h3>
              <p>
                {[e.applicableDate, e.region, e.store, e.specification]
                  .filter(Boolean)
                  .join(" · ") || "适用范围待补充"}
              </p>
            </div>
            <div className="content-actions">
              <Button disabled={busy || !!editing} onClick={() => setEditing(e)}>
                编辑
              </Button>
              <Button
                disabled={
                  busy ||
                  !!editing ||
                  Object.values(project.model?.parameters ?? {}).some(
                    (p) => p.evidenceId === e.id,
                  ) ||
                  project.models?.some((m) => m.parameters.some((p) => p.evidenceId === e.id))
                }
                onClick={() =>
                  action(() =>
                    save({
                      ...project,
                      evidence: project.evidence.filter((item) => item.id !== e.id),
                    }),
                  )
                }
              >
                移除
              </Button>
            </div>
          </div>
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer">
              打开原始来源 ↗
            </a>
          )}
          <p className="content-excerpt">{e.text.slice(0, 600)}</p>
          <footer>
            采集于 {new Date(e.capturedAt).toLocaleString()} · {e.license || "许可尚未记录"}
            {e.asset && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const { download } = await import("./export");
                    download(await store.assets.read(e.asset!), e.asset!.name);
                  })
                }
              >
                下载 {e.asset.name}
              </Button>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
