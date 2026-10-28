import { useMemo, useState } from "react";
import { ArrowDownToLine, Check, Link2, ListFilter, Search } from "lucide-react";
import { Button, Dialog, Input, Select } from "@bcr/react";
import type { EconomicRepository } from "@bcr/market-data/economy";
import type { ResearchState } from "./state";
import { RESEARCH_PRESETS } from "./presets";

export function ResearchToolbar({
  repository,
  state,
  cutoff,
  onUpdate,
  onExport,
  onLibrary,
  onShare,
  copied,
}: {
  repository: EconomicRepository;
  state: ResearchState;
  cutoff: string;
  onUpdate: (patch: Partial<ResearchState>) => void;
  onExport: () => void;
  onLibrary: () => void;
  onShare: () => void;
  copied: boolean;
}) {
  const [choosing, setChoosing] = useState(false),
    [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      repository.countries
        .filter((item) =>
          `${item.id} ${item.name} ${item.englishName}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(state.countries.includes(b.id)) - Number(state.countries.includes(a.id)) ||
            a.name.localeCompare(b.name, "zh-CN"),
        ),
    [repository, query, state.countries],
  );
  return (
    <>
      <header className="research-heading">
        <div>
          <span className="research-eyebrow">ECONOMIC OBSERVATORY</span>
          <h1>
            宏观研究工作台<span>One shared perspective</span>
          </h1>
        </div>
        <div className="research-heading-actions">
          <Button onClick={onLibrary}>
            <ListFilter size={14} />
            指标与钉选
          </Button>
          <Button variant="ghost" onClick={onShare} aria-label="复制宏观工作台链接">
            {copied ? <Check size={14} /> : <Link2 size={14} />}
          </Button>
          <Button variant="ghost" onClick={onExport}>
            <ArrowDownToLine size={14} />
            导出面板 CSV
          </Button>
        </div>
      </header>
      <div className="research-controls" aria-label="统一研究条件">
        <Button onClick={() => setChoosing(true)} aria-label="选择研究经济体">
          经济体 {state.countries.length}
          <span className="research-selection-summary">
            {state.countries
              .map((id) => repository.countries.find((country) => country.id === id)?.name ?? id)
              .join(" · ")}
          </span>
        </Button>
        <label>
          聚焦
          <Select
            aria-label="聚焦经济体"
            value={state.focus ?? ""}
            onChange={(event) => onUpdate({ focus: event.target.value || null })}
          >
            <option value="">全部比较</option>
            {state.countries.map((id) => (
              <option key={id} value={id}>
                {repository.countries.find((item) => item.id === id)?.name ?? id}
              </option>
            ))}
          </Select>
        </label>
        <label>
          从
          <Input
            aria-label="研究起始日期"
            type="date"
            value={state.from}
            min={repository.minDate}
            max={state.to}
            onChange={(event) => {
              if (event.target.value) onUpdate({ from: event.target.value });
            }}
          />
        </label>
        <label>
          至
          <Input
            aria-label="研究结束日期"
            type="date"
            value={state.to}
            min={state.from}
            max={repository.maxDate}
            onChange={(event) => {
              if (event.target.value) onUpdate({ to: event.target.value });
            }}
          />
        </label>
        <label>
          观察
          <Select
            aria-label="统一观察方式"
            value={state.asOf}
            onChange={(event) => onUpdate({ asOf: event.target.value as ResearchState["asOf"] })}
          >
            <option value="latest">窗口内最新</option>
            <option value="date">指定历史日期</option>
          </Select>
        </label>
        {state.asOf === "date" && (
          <Input
            aria-label="统一观察日期"
            type="date"
            min={repository.minDate}
            max={state.to}
            value={state.date}
            onChange={(event) => {
              if (event.target.value) onUpdate({ date: event.target.value });
            }}
          />
        )}
      </div>
      <div className="research-status">
        <span>
          <i />
          内置官方资源
        </span>
        <span>共同截止 {cutoff}</span>
        <span>频率与实际期次分别保留</span>
        <span>抓取 {repository.fetchedAt.slice(0, 10)}</span>
      </div>
      <nav className="research-presets" aria-label="宏观研究主题">
        {RESEARCH_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="ghost"
            size="sm"
            aria-pressed={preset.id === state.preset}
            onClick={() => onUpdate({ preset: preset.id })}
          >
            {preset.name}
          </Button>
        ))}
      </nav>
      <Dialog
        title="选择研究经济体"
        open={choosing}
        onClose={() => setChoosing(false)}
        className="research-country-dialog"
      >
        <p className="research-caption">
          最多同时比较 6 个经济体。未收录的月、季度指标保留空缺，年度背景仍可查看。
        </p>
        <label className="research-search">
          <Search size={15} />
          <Input
            aria-label="搜索研究经济体"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="国家、地区或 ISO 代码"
          />
        </label>
        <div className="research-country-list">
          {visible.map((country) => {
            const selected = state.countries.includes(country.id);
            return (
              <button
                key={country.id}
                type="button"
                aria-pressed={selected}
                disabled={!selected && state.countries.length >= 6}
                onClick={() => {
                  const countries = selected
                    ? state.countries.filter((id) => id !== country.id)
                    : [...state.countries, country.id];
                  onUpdate({
                    countries,
                    focus: countries.includes(state.focus ?? "")
                      ? state.focus
                      : (countries[0] ?? null),
                  });
                }}
              >
                <strong>
                  {country.name}
                  <small>
                    {country.englishName} · {country.id}
                  </small>
                </strong>
                {selected ? <Check size={16} /> : "+"}
              </button>
            );
          })}
        </div>
        <Button variant="primary" onClick={() => setChoosing(false)}>
          完成经济体选择
        </Button>
      </Dialog>
    </>
  );
}
