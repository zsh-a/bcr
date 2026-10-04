import { useMemo, useRef, useState } from "react";
import { Button, Select, useNavigation, useUpdateParticipant } from "@bcr/react";
import { createTextCitation, textVersion } from "@bcr/core";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KnowledgeNote } from "../knowledge/session/model";
import type { KnowledgeStore } from "../knowledge/session/store";
import { MarkdownEditor, type MarkdownEditorHandle } from "../knowledge/editor/MarkdownEditor";
import { useNoteDraft } from "../knowledge/editor/useNoteDraft";
import { claimStatus, projectOutputs, type ContentProject, type Claim } from "./model";
import { Field, useUnsavedForm, type SaveProject, type RunAction } from "./forms";
import { parseVisualUrl, visualUrl } from "./links";
import { ContentVisualImage } from "./KnowledgeContent";

export function ArticlePanel({
  project,
  note,
  knowledge,
  save,
  action,
  busy,
}: {
  project: ContentProject;
  note: KnowledgeNote;
  knowledge: KnowledgeStore;
  save: SaveProject;
  action: RunAction;
  busy: boolean;
}) {
  const { controller, note: draft, dirty, error } = useNoteDraft(note, knowledge, false);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null),
    [output, setOutput] = useState(() => Object.keys(projectOutputs(project).values)[0] ?? ""),
    [preview, setPreview] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null),
    navigation = useNavigation();
  const run = useMemo(() => projectOutputs(project), [project]);
  const outputs = run.values;
  useUnsavedForm(dirty);
  useUpdateParticipant({
    blocked: () => null,
    save: () => controller.flush().then(() => undefined),
  });
  async function bind(previous?: Claim) {
    if (!selection || selection.from === selection.to || selection.to - selection.from > 512)
      throw new Error("请选中 1–512 个字符，再关联模型输出");
    await controller.flush();
    const body = controller.getSnapshot().note.body;
    const key = previous?.output ?? output;
    const value = outputs[key];
    if (!value) throw new Error("模型输出已变化，请重新选择");
    const anchor = createTextCitation(
      body,
      { scope: note.id, unit: note.id, version: textVersion(body), offset: 0 },
      { start: selection.from, end: selection.to },
    );
    const claim: Claim = {
      id: previous?.id ?? crypto.randomUUID(),
      anchor,
      output: key,
      reviewedRun: run.id,
      reviewedValue: value.value,
      reviewedAt: Date.now(),
    };
    await save({ ...project, claims: [...project.claims.filter((c) => c.id !== claim.id), claim] });
  }
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">判断与数字一起维护</p>
          <h2>{note.title}</h2>
          <p role="status">{error || (dirty ? "文稿正在保存…" : "文稿已保存到知识库")}</p>
        </div>
        <div className="content-actions">
          <Button onClick={() => setPreview(!preview)}>{preview ? "编辑文稿" : "预览图文"}</Button>
          <Button
            disabled={busy}
            onClick={() =>
              action(async () => {
                await controller.flush();
                navigation.navigate(`/knowledge?note=${note.id}`);
              })
            }
          >
            在知识库打开 ↗
          </Button>
        </div>
      </div>
      <div className="content-writing-tools">
        <Button
          disabled={busy || preview || !project.model}
          onClick={() =>
            editor.current?.insert(`\n\n![方案比较图](${visualUrl(project.id, 0)})\n\n`)
          }
        >
          插入方案图
        </Button>
        <Button
          disabled={busy || preview || !project.model}
          onClick={() =>
            editor.current?.insert(`\n\n![临界点曲线](${visualUrl(project.id, 1)})\n\n`)
          }
        >
          插入临界点图
        </Button>
        <Button
          disabled={busy || !dirty}
          onClick={() => action(() => controller.flush().then(() => undefined))}
        >
          保存文稿
        </Button>
      </div>
      {preview ? (
        <div className="content-article-preview">
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => (parseVisualUrl(url) ? url : defaultUrlTransform(url))}
            components={{
              img: ({ src, alt }) =>
                src && parseVisualUrl(src) ? (
                  <ContentVisualImage url={src} alt={alt} />
                ) : (
                  <span>{alt || "附件"}（请在知识库中查看）</span>
                ),
            }}
          >
            {draft.body}
          </Markdown>
        </div>
      ) : (
        <div className="content-markdown-editor">
          <MarkdownEditor
            value={draft.body}
            label="内容项目文稿"
            maxLength={500000}
            onChange={(body) => controller.change({ body })}
            onSelectionChange={(ranges) => setSelection(ranges[0] ?? null)}
            sessionId={note.id}
            editorRef={editor}
          />
        </div>
      )}
      <div className="content-binding-tools">
        <Field label="关联模型输出">
          <Select value={output} onChange={(e) => setOutput(e.target.value)}>
            {Object.entries(outputs).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          disabled={busy || !selection || selection.from === selection.to || !outputs[output]}
          onClick={() => action(() => bind())}
        >
          绑定选中文本并复核
        </Button>
        <p>选择一段判断，关联它依赖的数字。价格变化时，保留原文并提醒复核。</p>
      </div>
      <div className="content-stack">
        {project.claims.map((claim) => {
          const status = claimStatus(claim, draft.body, run);
          return (
            <article className="content-claim" data-status={status} key={claim.id}>
              <div className="content-section-head">
                <span className="content-tag">
                  {status === "current"
                    ? "已复核"
                    : status === "review"
                      ? "需要复核"
                      : "需要重新关联"}
                </span>
                <span>{outputs[claim.output]?.label ?? "输出已移除"}</span>
              </div>
              <blockquote>{claim.anchor.exact}</blockquote>
              <p>
                上次：{claim.reviewedValue ?? "无有限值"} → 当前：
                {outputs[claim.output]?.value ?? "无有限值"}
              </p>
              <div className="content-actions">
                {status === "relink" ? (
                  <Button
                    disabled={busy || !selection || selection.from === selection.to}
                    onClick={() => action(() => bind(claim))}
                  >
                    用选中文本重新关联并复核
                  </Button>
                ) : (
                  <Button
                    disabled={busy || status === "current"}
                    onClick={() =>
                      action(async () => {
                        await controller.flush();
                        if (
                          claimStatus(claim, controller.getSnapshot().note.body, run) === "relink"
                        )
                          throw new Error("文稿已变化，请重新关联");
                        await save({
                          ...project,
                          claims: project.claims.map((c) =>
                            c.id === claim.id
                              ? {
                                  ...c,
                                  reviewedRun: run.id,
                                  reviewedValue: outputs[c.output]?.value ?? null,
                                  reviewedAt: Date.now(),
                                }
                              : c,
                          ),
                        });
                      })
                    }
                  >
                    确认判断仍成立
                  </Button>
                )}
                <Button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await controller.flush();
                      await save({
                        ...project,
                        claims: project.claims.filter((c) => c.id !== claim.id),
                      });
                    })
                  }
                >
                  解除绑定
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
