import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRuntime, useNavigation } from "@bcr/react";
import { workspaceServices } from "../workspace";
import { claimStatus, evidenceSource, runModel, projectOutputs } from "./model";
import { parseVisualUrl } from "./links";
import { ChartPreview } from "./ChartPreview";

function useProjects() {
  const runtime = useRuntime();
  const store = useMemo(() => workspaceServices(runtime).content, [runtime]);
  const projects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void store.ready.catch((e: unknown) => {
      if (live) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      live = false;
    };
  }, [store]);
  return { projects, error };
}
export function ContentVisualImage({ url, alt }: { url: string; alt?: string | undefined }) {
  const { projects, error } = useProjects();
  const target = parseVisualUrl(url),
    project = projects.find((p) => p.id === target?.project),
    spec = target && project?.visuals[target.index];
  if (error || !project || !spec)
    return <span role="status">{error || `${alt || "图表"}：内容项目尚未加载或已缺失`}</span>;
  return (
    <ChartPreview
      spec={{ ...spec, source: spec.source || evidenceSource(project) }}
      result={runModel(project).result}
    />
  );
}
export function ContentNoteStatus({ noteId, body }: { noteId: string; body: string }) {
  const { projects } = useProjects(),
    navigation = useNavigation();
  const linked = projects.filter((p) => p.noteId === noteId);
  if (!linked.length) return null;
  return (
    <aside
      aria-label="内容项目复核"
      style={{ padding: "12px 20px", borderBlockEnd: "1px solid var(--color-border)" }}
    >
      {linked.map((p) => {
        const run = projectOutputs(p),
          pending = p.claims.filter((c) => claimStatus(c, body, run) !== "current");
        return (
          <div key={p.id}>
            <button
              className="ui-button"
              onClick={() => navigation.navigate(`/content?project=${p.id}`)}
            >
              {p.title} ↗
            </button>
            <span
              role="status"
              style={{
                marginInlineStart: 12,
                color: pending.length ? "var(--color-amber)" : "var(--color-muted)",
              }}
            >
              {pending.length
                ? `${pending.length} 项判断需要复核`
                : p.claims.length
                  ? "模型绑定已复核"
                  : "尚未绑定模型输出"}
            </span>
          </div>
        );
      })}
    </aside>
  );
}
