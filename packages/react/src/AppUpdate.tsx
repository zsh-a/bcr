import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createUpdateCoordinator, type UpdateParticipant } from "./updateCoordinator";
import {
  applyAppUpdate,
  checkForAppUpdate,
  setAppUpdateState,
  useAppUpdateState,
} from "./appUpdateState";
import "./app-update.css";

const UpdateContext = createContext<ReturnType<typeof createUpdateCoordinator> | null>(null);

export function useUpdateParticipant(participant: UpdateParticipant): void {
  const coordinator = useContext(UpdateContext);
  const latest = useRef(participant);
  useLayoutEffect(() => {
    latest.current = participant;
  });
  useLayoutEffect(
    () =>
      coordinator?.register({
        blocked: () => latest.current.blocked(),
        save: () => latest.current.save(),
      }),
    [coordinator],
  );
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [coordinator] = useState(createUpdateCoordinator);
  const update = useAppUpdateState();
  const [collapsed, setCollapsed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const announce = () => setAppUpdateState({ phase: "ready" });
    window.addEventListener("bcr-update-ready", announce);
    return () => window.removeEventListener("bcr-update-ready", announce);
  }, []);
  useEffect(() => {
    setCollapsed(false);
    setError("");
  }, [update]);
  useEffect(() => {
    if (update.phase !== "current") return;
    const timer = setTimeout(() => setAppUpdateState({ phase: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [update]);
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError("");
    try {
      await coordinator.apply(applyAppUpdate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setApplying(false);
    }
  };
  return (
    <UpdateContext.Provider value={coordinator}>
      <div className="bcr-update-content" inert={applying}>
        {children}
      </div>
      {update.phase === "current" && (
        <aside className="bcr-update-notice is-current" aria-label="应用更新" role="status">
          当前已是最新版本
        </aside>
      )}
      {update.phase !== "idle" && update.phase !== "unavailable" && update.phase !== "current" && (
        <aside
          className={`bcr-update-notice${collapsed ? " is-collapsed" : ""}`}
          aria-label="应用更新"
        >
          {collapsed ? (
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              onClick={() => setCollapsed(false)}
            >
              {update.phase === "ready" ? "新版本可用 ↗" : "查看更新状态 ↗"}
            </button>
          ) : (
            <>
              <div role="status">
                <strong>
                  {update.phase === "ready"
                    ? "新版本已准备好"
                    : update.phase === "checking"
                      ? "正在检查并准备更新…"
                      : update.phase === "reload"
                        ? "页面资源需要重新加载"
                        : "更新未完成"}
                </strong>
                <p>
                  {update.message ??
                    (update.phase === "ready" || update.phase === "reload"
                      ? "保存当前工作后刷新，继续使用。"
                      : update.phase === "checking"
                        ? "下载完成后即可更新，当前工作会保留。"
                        : "请联网后重试。")}
                </p>
              </div>
              {update.details && (
                <details className="bcr-update-details">
                  <summary>错误详情</summary>
                  <p>{update.details}</p>
                </details>
              )}
              {error && <p role="alert">{error}</p>}
              <div className="bcr-update-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-default"
                  disabled={applying}
                  onClick={() => setCollapsed(true)}
                >
                  稍后
                </button>
                <button
                  className="ui-btn ui-btn-primary"
                  type="button"
                  disabled={applying || update.phase === "checking"}
                  onClick={() => {
                    if (update.phase === "error") checkForAppUpdate();
                    else void apply();
                  }}
                >
                  {applying
                    ? "正在保存并更新…"
                    : update.phase === "ready"
                      ? "立即更新"
                      : update.phase === "reload"
                        ? "保存并重新加载"
                        : update.phase === "error"
                          ? "重试检查更新"
                          : "正在准备…"}
                </button>
              </div>
            </>
          )}
        </aside>
      )}
    </UpdateContext.Provider>
  );
}
