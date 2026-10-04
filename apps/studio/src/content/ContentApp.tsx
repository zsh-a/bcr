import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AppToolbar,
  Button,
  Input,
  Select,
  Textarea,
  useLocationSearch,
  useNavigation,
  useRuntime,
  useOpenAssistant,
  useUpdateParticipant,
} from "@bcr/react";
import { Clapperboard, Plus, Upload, ArrowUpRight, Check, Circle } from "lucide-react";
import { workspaceServices } from "../workspace";
import { claimStatus, projectOutputs, newWorkspaceProject, type ContentProject } from "./model";
import { PagePanel } from "./pages/PagePanel";
import { AnalysisPanel } from "./pages/AnalysisPanel";
import { presetLabels, type ContentPreset } from "./pages/presets";
import { saveProject } from "./commands";
import { createContentProject } from "./service";
import {
  Field,
  ContentDraftContext,
  useUnsavedForm,
  type RunAction,
  type SaveProject,
} from "./forms";
import { ModelPanel } from "./ModelPanel";
import { EvidencePanel } from "./EvidencePanel";
import { VisualPanel } from "./VisualPanel";
import { ArticlePanel } from "./ArticlePanel";
import { ReleasePanel } from "./ReleasePanel";
import { PublicationPanel } from "./PublicationPanel";
import type { PreparedArchive } from "./archive";
import "./content.css";

