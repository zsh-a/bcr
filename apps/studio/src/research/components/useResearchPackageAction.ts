import { useEffect, useRef, useState } from "react";
type PackageWork = (signal: AbortSignal, report: (message: string) => void) => Promise<() => void>;
interface Lifecycle {
  onFailure(): void;
  onCancel(): void;
  onFinish(): void;
}
export function useResearchPackageAction(blocked: boolean, lifecycle: Lifecycle) {
  const active = useRef<AbortController | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const action = (work: PackageWork) => {
    if (blocked || active.current) return;
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
        if (current()) {
          setMessage(
            error instanceof DOMException && error.name === "AbortError"
              ? "已取消文件选择或保存，可以重试。"
              : String(error),
          );
          lifecycle.onFailure();
        }
      })
      .finally(() => {
        if (active.current === task) {
          active.current = null;
          lifecycle.onFinish();
          setWorking(false);
        }
      });
  };
  const cancel = () => {
    lifecycle.onCancel();
    active.current?.abort();
    active.current = null;
    setWorking(false);
    setMessage("已取消资料包操作，可以重新检查或选择文件。");
  };
  return { action, cancel, working, message, setMessage };
}
