import { createContext, useContext, useMemo } from "react";
import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react";
import { evaluateAnalysis } from "@bcr/economics-core/analysis";
import { formatDecimal } from "@bcr/economics-core";
import { renderAnalysisChart } from "@bcr/visual-renderer/analysis";
import { analysisRuns, type ContentProject, type AnalysisRun } from "../model";
import type { PageSpec } from "./model";
import { pageCatalog } from "./catalog";
import "./pages.css";

export type ParameterOverrides = Readonly<Record<string, Readonly<Record<string, string>>>>;
interface PageData {
  project: ContentProject;
  runs: readonly AnalysisRun[];
  savedRuns: readonly AnalysisRun[];
  overrides: ParameterOverrides;
  onParameter?: (model: string, parameter: string, value: string) => void;
  dark: boolean;
}
const Data = createContext<PageData | null>(null);
function useData() {
  const data = useContext(Data);
  if (!data) throw new Error("页面数据上下文缺失");
  return data;
}
function useRun(id: string) {
  const data = useData();
  const run = data.runs.find((r) => r.model.id === id);
  if (!run) throw new Error("页面模型缺失");
  return run;
}
const { registry } = defineRegistry(pageCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div className={`page-stack page-gap-${props.gap}`}>{children}</div>
    ),
    Columns: ({ props, children }) => (
      <div className={`page-columns page-columns-${props.columns}`}>{children}</div>
    ),
    Heading: ({ props }) =>
      props.level === 1 ? (
        <h1>{props.text}</h1>
      ) : props.level === 2 ? (
        <h2>{props.text}</h2>
      ) : (
        <h3>{props.text}</h3>
      ),
    Text: ({ props }) => {
      const data = useData(),
        run = data.savedRuns.find((r) => r.model.id === props.model);
      const review =
        props.model &&
        (props.reviewedRun !== run?.id ||
          Object.keys(data.overrides[props.model] ?? {}).length > 0);
      return (
        <div className="page-prose">
          {review && <span className="page-review">需要复核</span>}
          <p>{props.text}</p>
        </div>
      );
    },
    Metric: ({ props }) => {
      const run = useRun(props.model),
        value = run.result.rows.find((r) => r.id === (props.scenario ?? "base"))?.values[
          props.output
        ];
      return (
        <div className="page-metric">
          <span>{props.label}</span>
          <strong>{value === undefined ? "—" : formatDecimal(value)}</strong>
          <small>{run.result.columns.find((c) => c.id === props.output)?.unit}</small>
        </div>
      );
    },
    Parameter: ({ props }) => {
      const data = useData(),
        run = useRun(props.model),
        p = run.model.parameters.find((p) => p.id === props.parameter)!;
      const sweep = run.model.sweep?.parameter === p.id ? run.model.sweep : undefined;
      const value = data.overrides[props.model]?.[p.id] ?? p.value;
      return (
        <label className="page-parameter">
          <span>
            {p.label} <small>{p.unit}</small>
          </span>
          <input
            aria-label={p.label}
            inputMode="decimal"
            value={value}
            readOnly={!data.onParameter}
            onChange={(e) => data.onParameter?.(props.model, p.id, e.target.value)}
          />
          {sweep && data.onParameter && (
            <input
              aria-label={`${p.label}滑块`}
              type="range"
              min={sweep.from}
              max={sweep.to}
              step="any"
              value={Number(value)}
              onChange={(e) =>
                data.onParameter?.(
                  props.model,
                  p.id,
                  Number(e.target.value)
                    .toFixed(8)
                    .replace(/\.?0+$/u, ""),
                )
              }
            />
          )}
          <small>
            {p.provenance === "assumed"
              ? "自设假设"
              : p.provenance === "recorded"
                ? "实际记录"
                : "外部资料"}
          </small>
        </label>
      );
    },
    Chart: ({ props }) => {
      const run = useRun(props.model),
        data = useData();
      const svg = useMemo(
        () => renderAnalysisChart(run.result, props.outputs, props.kind, 900, 420, data.dark),
        [run.result, props.outputs, props.kind, data.dark],
      );
      return (
        <figure className="page-chart">
          <figcaption>{props.title}</figcaption>
          <div role="img" aria-label={props.title} dangerouslySetInnerHTML={{ __html: svg }} />
        </figure>
      );
    },
    Table: ({ props }) => {
      const run = useRun(props.model);
      return (
        <div className="page-table">
          <table>
            <thead>
              <tr>
                <th>情景</th>
                {props.outputs.map((id) => {
                  const c = run.result.columns.find((c) => c.id === id)!;
                  return (
                    <th key={id}>
                      {c.label}
                      <small>{c.unit}</small>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {run.result.rows.map((row) => (
                <tr key={row.id}>
                  <th>{row.label}</th>
                  {props.outputs.map((id) => (
                    <td key={id} title={row.values[id]}>
                      {formatDecimal(row.values[id]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <small>显示保留两位小数；导出数据保留计算精度。</small>
        </div>
      );
    },
    Sources: ({ props }) => {
      const { project } = useData();
      return (
        <footer className="page-sources">
          <h3>{props.title}</h3>
          {project.evidence.length ? (
            <ol>
              {project.evidence.map((e) => (
                <li key={e.id}>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                  ) : (
                    e.title
                  )}
                  <small>
                    {[
                      e.applicableDate || new Date(e.capturedAt).toISOString().slice(0, 10),
                      e.region,
                      e.store,
                      e.specification,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>尚未添加外部资料；示例参数均为自设假设。</p>
          )}
        </footer>
      );
    },
  },
});

export function PageView({
  project,
  page,
  overrides = {},
  onParameter,
}: {
  project: ContentProject;
  page: PageSpec;
  overrides?: ParameterOverrides;
  onParameter?: PageData["onParameter"];
}) {
  const savedRuns = useMemo(() => analysisRuns(project), [project]);
  const computed = useMemo(() => {
    try {
      return {
        runs: savedRuns.map((r) => ({
          ...r,
          result: evaluateAnalysis(r.model, overrides[r.model.id]),
        })),
        error: "",
      };
    } catch (error) {
      return { runs: savedRuns, error: error instanceof Error ? error.message : String(error) };
    }
  }, [savedRuns, overrides]);
  return (
    <article
      className={`content-page page-${page.theme} page-${page.layout}`}
      aria-label={page.title}
    >
      <div className="page-imprint">BCR / RESEARCH & CREATION</div>
      {computed.error && (
        <p role="alert" className="page-review">
          试算未生效：{computed.error}。下方仍展示已保存结果。
        </p>
      )}
      <Data.Provider
        value={{
          project,
          runs: computed.runs,
          savedRuns,
          overrides,
          ...(onParameter ? { onParameter } : {}),
          dark: page.theme === "night",
        }}
      >
        <JSONUIProvider registry={registry}>
          <Renderer
            spec={{
              root: page.root,
              elements: Object.fromEntries(
                Object.entries(page.elements).map(([id, b]) => [
                  id,
                  {
                    type: b.type,
                    props: b.props,
                    ...("children" in b && b.children ? { children: b.children } : {}),
                  },
                ]),
              ),
            }}
            registry={registry}
          />
        </JSONUIProvider>
      </Data.Provider>
    </article>
  );
}
