import { dateText } from "@bcr/market-data/research/model";
import { STRATEGIES, strategySpec } from "@bcr/quant-core";
import { Button, Dialog, Input, Select } from "@bcr/react";
import {
  Bookmark,
  ChevronDown,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { percent } from "../results/format";
import type { useResearch } from "../session/useResearch";
import { DEFAULT_EXPERIMENT_ID, experimentText } from "./model";

export function ResearchLibrary({
  research,
  busy,
  onClose,
}: {
  research: ReturnType<typeof useResearch>;
  busy: boolean;
  onClose: () => void;
}) {
  const { state } = research;
  const current = state.experiments.find((e) => e.id === state.experimentId)!;
  const [query, setQuery] = useState(""),
    [favorites, setFavorites] = useState(false);
  const [creation, setCreation] = useState<"project" | "experiment" | "rename" | null>(null),
    [name, setName] = useState("");
  const entries = [
    ...state.runs.map((run) => ({
      run,
      kind: "run" as const,
      label: STRATEGIES[strategySpec(run.config).id].title,
      metric: percent(run.metrics.totalReturn),
    })),
    ...state.grids.map((run) => ({
      run,
      kind: "grid" as const,
      label: "参数网格",
      metric: `${run.axes.length} 个参数`,
    })),
    ...state.studies.map((run) => ({
      run,
      kind: "study" as const,
      label: run.validationMode === "walk-forward" ? "连续样本外" : "稳健性验证",
      metric: run.validationMode === "cost" ? "成本压力" : "训练 / 测试 / 成本",
    })),
  ]
    .filter((e) => (e.run.experimentId ?? DEFAULT_EXPERIMENT_ID) === current.id)
    .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
  const experiments = state.experiments
    .filter(
      (e) =>
        e.projectId === current.projectId &&
        (!favorites || e.favorite) &&
        experimentText(e).includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.createdAt.localeCompare(b.createdAt),
    );
  const create = () => {
    if (!name.trim()) return;
    if (creation === "project") research.createProject(name);
    else if (creation === "rename") research.renameProject(current.projectId, name);
    else research.createExperiment(name, current.projectId);
    setName("");
    setCreation(null);
  };
  return (
    <aside className="research-library" aria-label="研究目录">
      <div className="research-library-heading">
        <strong>研究目录</strong>
        <Button variant="ghost" size="sm" aria-label="收起研究目录" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      <div className="research-library-project">
        <Select
          aria-label="研究项目"
          value={current.projectId}
          disabled={busy}
          onChange={(e) => {
            const experiment = state.experiments.find((x) => x.projectId === e.target.value);
            if (experiment) void research.selectExperiment(experiment.id);
          }}
        >
          {state.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          size="sm"
          aria-label="重命名项目"
          disabled={busy}
          onClick={() => {
            setName(state.projects.find((p) => p.id === current.projectId)!.name);
            setCreation("rename");
          }}
        >
          <Pencil size={13} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="新建项目"
          disabled={busy || !state.ready}
          onClick={() => {
            setName("");
            setCreation("project");
          }}
        >
          <FolderPlus size={15} />
        </Button>
      </div>
      <div className="research-library-search">
        <Search size={14} />
        <Input
          type="search"
          aria-label="搜索研究实验"
          placeholder="搜索实验、标签或备注"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="仅查看收藏实验"
          aria-pressed={favorites}
          onClick={() => setFavorites((v) => !v)}
        >
          <Star size={14} fill={favorites ? "currentColor" : "none"} />
        </Button>
      </div>
      <div className="research-library-section-title">
        <span>实验</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="新建实验"
          disabled={busy || !state.ready}
          onClick={() => {
            setName("");
            setCreation("experiment");
          }}
        >
          <Plus size={14} />
        </Button>
      </div>
      <div className="research-experiment-list">
        {experiments.map((experiment) => (
          <div key={experiment.id} data-selected={experiment.id === current.id}>
            <button
              type="button"
              disabled={busy || research.selecting}
              aria-pressed={experiment.id === current.id}
              onClick={() => void research.selectExperiment(experiment.id)}
            >
              <span>{experiment.name}</span>
              {experiment.tags.length > 0 && <small>{experiment.tags.join(" · ")}</small>}
            </button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${experiment.favorite ? "取消收藏" : "收藏实验"} ${experiment.name}`}
              onClick={() =>
                research.updateExperiment(experiment.id, { favorite: !experiment.favorite })
              }
            >
              <Star size={13} fill={experiment.favorite ? "currentColor" : "none"} />
            </Button>
          </div>
        ))}
        {!experiments.length && (
          <p className="research-help">
            没有匹配的实验。
            <button
              type="button"
              className="research-table-link"
              onClick={() => {
                setQuery("");
                setFavorites(false);
              }}
            >
              清除筛选
            </button>
          </p>
        )}
      </div>
      <details className="research-experiment-details" key={current.id}>
        <summary>
          实验信息
          <ChevronDown size={13} />
        </summary>
        <div>
          <label>
            名称
            <Input
              aria-label="实验名称"
              defaultValue={current.name}
              maxLength={120}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value) research.updateExperiment(current.id, { name: value });
                else e.target.value = current.name;
              }}
            />
          </label>
          <label>
            标签
            <Input
              aria-label="实验标签"
              defaultValue={current.tags.join(", ")}
              placeholder="逗号分隔"
              onBlur={(e) =>
                research.updateExperiment(current.id, {
                  tags: [
                    ...new Set(
                      e.target.value
                        .split(/[,，]/u)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ]
                    .slice(0, 20)
                    .map((t) => t.slice(0, 40)),
                })
              }
            />
          </label>
          <label>
            研究备注
            <textarea
              aria-label="研究备注"
              defaultValue={current.notes}
              maxLength={10000}
              placeholder="假设、观察和下一步"
              onBlur={(e) => research.updateExperiment(current.id, { notes: e.target.value })}
            />
          </label>
        </div>
      </details>
      <div className="research-library-section-title">
        <span>
          运行记录 <small>{entries.length}</small>
        </span>
      </div>
      <div className="research-library-entries">
        {entries.map(({ run, kind, label, metric }) => {
          const selected =
            kind === "run"
              ? state.selected?.run.id === run.id && state.view === "run"
              : kind === "grid"
                ? state.grid?.run.id === run.id
                : state.study?.run.id === run.id;
          const baseline = current.baselineId === run.id;
          return (
            <div
              key={`${kind}-${run.id}`}
              className="research-library-entry"
              data-selected={selected}
            >
              <button
                type="button"
                data-entry-id={run.id}
                data-entry-kind={kind}
                aria-label={`查看${label} ${new Date(run.createdAt).toLocaleString("zh-CN")}`}
                aria-pressed={selected}
                disabled={busy || research.selecting}
                onClick={() => void research.selectEntry(kind, run.id)}
              >
                <span>
                  {label}
                  {baseline && <small className="research-baseline-label">基线</small>}
                </span>
                <small>
                  {dateText(run.startDate)} — {dateText(run.endDate)}
                </small>
                <span>
                  <time>
                    {new Date(run.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <b>{metric}</b>
                </span>
              </button>
              <div>
                {kind === "run" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`${baseline ? "取消基线" : "设为基线"} ${run.id}`}
                    onClick={() =>
                      research.updateExperiment(current.id, {
                        baselineId: baseline ? null : run.id,
                      })
                    }
                  >
                    <Bookmark size={13} fill={baseline ? "currentColor" : "none"} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`移除研究记录 ${run.id}`}
                  onClick={() => research.forgetEntry(kind, run.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          );
        })}
        {!entries.length && (
          <div className="research-library-empty">
            <p>实验尚无运行</p>
            <small>回测、参数网格和验证结果都会保存在这里。</small>
          </div>
        )}
      </div>
      <Dialog
        open={creation !== null}
        onClose={() => setCreation(null)}
        title={
          creation === "project" ? "新建项目" : creation === "rename" ? "重命名项目" : "新建实验"
        }
        className="research-create-dialog"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label>
            {creation === "experiment" ? "实验名称" : "项目名称"}
            <Input
              autoFocus
              aria-label="研究名称"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div>
            <Button variant="ghost" onClick={() => setCreation(null)}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              {creation === "rename" ? "保存" : "创建"}
            </Button>
          </div>
        </form>
      </Dialog>
    </aside>
  );
}
