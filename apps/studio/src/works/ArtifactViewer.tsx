import { useEffect, useState } from "react";
import { Button, Dialog } from "@bcr/react";
import type { Job } from "@bcr/work-core";
import type { WorkService } from "./service";

/** Outputs are immutable delivery artifacts, independent of the live preview and job logs. */
export function ArtifactViewer({
  service,
  sourceId,
  job,
  name,
  close,
}: {
  service: WorkService;
  sourceId: string;
  job: Job;
  name: string;
  close: () => void;
}) {
  const [content, setContent] = useState<{ url: string; text?: string }>();
  const [error, setError] = useState("");
  const output = job.outputs.find((o) => o.name === name);
  const text = /\.(json|txt|md|csv|srt|vtt)$/iu.test(name);
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    setContent(undefined);
    setError("");
    void (async () => {
      try {
        const blob = await service.output(sourceId, job.id, name, abort.signal);
        const body = text && blob.size <= 65536 ? await blob.text() : undefined;
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setContent({ url, ...(body !== undefined ? { text: body } : {}) });
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      }
    })();
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [service, sourceId, job.id, name, text]);
  return (
    <Dialog open onClose={close} title={name} className="works-artifact">
      <p className="works-footnote">
        {job.request.target} · 版本 {job.request.revision.slice(0, 8)} · 任务 {job.id.slice(0, 8)}
      </p>
      {error ? (
        <p role="alert" className="works-error">
          {error}
        </p>
      ) : !content ? (
        <p role="status">正在读取产物…</p>
      ) : content.text !== undefined ? (
        <pre className="works-artifact-text">{content.text}</pre>
      ) : /\.png$/iu.test(name) ? (
        <img src={content.url} alt={`${job.request.target} 导出关键帧`} />
      ) : /\.mp4$/iu.test(name) ? (
        <video src={content.url} controls playsInline aria-label="导出视频" />
      ) : (
        <p>此文件可下载查看。</p>
      )}
      {output && (
        <details>
          <summary>产物信息</summary>
          <p>{output.size.toLocaleString()} 字节</p>
          <code>SHA-256 {output.hash}</code>
          <p>来源 {sourceId}</p>
          <code>{job.request.revision}</code>
        </details>
      )}
      {content && (
        <a className="works-artifact-download" href={content.url} download={name}>
          下载 {name}
        </a>
      )}
      <Button variant="ghost" onClick={close}>
        关闭产物
      </Button>
    </Dialog>
  );
}