const sections = [
  ["overview", "选题"],
  ["evidence", "资料"],
  ["model", "模型"],
  ["visuals", "图表"],
  ["pages", "页面"],
  ["article", "文稿"],
  ["release", "发布与归档"],
  ["publications", "经营记录"],
] as const;
type Section = (typeof sections)[number][0];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ContentApp() {
  const openAssistant = useOpenAssistant();
  const upload = useRef<HTMLInputElement>(null);
  const runtime = useRuntime(),
    navigation = useNavigation(),
    search = useLocationSearch();
  const workspace = useMemo(() => workspaceServices(runtime), [runtime]);
  const store = workspace.content,
    knowledge = workspace.knowledge;
  const projects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const notes = useSyncExternalStore(knowledge.subscribe, knowledge.getSnapshot);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [section, setSection] = useState<Section>("overview");
  const [preset, setPreset] = useState<ContentPreset>("blank");
  const [prepared, setPrepared] = useState<PreparedArchive | null>(null);
  const running = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const selected = new URLSearchParams(search).get("project");
  const project = selected ? projects.find((p) => p.id === selected) : projects[0];
  const note = project?.noteId ? notes.notes[project.noteId] : undefined;
  const run = useMemo(() => (project ? projectOutputs(project) : null), [project]);
  useEffect(() => {
    let live = true;
    void Promise.all([store.ready, knowledge.ready]).then(
      () => {
        if (live) setReady(true);
      },
      (e: unknown) => {
        if (live) setError(message(e));
      },
    );
    return () => {
      live = false;
    };
  }, [store, knowledge]);
  useUpdateParticipant({
    blocked: () => (busy ? "内容项目正在处理导入、导出或保存，请稍后更新。" : null),
    save: () => store.flush(),
  });
  useEffect(() => {
    if (!busy) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [busy]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!project) return;
    store.current = { id: project.id, section, dirty };
    return () => {
      if (store.current?.id === project.id) store.current = null;
    };
  }, [store, project, section, dirty]);
  useEffect(
    () => (project ? store.registerDraft(project.id, () => dirtyRef.current) : undefined),
    [store, project?.id],
  );
  const action: RunAction = (run) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    void run()
      .catch((e: unknown) => setError(message(e)))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };
  const save: SaveProject = async (next) => {
    await saveProject(store, next);
  };
  function guard(run: () => void) {
    if (dirty) {
      setError("当前表单尚未保存，请先保存或取消编辑。");
      return;
    }
    if (busy) return;
    setError("");
    run();
  }
  function select(id: string) {
    guard(() => {
      navigation.navigate(`/content?project=${id}`);
      setSection("overview");
    });
  }
  const pending =
    project && note && run
      ? project.claims.filter((c) => claimStatus(c, note.body, run) !== "current").length
      : 0;
  return (
    <div className="content-app">
      <AppToolbar>
        <Clapperboard size={20} />
        <strong>内容项目</strong>
        <Button onClick={openAssistant} disabled={!openAssistant}>
          AI 创作
        </Button>
        <Button disabled={busy} onClick={() => guard(() => upload.current?.click())}>
          提供文件给助手
        </Button>
        <span className="content-toolbar-spacer" />
        {project && (
          <Select
            aria-label="选择内容项目"
            value={project.id}
            disabled={busy}
            onChange={(e) => select(e.target.value)}
          >
            {projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        )}
        <Button disabled={!ready || busy} onClick={() => guard(() => input.current?.click())}>
          <Upload size={15} />
          恢复归档
        </Button>
        <Select
          aria-label="新项目预设"
          value={preset}
          disabled={busy}
          onChange={(e) => setPreset(e.target.value as ContentPreset)}
        >
          {Object.entries(presetLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Button
          disabled={!ready || busy}
          onClick={() =>
            guard(() =>
              action(async () => {
                const p = await store.save(newWorkspaceProject(preset), null);
                navigation.navigate(`/content?project=${p.id}`);
                setSection("overview");
              }),
            )
          }
        >
          <Plus size={15} />
          新建选题
        </Button>
      </AppToolbar>
      <input
        hidden
        ref={upload}
        type="file"
        aria-label="提供文件给助手"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            action(async () => {
              const artifact = await store.assets.importArtifact(file, file.name);
              store.uploads = [
                ...store.uploads.filter((a) => a.hash !== artifact.hash),
                artifact,
              ].slice(-10);
            });
        }}
      />
      {store.uploads.length > 0 && (
        <div className="content-progress" role="status">
          助手可读取：{store.uploads.map((a) => a.name).join("、")}
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept=".zip"
        aria-label="选择内容项目归档"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            action(async () => {
              const { prepareArchive } = await import("./archive");
              setPrepared(await prepareArchive(file));
            });
        }}
      />
      {error && (
        <div className="content-alert" role="alert">
          <span>{error}</span>
          <Button size="sm" disabled={busy || dirty} onClick={() => action(() => store.refresh())}>
            刷新项目
          </Button>
        </div>
      )}
      {busy && (
        <div className="content-progress" role="status">
          正在处理，请稍候…
        </div>
      )}
      {prepared && (
        <section className="content-restore" aria-label="归档恢复预览">
          <div>
            <h2>恢复《{prepared.manifest.project.title}》</h2>
            <p>
              已核验 {prepared.manifest.assets.length} 个素材、{prepared.manifest.releases.length}{" "}
              个发布快照。恢复为独立副本，同一归档再次导入会复用该副本。
            </p>
          </div>
          <div className="content-actions">
            <Button disabled={busy} onClick={() => setPrepared(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const { restoreArchive } = await import("./archive");
                  const p = await restoreArchive(prepared, store, knowledge);
                  setPrepared(null);
                  navigation.navigate(`/content?project=${p.id}`);
                  setSection("overview");
                })
              }
            >
              恢复项目
            </Button>
          </div>
        </section>
      )}
      {!ready ? (
        <div className="content-empty">正在加载内容工作区…</div>
      ) : !project ? (
        <main className="content-welcome">
          <span className="content-eyebrow">BCR / CREATOR WORKSPACE</span>
          <h1>
            把生活中的问题，
            <br />
            做成有依据的作品。
          </h1>
          <p>
            收集资料，比较情景，把数字变成图表和文章。
            <br />
            从空白专题开始，或选择一个模型预设；助手可继续组织页面。
          </p>
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={() =>
              action(async () => {
                const p = await createContentProject(store, knowledge);
                navigation.navigate(`/content?project=${p.id}`);
              })
            }
          >
            创建健身卡示例 <ArrowUpRight size={18} />
          </Button>
          <div className="content-welcome-steps">
            <span>01 / 留下出处</span>
            <span>02 / 计算与表达</span>
            <span>03 / 发布与复盘</span>
          </div>
        </main>
      ) : (
        <div className="content-workspace">
          <aside className="content-sidebar">
            <div className="content-project-title">
              <span className="content-eyebrow">研究与创作 · 内容项目</span>
              <h1>{project.title}</h1>
              <span className="content-tag">
                {project.status === "published"
                  ? "已发布"
                  : project.status === "ready"
                    ? "待发布"
                    : project.status === "writing"
                      ? "写作中"
                      : "研究中"}
              </span>
            </div>
            <nav aria-label="内容创作流程">
              {sections
                .filter(([key]) => key !== "visuals" || project.model)
                .map(([key, label], index) => (
                  <button
                    key={key}
                    aria-current={section === key ? "step" : undefined}
                    disabled={busy}
                    onClick={() => guard(() => setSection(key))}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {label}
                    {key === "article" && pending > 0 && <b>{pending}</b>}
                  </button>
                ))}
            </nav>
            <div className="content-sidebar-note">
              <p>{pending ? `${pending} 项判断需要复核` : "每个发布版本，都保留当时的依据。"}</p>
              <small>
                {project.evidence.length} 条证据 · {project.releases.length} 个发布版本
              </small>
            </div>
          </aside>
          <main className="content-main" aria-label="内容项目工作区">
            <ContentDraftContext.Provider value={setDirty}>
              <div key={`${project.id}:${project.revision}:${section}`}>
                {section === "overview" && (
                  <Overview project={project} save={save} action={action} busy={busy} />
                )}
                {section === "evidence" && (
                  <EvidencePanel
                    project={project}
                    store={store}
                    save={save}
                    action={action}
                    busy={busy}
                  />
                )}
                {section === "model" &&
                  (project.model ? (
                    <ModelPanel project={project} save={save} action={action} busy={busy} />
                  ) : (
                    <AnalysisPanel project={project} save={save} action={action} busy={busy} />
                  ))}
                {section === "pages" && (
                  <PagePanel project={project} save={save} action={action} busy={busy} />
                )}
                {section === "visuals" && project.model && (
                  <VisualPanel project={project} save={save} action={action} busy={busy} />
                )}
                {section === "article" && (
                  <>
                    <div className="content-note-selector">
                      <Field label="关联知识库文稿">
                        <Select
                          disabled={busy}
                          value={project.noteId ?? ""}
                          onChange={(e) =>
                            guard(() =>
                              action(() =>
                                save({ ...project, noteId: e.target.value || null, claims: [] }),
                              ),
                            )
                          }
                        >
                          <option value="">选择文稿</option>
                          {Object.values(notes.notes).map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    {note ? (
                      <ArticlePanel
                        project={project}
                        note={note}
                        knowledge={knowledge}
                        save={save}
                        action={action}
                        busy={busy}
                      />
                    ) : (
                      <p>请选择知识库文稿。</p>
                    )}
                  </>
                )}
                {section === "release" && (
                  <ReleasePanel
                    project={project}
                    store={store}
                    knowledge={knowledge}
                    action={action}
                    busy={busy}
                  />
                )}
                {section === "publications" && (
                  <PublicationPanel project={project} save={save} action={action} busy={busy} />
                )}
              </div>
            </ContentDraftContext.Provider>
          </main>
        </div>
      )}
    </div>
  );
}

