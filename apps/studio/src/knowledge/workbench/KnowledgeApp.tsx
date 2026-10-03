import { Button, Dialog, IconButton } from "@bcr/react";
import { Plus, Search, X } from "lucide-react";
import { type CSSProperties } from "react";
import { KNOWLEDGE_PATH } from "../../shell/host-manifests";
import { assessExcerpt } from "../../research";
import { NoteEditor } from "../editor/NoteEditor";
import { KnowledgeSyncPanel } from "../sync/KnowledgeSyncPanel";
import { KnowledgeHistory } from "../storage/KnowledgeHistory";
import { ConflictList, type ConflictChoice } from "../sync/conflicts";
import "../editor/fonts.scss";
import "../knowledge.css";
import "./workbench.css";
import { noteSearchHit } from "../search/retrieval";
import { KnowledgeRestorePanel } from "../storage/KnowledgeRestorePanel";
import { setContext, setContextWidth } from "./workbench";
import { KnowledgeBootError, KnowledgeBootShell } from "./KnowledgeBoot";
import { NoteSwitcher } from "./NoteSwitcher";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { TreeMenu } from "./TreeMenu";
import { notePath, pathKey } from "../notes/paths";
import { NoteMove } from "./NoteMove";
import "./paths.css";
import "./resource-layout.css";
import "./mobile.css";
import { useKnowledgeWorkbench } from "./useKnowledgeWorkbench";
import { KnowledgeToolbar } from "./KnowledgeToolbar";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
export function KnowledgeApp() {
  const controller = useKnowledgeWorkbench();
  const {
    services,
    mobile,
    active,
    navigate,
    store,
    state,
    ready,
    setReady,
    error,
    setError,
    message,
    setMessage,
    busy,
    setCollection,
    panel,
    setPanel,
    drawer,
    setDrawer,
    focusMode,
    setFocusMode,
    token,
    auto,
    setAuto,
    collectionName,
    setCollectionName,
    addingCollection,
    setAddingCollection,
    confirmDelete,
    setConfirmDelete,
    treeMenu,
    setTreeMenu,
    folderDelete,
    setFolderDelete,
    moveTarget,
    setMoveTarget,
    sessions,
    switcher,
    setSwitcher,
    target,
    setTarget,
    editor,
    input,
    toolbarSlot,
    content,
    scrollPositions,
    notes,
    note,
    workbench,
    sidebar,
    backlinks,
    run,
    select,
    flushEditor,
    removeFolder,
    treeItems,
    create,
    openLink,
    syncing,
    locked,
    paletteActions,
  } = controller;
  if (!ready)
    return error ? (
      <KnowledgeBootError
        error={error}
        onRetry={() => {
          setError("");
          setReady(false);
          void store.retryInitialization().then(
            () => setReady(true),
            (reason) => setError(String(reason)),
          );
        }}
      />
    ) : (
      <KnowledgeBootShell />
    );
  return (
    <div
      className={`knowledge-app ${drawer ? "show-sidebar" : ""}`}
      data-sidebar={sidebar}
      data-context={workbench.state.context}
      data-focus-mode={focusMode ? "on" : undefined}
      style={
        {
          "--w-sidebar-override":
            workbench.state.sidebarWidth === null ? undefined : `${workbench.state.sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <KnowledgeToolbar controller={controller} />
      <div className="knowledge-layout">
        <NoteSwitcher
          open={switcher !== null}
          notes={notes}
          initialQuery={switcher?.query ?? ""}
          onClose={() => setSwitcher(null)}
          onSelect={async (id) => {
            await select(id, true);
            const hit = noteSearchHit(store.getSnapshot().notes[id]!, switcher?.query ?? "");
            setTarget((old) => ({
              id,
              heading: switcher?.heading ?? "",
              offset: hit.match?.start ?? 0,
              sequence: (old?.sequence ?? 0) + 1,
            }));
          }}
          onCreate={create}
          actions={paletteActions}
        />
        <KnowledgeDialog
          open={addingCollection}
          title="新建集合"
          onClose={() => setAddingCollection(false)}
        >
          <form
            className="knowledge-add-collection"
            onSubmit={(event) => {
              event.preventDefault();
              if (collectionName.trim())
                void run(async () => {
                  const id = crypto.randomUUID();
                  await store.saveCollection(id, collectionName);
                  setCollectionName("");
                  setAddingCollection(false);
                  setCollection(id);
                });
            }}
          >
            <input
              autoFocus
              aria-label="新知识集合名称"
              placeholder="集合名称"
              maxLength={200}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
            />
            <Button type="submit" disabled={busy || !collectionName.trim()}>
              创建集合
            </Button>
          </form>
        </KnowledgeDialog>
        {mobile ? (
          <Dialog
            open={drawer && !focusMode}
            onClose={() => setDrawer(false)}
            title="笔记库"
            closeLabel="收起列表"
            placement="sheet"
            className="knowledge-library-sheet"
          >
            <KnowledgeSidebar controller={controller} />
            {treeMenu && (
              <TreeMenu
                x={treeMenu.x}
                y={treeMenu.y}
                items={treeItems(treeMenu.target)}
                onClose={() => setTreeMenu(null)}
              />
            )}
          </Dialog>
        ) : (
          <KnowledgeSidebar controller={controller} />
        )}
        <main className="knowledge-main">
          <NoteMove
            open={moveTarget !== null}
            target={moveTarget}
            store={store}
            flush={flushEditor}
            onClose={() => setMoveTarget(null)}
          />
          <KnowledgeDialog
            open={confirmDelete !== null}
            title="删除笔记"
            onClose={() => setConfirmDelete(null)}
            error={error}
          >
            <p>
              删除「{state.notes[confirmDelete ?? ""]?.title || "未命名笔记"}
              」？之后仍可从版本历史恢复。
            </p>
            <div className="knowledge-dialog-actions">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                disabled={busy || locked}
                onClick={() =>
                  void run(async () => {
                    const id = confirmDelete;
                    if (!id) return;
                    await flushEditor();
                    await store.deleteNote(id);
                    await navigate({ to: KNOWLEDGE_PATH, search: {} });
                    setConfirmDelete(null);
                  })
                }
              >
                确认删除笔记
              </Button>
            </div>
          </KnowledgeDialog>
          <KnowledgeDialog
            open={folderDelete !== null}
            title="删除目录"
            onClose={() => setFolderDelete(null)}
            error={error}
          >
            <p>
              删除「{folderDelete ?? ""}」？其中的{" "}
              {
                notes.filter((item) =>
                  pathKey(notePath(item)).startsWith(`${pathKey(folderDelete ?? "\u0000")}/`),
                ).length
              }{" "}
              篇笔记将移到库根并改写引用，子目录一并删除。
            </p>
            <div className="knowledge-dialog-actions">
              <Button variant="ghost" onClick={() => setFolderDelete(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  const path = folderDelete;
                  setFolderDelete(null);
                  if (path) void removeFolder(path);
                }}
              >
                确认删除目录
              </Button>
            </div>
          </KnowledgeDialog>
          {treeMenu && !mobile && (
            <TreeMenu
              x={treeMenu.x}
              y={treeMenu.y}
              items={treeItems(treeMenu.target)}
              onClose={() => setTreeMenu(null)}
            />
          )}
          {workbench.error && (
            <p role="status" className="knowledge-alert">
              {workbench.error}
            </p>
          )}
          {(message || error) && (
            <div
              role={error ? "alert" : "status"}
              className={`knowledge-notice ${error ? "is-error" : ""}`}
            >
              <span>{error || message}</span>
              <IconButton
                label="关闭提示"
                size="sm"
                onClick={() => {
                  setError("");
                  setMessage("");
                }}
              >
                <X size={15} />
              </IconButton>
            </div>
          )}
          <div
            className="knowledge-content"
            ref={content}
            onScroll={(event) => {
              if (!note) return;
              scrollPositions.current.set(note.id, event.currentTarget.scrollTop);
              if (scrollPositions.current.size > 100)
                scrollPositions.current.delete(scrollPositions.current.keys().next().value!);
            }}
          >
            <KnowledgeDialog
              open={active && panel === "sync"}
              title="同步设置"
              onClose={() => setPanel(null)}
              error={error}
            >
              <KnowledgeSyncPanel
                state={state}
                store={store}
                token={token}
                auto={auto}
                setAuto={setAuto}
                syncing={syncing}
                onError={setError}
                flush={flushEditor}
                onViewConflicts={() => setPanel("conflicts")}
              />
            </KnowledgeDialog>
            <KnowledgeDialog
              open={active && panel === "conflicts"}
              title="处理冲突"
              onClose={() => setPanel(null)}
              error={error}
            >
              <ConflictList
                conflicts={state.conflicts}
                busy={busy || syncing}
                onResolve={(conflict, choice: ConflictChoice, merged) =>
                  void run(async () => {
                    if (choice === "merge" && merged) {
                      // 「合并」是两步组合：正文取合并结果（restore 走历史可回滚），
                      // 标题与路径必须保留本机（改名/移动要走修改计划），故先 resolve 本机。
                      await store.resolve(conflict, "local");
                      await store.restore(merged);
                      setMessage("已合并双方正文改动；标题与路径保留本机，远端版本已存入历史");
                    } else {
                      await store.resolve(conflict, choice === "remote" ? "remote" : "local");
                      setMessage(
                        choice === "remote"
                          ? "已采用远端版本；本机版本已存入历史"
                          : "已采用本机版本；远端版本已存入历史",
                      );
                    }
                  })
                }
              />
            </KnowledgeDialog>
            <KnowledgeDialog
              open={active && panel === "restore"}
              title="恢复备份"
              onClose={() => setPanel(null)}
            >
              <KnowledgeRestorePanel
                store={store}
                flush={async () => {
                  await editor.current?.flush();
                }}
                onClose={() => setPanel(null)}
                onRestored={() => {
                  setPanel(null);
                  setMessage("备份已恢复到本机，未修改同步连接");
                }}
              />
            </KnowledgeDialog>
            <KnowledgeDialog
              open={active && panel === "history"}
              title="版本历史"
              onClose={() => setPanel(null)}
              error={error}
            >
              <KnowledgeHistory
                key={note?.id ?? "all"}
                state={state}
                note={note ?? null}
                token={token}
                onRestore={(n) =>
                  run(async () => {
                    await editor.current?.flush();
                    await store.restore(n);
                    await select(n.id, true);
                    setMessage("已恢复为当前笔记，旧版本仍保留在历史中");
                  })
                }
                onError={setError}
              />
            </KnowledgeDialog>
            {note ? (
              <>
                {locked && (
                  <div role="alert" className="knowledge-alert">
                    这篇笔记存在同步冲突，双方内容已保留。
                    <Button variant="ghost" size="sm" onClick={() => setPanel("conflicts")}>
                      处理冲突
                    </Button>
                  </div>
                )}
                <NoteEditor
                  key={note.id}
                  note={note}
                  store={store}
                  collections={Object.values(state.collections)}
                  locked={locked}
                  editorRef={editor}
                  sessions={sessions}
                  notes={notes}
                  backlinks={backlinks}
                  onOpenLink={(value) => void run(() => openLink(value))}
                  target={target}
                  focusMode={focusMode}
                  contextOpen={workbench.state.context === "expanded"}
                  onContextOpenChange={(open) => {
                    if (open) setFocusMode(false);
                    workbench.setState((current) =>
                      setContext(current, open ? "expanded" : "hidden"),
                    );
                  }}
                  contextWidth={workbench.state.contextWidth}
                  onContextWidthChange={(width) =>
                    workbench.setState((current) => setContextWidth(current, width))
                  }
                  toolbarSlot={toolbarSlot}
                />
                {note.citations.length > 0 && (
                  <section className="knowledge-citations">
                    <h2>
                      来源与引用 <span>{note.citations.length}</span>
                    </h2>
                    <p>引用快照随笔记同步。回到原文需要当前设备已有对应资料。</p>
                    {note.citations.map((citation, index) => {
                      const status = assessExcerpt(citation, services.search);
                      return (
                        <details key={`${citation.id}:${index}`}>
                          <summary>
                            {citation.title} <span>{status.label}</span>
                          </summary>
                          <blockquote>{citation.text}</blockquote>
                          <a href={status.route}>回到原文 ↗</a>
                        </details>
                      );
                    })}
                  </section>
                )}
              </>
            ) : (
              <section className="knowledge-empty">
                {notes.length ? (
                  <>
                    <h2>没有打开的笔记。</h2>
                    <p>
                      {mobile
                        ? "从笔记库选择一篇继续，也可以搜索或新建笔记。"
                        : "在左侧列表选择一篇开始，或按 ⌘/Ctrl K 搜索、新建。"}
                    </p>
                    <Button variant="ghost" onClick={() => setSwitcher({ query: "" })}>
                      <Search size={15} />
                      打开命令面板
                    </Button>
                  </>
                ) : (
                  <>
                    <h2>
                      把想法写下来，
                      <br />
                      让知识慢慢生长。
                    </h2>
                    <p>内容保存在本机，连接私有仓库后在设备间同步。</p>
                    <div className="knowledge-empty-actions">
                      <Button variant="primary" disabled={busy} onClick={() => void run(create)}>
                        <Plus size={16} />
                        写第一篇笔记
                      </Button>
                      <Button variant="ghost" onClick={() => input.current?.click()}>
                        导入 Markdown
                      </Button>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
