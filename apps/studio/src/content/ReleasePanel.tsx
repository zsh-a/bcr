import { Button } from "@bcr/react";
import type { ContentProject } from "./model";
import type { ContentStore } from "./store";
import type { KnowledgeStore } from "../knowledge/session/store";
import type { RunAction } from "./forms";
import { publishSnapshot } from "./service";

export function ReleasePanel({
  project,
  store,
  knowledge,
  action,
  busy,
}: {
  project: ContentProject;
  store: ContentStore;
  knowledge: KnowledgeStore;
  action: RunAction;
  busy: boolean;
}) {
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">固定这一刻的作品</p>
          <h2>发布与归档</h2>
          <p>快照保存当时的文稿、证据、参数、模板与字体。后续编辑产生新的版本。</p>
        </div>
        <Button
          variant="primary"
          disabled={busy || (!project.noteId && !project.pages?.length)}
          onClick={() =>
            action(async () => {
              await publishSnapshot(store, knowledge, project);
            })
          }
        >
          生成发布快照
        </Button>
      </div>
      <div className="content-deliverables">
        <article>
          <span className="content-eyebrow">给发布平台</span>
          <h3>图文发布包</h3>
          <p>标题、正文、封面、SVG / PNG 配图、来源说明与精确计算结果。</p>
          <small>在下方选定快照导出。</small>
        </article>
        <article>
          <span className="content-eyebrow">给未来的自己</span>
          <h3>可恢复项目归档</h3>
          <p>当前项目、文稿、全部发布快照和它们依赖的原始素材、字体。</p>
          <Button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const [{ exportArchive }, { download, fileTitle }] = await Promise.all([
                  import("./archive"),
                  import("./export"),
                ]);
                download(
                  await exportArchive(store, knowledge, project),
                  `${fileTitle(project.title)}.bcr-content.zip`,
                );
              })
            }
          >
            导出项目归档
          </Button>
        </article>
      </div>
      <div className="content-stack">
        {[...project.releases].reverse().map((id, reversed) => (
          <article className="content-release" key={id}>
            <div>
              <span className="content-eyebrow">发布快照 {project.releases.length - reversed}</span>
              <h3>版本 {project.releases.length - reversed}</h3>
              <small>{id}</small>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const { download, fileTitle, publishingPackage } = await import("./export");
                  const release = await store.release(id);
                  download(
                    await publishingPackage(release, store.assets),
                    `${fileTitle(release.article?.title ?? release.project.title)}-v${project.releases.length - reversed}.zip`,
                  );
                })
              }
            >
              下载发布包
            </Button>
          </article>
        ))}
      </div>
      {!project.releases.length && (
        <div className="content-empty">
          <h3>完成复核后，保存第一个版本</h3>
          <p>即使价格或文章后来发生变化，这个版本仍保留发布时的依据。</p>
        </div>
      )}
    </div>
  );
}