function Overview({
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
  const [draft, setDraft] = useState(project);
  const dirty = JSON.stringify(draft) !== JSON.stringify(project);
  useUnsavedForm(dirty);
  const steps = [
    { label: "记录原始资料与适用范围", complete: project.evidence.length > 0 },
    {
      label: "建立模型与情景，或组织专题页面",
      complete: !!project.model || !!project.pages?.length,
    },
    { label: "绑定文章判断与计算结果", complete: project.claims.length > 0 },
    { label: "保存发布快照与项目归档", complete: project.releases.length > 0 },
    { label: "记录作品表现与制作投入", complete: project.publications.length > 0 },
  ];
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">从一个好问题开始</p>
          <h2>这期内容，想回答什么？</h2>
          <p>将问题、假设和读者写清楚，让后续的资料与计算围绕它展开。</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(() => save(draft));
        }}
      >
        <fieldset className="content-stack" disabled={busy}>
          <Field label="选题名称">
            <Input
              value={draft.title}
              maxLength={200}
              required
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="核心问题">
            <Textarea
              value={draft.question}
              rows={3}
              maxLength={2000}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            />
          </Field>
          <Field label="目标读者">
            <Input
              value={draft.audience}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
            />
          </Field>
          <Field label="想验证的假设">
            <Textarea
              value={draft.hypothesis}
              maxLength={2000}
              rows={3}
              onChange={(e) => setDraft({ ...draft, hypothesis: e.target.value })}
            />
          </Field>
          <Field label="创作阶段">
            <Select
              value={draft.status}
              onChange={(e) =>
                setDraft({ ...draft, status: e.target.value as ContentProject["status"] })
              }
            >
              <option value="research">研究中</option>
              <option value="writing">写作中</option>
              <option value="ready">待发布</option>
              <option value="published">已发布</option>
            </Select>
          </Field>
          <div className="content-form-actions">
            <span>{dirty ? "有未保存的修改" : "项目已保存"}</span>
            {dirty && (
              <Button type="button" onClick={() => setDraft(project)}>
                撤销修改
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!dirty}>
              保存选题
            </Button>
          </div>
        </fieldset>
      </form>
      <ol className="content-checklist">
        {steps.map((step) => (
          <li key={step.label}>
            {step.complete ? <Check size={18} /> : <Circle size={18} />}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
