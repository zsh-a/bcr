import { useRef, useState } from "react";
import type { ResearchLibrary, ResearchStore } from "../research";
import {
  createResearchBackup,
  decodeResearchBackup,
  MAX_RESEARCH_BACKUP_BYTES,
  planResearchImport,
  type ResearchBackup,
} from "../researchBackup";

const button =
  "rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
export function ResearchBackupPanel(props: {
  readonly library: ResearchLibrary;
  readonly store: ResearchStore;
  readonly busy: boolean;
  readonly run: (action: () => Promise<void>) => void;
}) {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [backup, setBackup] = useState<ResearchBackup>();
  const [message, setMessage] = useState("");
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  const plan = backup ? planResearchImport(props.library, backup) : undefined;
  const download = () => {
    try {
      const result = createResearchBackup(props.library, includeDrafts, {
        getItem: (key) => window.localStorage.getItem(key),
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bcr-research-${new Date(result.createdAt).toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("备份已生成，请保留下载的 JSON 文件。");
    } catch (error) {
      setMessage(`备份失败：${String(error)}`);
    }
  };
  return (
    <details className="my-2 rounded border border-border p-3 text-[11px] text-muted">
      <summary className="cursor-pointer text-text focus-visible:outline-2 focus-visible:outline-accent">
        集合备份与恢复
      </summary>
      <p className="py-2 leading-5">
        备份全部集合、正文快照、已保存笔记与引用。不包含源文件；在新浏览器恢复后，回到原文仍需对应的本地资料。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeDrafts}
            onChange={(event) => setIncludeDrafts(event.target.checked)}
          />
          包含未保存草稿
        </label>
        <button
          type="button"
          className={button}
          disabled={props.busy || !props.library.collections.length}
          onClick={download}
        >
          下载集合备份
        </button>
        <label className="min-w-0">
          选择集合备份
          <input
            aria-label="选择集合备份"
            type="file"
            accept=".json,application/json"
            disabled={props.busy || reading}
            className="mt-1 block max-w-full text-[11px]"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const token = ++request.current;
              setBackup(undefined);
              setReading(true);
              setMessage("正在检查备份…");
              void (async () => {
                if (file.size > MAX_RESEARCH_BACKUP_BYTES)
                  throw new Error("集合备份超过 16 MiB 限制");
                const decoded = decodeResearchBackup(await file.text());
                if (request.current === token) {
                  setBackup(decoded);
                  setMessage("");
                }
              })()
                .catch((error: unknown) => {
                  if (request.current === token) setMessage(`无法导入：${String(error)}`);
                })
                .finally(() => {
                  if (request.current === token) setReading(false);
                });
            }}
          />
        </label>
      </div>
      {backup && plan && (
        <div className="mt-3 space-y-2 border-t border-border pt-3" aria-label="集合导入预览">
          <p>
            备份包含 {backup.library.collections.length} 个集合、
            {backup.library.collections.reduce((sum, item) => sum + item.excerpts.length, 0)}{" "}
            条摘录、
            {backup.library.collections.reduce(
              (sum, item) =>
                sum + item.excerpts.filter((entry) => entry.draft !== undefined).length,
              0,
            )}{" "}
            条草稿。
          </p>
          <p>
            新增 {plan.added} 个集合（其中冲突副本 {plan.copies} 个），跳过 {plan.skipped}{" "}
            个完全相同的集合。现有内容不会被覆盖。
          </p>
          <ul className="max-h-24 overflow-auto pl-4 list-disc">
            {backup.library.collections.map((item) => (
              <li key={item.id}>
                {item.name} · {item.excerpts.length} 条摘录
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={props.busy || !plan.added}
              onClick={() =>
                props.run(async () => {
                  await props.store.update(
                    (current) => planResearchImport(current, backup).library,
                  );
                  setBackup(undefined);
                  setMessage("集合已恢复。导入的草稿保持未保存状态，源文件需另行恢复。");
                })
              }
            >
              确认导入集合
            </button>
            <button
              type="button"
              className={button}
              disabled={props.busy}
              onClick={() => {
                request.current++;
                setBackup(undefined);
                setMessage("");
              }}
            >
              取消导入
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 whitespace-pre-wrap leading-5">
          {message}
        </p>
      )}
    </details>
  );
}
