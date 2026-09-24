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
import "./app-update.css";

const UpdateContext = createContext<ReturnType<typeof createUpdateCoordinator> | null>(null);
type UpdateWindow = Window & { __bcrUpdateReady?: boolean };

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
  const [ready, setReady] = useState(
    () => typeof window !== "undefined" && (window as UpdateWindow).__bcrUpdateReady === true,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const announce = () => {
      setReady(true);
      setCollapsed(false);
      setError("");
    };
    window.addEventListener("bcr-update-ready", announce);
    if ((window as UpdateWindow).__bcrUpdateReady) announce();
    return () => window.removeEventListener("bcr-update-ready", announce);
  }, []);
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError("");
    try {
      await coordinator.apply(() => window.dispatchEvent(new Event("bcr-apply-update")));
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
      {ready && (
        <aside
          className={`bcr-update-notice${collapsed ? " is-collapsed" : ""}`}
          aria-label="应用更新"
        >
          {collapsed ? (
            <button type="button" onClick={() => setCollapsed(false)}>
              新版本可用 ↗
            </button>
          ) : (
            <>
              <div role="status">
                <strong>新版本已准备好</strong>
                <p>保存当前工作后刷新，继续使用新版本。</p>
              </div>
              {error && <p role="alert">{error}</p>}
              <div className="bcr-update-actions">
                <button type="button" disabled={applying} onClick={() => setCollapsed(true)}>
                  稍后
                </button>
                <button
                  className="is-primary"
                  type="button"
                  disabled={applying}
                  onClick={() => void apply()}
                >
                  {applying ? "正在保存并更新…" : "立即更新"}
                </button>
              </div>
            </>
          )}
        </aside>
      )}
    </UpdateContext.Provider>
  );
}
