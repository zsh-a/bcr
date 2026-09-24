import { useMemo, useState } from "react";
import { Button } from "@bcr/react";
import { Upload } from "lucide-react";
import { contentOf, type KnowledgeContent } from "./model";
import { planKnowledgeRestore, readKnowledgeBackup, type RestoreMode } from "./backup";
import type { KnowledgeStore } from "./store";

export function KnowledgeRestorePanel({
  store,
  flush,
  onRestored,
  onClose,
}: {
  store: KnowledgeStore;
  flush: () => Promise<void>;
  onRestored: () => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<{
    filename: string;
    base: KnowledgeContent;
    incoming: KnowledgeContent;
  } | null>(null);
  const [mode, setMode] = useState<RestoreMode>("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => {
    if (!source) return { plan: null, error: "" };
    try {
      return { plan: planKnowledgeRestore(source.base, source.incoming, mode), error: "" };
    } catch (reason) {
      return { plan: null, error: String(reason) };
    }
  }, [source, mode]);

  async function select(file: File) {
    setBusy(true);
    setError("");
    setSource(null);
    try {
      const incoming = await readKnowledgeBackup(file);
      await flush();
      setSource({ filename: file.name, base: contentOf(store.getSnapshot()), incoming });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!source || !preview.plan || busy) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      await store.restoreBackup(preview.plan.content, source.base);
      setSource(null);
      onRestored();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-panel" aria-label="恢复知识库备份" aria-busy={busy}>
      <header>
        <Upload size={18} />
        <h2>恢复知识库备份</h2>
      </header>
      <p>
        选择本应用导出的
        ZIP，先检查笔记、集合和引用，再确认写入。不会删除备份之外的本机笔记，也不会恢复密钥或同步连接。
      </p>
      <label>
        知识库 ZIP 文件
        <input
          type="file"
          className="ui-input"
          accept=".zip,application/zip"
          aria-label="选择知识库备份"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void select(file);
          }}
        />
      </label>
      {busy && <p role="status">正在处理备份，请稍候…</p>}
      {source && (
        <>
          <p>
            {source.filename} · {Object.keys(source.incoming.notes).length} 篇笔记 ·{" "}
            {Object.keys(source.incoming.collections).length} 个集合
          </p>
          <fieldset disabled={busy} className="knowledge-restore-options">
            <legend>同一 ID 的内容已存在时</legend>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={mode === "skip"}
                onChange={() => setMode("skip")}
              />
              保留本机，只添加缺少的内容
            </label>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={mode === "both"}
                onChange={() => setMode("both")}
              />
              保留双方，将不同内容恢复为副本
            </label>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              使用备份版本替换同 ID 的内容
            </label>
          </fieldset>
          {preview.plan && (
            <p role="status">
              将新增 {preview.plan.added} 篇、创建 {preview.plan.copied} 篇副本、替换{" "}
              {preview.plan.replaced} 篇、跳过 {preview.plan.skipped} 篇笔记。
            </p>
          )}
          {mode === "replace" && (
            <p className="knowledge-small">
              替换会修改现有笔记及同 ID
              集合。笔记旧版本按现有历史保留策略保存；建议先导出当前知识库。
            </p>
          )}
        </>
      )}
      {(error || preview.error) && (
        <p role="alert" className="knowledge-alert">
          {error || preview.error}
        </p>
      )}
      <div className="knowledge-panel-actions">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          取消恢复
        </Button>
        <Button variant="primary" disabled={busy || !preview.plan} onClick={() => void restore()}>
          确认恢复
        </Button>
      </div>
    </section>
  );
}
