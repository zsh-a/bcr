import { useEffect, useRef, useState } from "react";
import type { ResearchLibrary, ResearchStore } from "../research";
import {
  PACKAGE_LIMIT,
  previewResearchPackageImport,
  planResearchPackage,
  createResearchPackage,
  inspectResearchPackage,
  restoreResearchPackage,
  type ResearchPackagePlan,
  type PreparedResearchPackage,
} from "../researchPackage";
const button =
  "rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
export function ResearchPackagePanel(props: {
  readonly library: ResearchLibrary;
  readonly store: ResearchStore;
  readonly busy: boolean;
  readonly run: (action: () => Promise<void>) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [drafts, setDrafts] = useState(false);
  const [plan, setPlan] = useState<ResearchPackagePlan>(),
    [prepared, setPrepared] = useState<PreparedResearchPackage>();
  const [importSummary, setImportSummary] = useState("");
  const [working, setWorking] = useState(false),
    [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const action = (
    work: (signal: AbortSignal, report: (message: string) => void) => Promise<() => void>,
  ) => {
    if (props.busy || active.current) return;
    const task = new AbortController();
    active.current = task;
    setWorking(true);
    setMessage("正在处理资料包…");
    const current = () => active.current === task && !task.signal.aborted;
    const report = (message: string) => {
      if (current()) setMessage(message);
    };
    void work(task.signal, report)
      .then((publish) => {
        if (current()) publish();
      })
      .catch((error: unknown) => {
        if (current()) setMessage(String(error));
      })
      .finally(() => {
        if (active.current === task) {
          active.current = null;
          setWorking(false);
        }
      });
  };
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setWorking(false);
    setMessage("已取消资料包操作，可以重新检查或选择文件。");
  };
  const disabled = props.busy || working;
  return (
    <details className="my-2 rounded border border-border p-3 text-[11px] text-muted">
      <summary className="cursor-pointer text-text">Reader 完整资料包</summary>
      <p className="my-2 leading-5">
        包含所选集合及关联的 Reader 源文件、章节快照。请先
        <a className="text-accent underline" href="/reader">
          打开 Reader
        </a>
        并等待书库加载。其它类型和无法提供的历史版本会在预览中标明。
      </p>
      <div className="max-h-32 space-y-1 overflow-auto">
        {props.library.collections.map((item) => (
          <label key={item.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`打包集合：${item.name}`}
              checked={selected.includes(item.id)}
              disabled={disabled}
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                );
                setPlan(undefined);
              }}
            />
            {item.name} · {item.excerpts.length} 条摘录
          </label>
        ))}
      </div>
      <label className="my-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={drafts}
          disabled={disabled}
          onChange={(event) => {
            setDrafts(event.target.checked);
            setPlan(undefined);
          }}
        />
        资料包包含草稿
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={disabled || !selected.length}
          onClick={() =>
            action(async (signal, report) => {
              setPrepared(undefined);
              setPlan(undefined);
              const checked = await planResearchPackage(
                {
                  ...props.library,
                  collections: props.library.collections.filter((item) =>
                    selected.includes(item.id),
                  ),
                },
                drafts,
                report,
                signal,
              );
              return () => {
                setPlan(checked);
                setMessage("");
              };
            })
          }
        >
          检查资料包
        </button>
        <label>
          选择 Reader 资料包
          <input
            aria-label="选择 Reader 资料包"
            type="file"
            accept=".zip,application/zip"
            disabled={disabled}
            className="mt-1 block max-w-full"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setPlan(undefined);
              setPrepared(undefined);
              action(async (signal, report) => {
                if (file.size > PACKAGE_LIMIT + 65536) throw new Error("资料包超过 600 MiB 上限");
                const checked = await inspectResearchPackage(file, report, signal);
                const preview = await previewResearchPackageImport(checked, props.library);
                return () => {
                  setImportSummary(
                    `书籍：新增 ${preview.books.added}，复用 ${preview.books.reused}；集合：新增 ${preview.collections.added}，跳过 ${preview.collections.skipped}，冲突副本 ${preview.collections.copies}`,
                  );
                  setPrepared(checked);
                  setMessage("文件哈希与 Reader 源文件校验通过，请确认恢复。");
                };
              });
            }}
          />
        </label>
      </div>
      {working && (
        <div className="mt-3 flex items-center gap-3" aria-label="资料包任务进度">
          <progress aria-label="资料包处理进度" className="h-1 flex-1 accent-accent" />
          <button type="button" className={button} onClick={cancel}>
            取消资料包操作
          </button>
        </div>
      )}
      {plan && (
        <div aria-label="资料包导出预览" className="mt-3 space-y-2 border-t border-border pt-2">
          <p>
            {plan.backup.library.collections.length} 个集合 · {plan.books.length} 本 Reader 资料 ·
            预计源文件 {(plan.sourceBytes / 1024 / 1024).toFixed(2)} MiB（不含快照与容器开销）
          </p>
          <ul className="max-h-36 space-y-1 overflow-auto">
            {plan.references.map((item, i) => (
              <li key={i}>
                {item.label}：
                {
                  {
                    ready: "可打包当前版本",
                    missing: "来源或章节缺失，无法完整恢复",
                    unsupported: "暂不支持此来源类型",
                    historical: "仅提供当前资料，旧版本不可保证；回跳时重新核验",
                  }[item.state]
                }
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() =>
              action(async (signal, report) => {
                const blob = await createResearchPackage(plan, report, signal);
                return () => {
                  const url = URL.createObjectURL(blob),
                    anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "bcr-reader-research.zip";
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setMessage("Reader 资料包已生成，请保存下载文件。");
                };
              })
            }
          >
            生成并下载资料包
          </button>
        </div>
      )}
      {prepared && (
        <div aria-label="资料包恢复预览" className="mt-3 space-y-2 border-t border-border pt-2">
          <p>
            {prepared.backup.library.collections.length} 个集合 ·{" "}
            {prepared.reader.manifest.books.length} 本带源文件的 Reader
            资料。先恢复书籍，再合并集合；相同资料包可重复导入，冲突集合保留副本。
          </p>
          <p>{importSummary}</p>
          <p>已有书籍与笔记不覆盖。非 Reader 来源和未包含的历史版本仍需另行恢复。</p>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() =>
              props.run(async () => {
                await restoreResearchPackage(
                  prepared,
                  (change) => props.store.update(change),
                  setMessage,
                );
                setPrepared(undefined);
                setMessage("Reader 资料包恢复完成，可从集合回到原文。未包含的来源仍待恢复。");
              })
            }
          >
            确认恢复 Reader 资料包
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => setPrepared(undefined)}
          >
            取消资料包恢复
          </button>
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
