import {
  parseTrendResearchReview,
  researchParameterAxes,
  researchParameterSlice,
  type TrendResearchReview,
  type TrendResearchRow,
} from "@bcr/quant-core/trend";
import { Button, Select } from "@bcr/react";
import { useMemo, useRef, useState } from "react";
import { number } from "../results/evaluation";
import { parameterLabel, parameterValue } from "./labels";
import "./styles.css";

const pct = (value: number) => `${number(value * 100)}%`;
const roles: Record<string, string> = {
  development: "开发",
  validation: "验证",
  holdout: "留出",
  undeclared: "未声明",
  unbound: "未绑定",
};
const scopes: Record<string, string> = {
  "development-base-only": "基础成本",
  "base-and-stress": "基础与压力成本",
  "descriptive-only": "描述性结果",
};
const verdicts = { pass: "通过本阶段门槛", fail: "未通过本阶段门槛", unbound: "未绑定阶段凭证" };
const valueText = (value: string | number | boolean | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "number"
      ? number(value, Number.isInteger(value) ? 0 : 6)
      : String(value);

function RowDetail({ row }: { row: TrendResearchRow }) {
  return (
    <dl className="trend-research-detail">
      <div>
        <dt>净收益</dt>
        <dd>{pct(row.netReturn)}</dd>
      </div>
      <div>
        <dt>日终最大回撤</dt>
        <dd>{pct(row.dailyDrawdown)}</dd>
      </div>
      <div>
        <dt>交易数</dt>
        <dd>{row.trades}</dd>
      </div>
      <div>
        <dt>单笔净期望 · USDT</dt>
        <dd>{number(row.netExpectancy)}</dd>
      </div>
      <div>
        <dt>净 PF / 平均净 R</dt>
        <dd>
          {number(row.profitFactor)} / {number(row.meanNetR)}
        </dd>
      </div>
      <div>
        <dt>日 Sharpe</dt>
        <dd>{number(row.dailySharpe)}</dd>
      </div>
      <div>
        <dt>日均收益 95% 区间 · bps</dt>
        <dd>
          {row.dailyMean95CI
            ? row.dailyMean95CI.map((v) => number(v * 10000, 3)).join(" 至 ")
            : "—"}
        </dd>
      </div>
    </dl>
  );
}

function Review({ data }: { data: TrendResearchReview }) {
  const rows = useMemo(
    () =>
      new Map(
        data.rows.map((row) => [
          JSON.stringify([row.candidate, row.window, row.costScenario]),
          row,
        ]),
      ),
    [data],
  );
  const lookup = (candidate: string, window: string, cost: string) =>
    rows.get(JSON.stringify([candidate, window, cost]));
  const [cost, setCost] = useState("base");
  const [candidate, setCandidate] = useState(data.selected);
  const [window, setWindow] = useState(data.windows[0]!.id);
  const axes = researchParameterAxes(data);
  const [axis, setAxis] = useState(axes[0] ?? "");
  const selected = lookup(candidate, window, cost);
  const slice = researchParameterSlice(data, candidate, axis, window, cost);
  const measured = slice.filter((point) => point.row !== null);
  const distinct = new Set(measured.map((point) => JSON.stringify(point.value))).size;
  return (
    <>
      <div className="trend-review-heading">
        <div>
          <span className="trend-eyebrow">冻结实验</span>
          <h2>{data.title}</h2>
          <p>
            {data.symbols.join(" · ")} · {data.engine}
          </p>
        </div>
        <div className="trend-verdict" data-status={data.verdict.status}>
          <strong>{verdicts[data.verdict.status]}</strong>
          <span>
            {roles[data.verdict.stage] ?? data.verdict.stage} ·{" "}
            {scopes[data.verdict.scope] ?? data.verdict.scope}
          </span>
        </div>
      </div>
      <p className="trend-help">
        冻结选择：<strong>{data.selected}</strong>。{data.selectionRule}
      </p>
      <p className="trend-help">
        总初始资金 {number(data.assumptions.accountCapital)} USDT · 每个独立子账户{" "}
        {number(data.assumptions.sleeveCapital)} USDT。 基础成本：单边手续费{" "}
        {data.assumptions.feeBps} / 滑点 {data.assumptions.slippageBps} bps； 压力成本：
        {data.assumptions.stressFeeBps} / {data.assumptions.stressSlippageBps}{" "}
        bps。净收益包含历史资金费。
      </p>
      <section className="trend-findings" aria-label="研究验收结论">
        <h3>验收依据</h3>
        <p className="trend-help">
          结论仅适用于所列阶段与成本范围；开发通过不代表样本外通过。导出工具复核来源账本，浏览器校验文件结构与结论一致性。
        </p>
        {data.findings.length ? (
          <div className="trend-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>实际值</th>
                  <th>门槛</th>
                  <th>结论</th>
                  <th>证据</th>
                </tr>
              </thead>
              <tbody>
                {data.findings.map((finding) => (
                  <tr key={finding.code}>
                    <td title={finding.code}>{finding.label}</td>
                    <td>{valueText(finding.actual)}</td>
                    <td>{valueText(finding.threshold)}</td>
                    <td data-status={finding.status}>
                      {finding.status === "pass"
                        ? "通过"
                        : finding.status === "fail"
                          ? "未通过"
                          : "记录"}
                    </td>
                    <td>{finding.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="trend-help">未提供阶段凭证，本文件只描述测得结果。</p>
        )}
        {data.qualificationReasons.length > 0 && (
          <p className="trend-help">开发资格原因：{data.qualificationReasons.join(" · ")}</p>
        )}
      </section>
      <section aria-label="预声明候选对照">
        <div className="trend-table-toolbar">
          <h3>预声明候选对照</h3>
          <label>
            成本情景{" "}
            <Select
              aria-label="研究成本情景"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            >
              <option value="base">基础成本</option>
              <option value="stress">压力成本</option>
            </Select>
          </label>
        </div>
        <p className="trend-help">
          按原计划顺序展示净收益，点击单元格查看交易质量。未运行保留为空缺；样本外结果不参与重新排名或选择。
        </p>
        <div className="trend-table-scroll">
          <table className="trend-research-matrix">
            <thead>
              <tr>
                <th>候选</th>
                {data.windows.map((w) => (
                  <th key={w.id}>
                    {w.id}
                    <small>
                      {roles[w.role] ?? w.role} · {w.start} 至 {w.end}（不含）
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.id}
                    {c.id === data.selected && <small>冻结选择</small>}
                  </th>
                  {data.windows.map((w) => {
                    const row = lookup(c.id, w.id, cost);
                    return (
                      <td key={w.id} data-positive={row ? row.netReturn > 0 : undefined}>
                        <Button
                          variant="ghost"
                          aria-label={`${c.id} · ${w.id} · ${cost}`}
                          aria-pressed={candidate === c.id && window === w.id}
                          onClick={() => {
                            setCandidate(c.id);
                            setWindow(w.id);
                          }}
                        >
                          {row ? pct(row.netReturn) : "未运行"}
                          {row?.trades === 0 && <small>零交易</small>}
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="trend-selected-result" aria-live="polite">
          <h3>
            {candidate} · {window} · {cost === "base" ? "基础成本" : "压力成本"}
          </h3>
          {selected ? (
            <RowDetail row={selected} />
          ) : (
            <p className="trend-help">该候选在当前窗口与成本情景未运行；缺失值不作为零收益。</p>
          )}
        </div>
      </section>
      <section className="trend-stability" aria-label="单因素参数稳定性">
        <div className="trend-table-toolbar">
          <h3>单因素参数稳定性</h3>
          {axes.length > 0 && (
            <label>
              变化参数{" "}
              <Select
                aria-label="稳定性参数"
                value={axis}
                onChange={(e) => setAxis(e.target.value)}
              >
                {axes.map((key) => (
                  <option key={key} value={key}>
                    {parameterLabel(key)}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <p className="trend-help">
          以所选候选为参照，保持其他策略与风险参数、窗口和成本情景相同，只比较下列参数的实际测点。未插值；未测试的组合不补齐。
        </p>
        {distinct < 2 && (
          <p className="trend-stability-empty">
            当前切片不足两个不同的实测参数值，无法判断稳定性。
          </p>
        )}
        {slice.length > 0 && (
          <div className="trend-table-scroll">
            <table>
              <thead>
                <tr>
                  <th title={axis}>{parameterLabel(axis)}</th>
                  <th>候选</th>
                  <th>净收益</th>
                  <th>日终回撤</th>
                  <th>净期望 · USDT</th>
                  <th>笔数</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((point) => (
                  <tr key={point.candidate}>
                    <td>{parameterValue(axis, point.value)}</td>
                    <td>{point.candidate}</td>
                    <td data-positive={point.row ? point.row.netReturn > 0 : undefined}>
                      {point.row ? pct(point.row.netReturn) : "未运行"}
                    </td>
                    <td>{point.row ? pct(point.row.dailyDrawdown) : "—"}</td>
                    <td>{number(point.row?.netExpectancy)}</td>
                    <td>{point.row?.trades ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary>当前固定参数</summary>
          <dl className="trend-research-parameters">
            {Object.entries(data.candidates.find((c) => c.id === candidate)!.parameters)
              .filter(([key]) => key !== axis)
              .map(([key, value]) => (
                <div key={key}>
                  <dt title={key}>{parameterLabel(key)}</dt>
                  <dd>{parameterValue(key, value)}</dd>
                </div>
              ))}
          </dl>
        </details>
      </section>
      <details className="trend-provenance">
        <summary>来源身份与研究局限</summary>
        <p>{data.auditScope}</p>
        {Object.entries(data.identity).map(([key, value]) => (
          <p key={key}>
            {key}
            <code>{value}</code>
          </p>
        ))}
        {data.limitations.map((limitation, i) => (
          <p key={i}>{limitation}</p>
        ))}
        <p>单因素切片为描述性对照，不是独立证据数量；置信区间未校正候选选择与多次尝试。</p>
      </details>
    </>
  );
}

export function TrendResearchPanel() {
  const [loaded, setLoaded] = useState<{
    data: TrendResearchReview;
    name: string;
    hash: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  async function importFile(file: File) {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("研究文件不能超过 4 MB，请导入 review 命令生成的精简文件。");
      const bytes = await file.arrayBuffer();
      const data = parseTrendResearchReview(JSON.parse(new TextDecoder().decode(bytes)));
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (version === generation.current) setLoaded({ data, name: file.name, hash });
    } catch (reason) {
      if (version === generation.current) setError(String(reason));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  return (
    <div className="trend-research-panel">
      <div className="trend-result-heading">
        <h2>研究证据</h2>
        <Button disabled={loading} onClick={() => input.current?.click()}>
          {loading ? "正在校验…" : "导入研究文件"}
        </Button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".json,application/json"
        aria-label="研究文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {error && (
        <p role="alert" className="trend-error">
          {error}
        </p>
      )}
      {loaded ? (
        <>
          <p className="trend-import-source" title={loaded.hash}>
            {loaded.name} · 文件 SHA-256 {loaded.hash}
          </p>
          <Review key={loaded.hash} data={loaded.data} />
        </>
      ) : (
        <div className="trend-review-empty">
          <span className="trend-eyebrow">从结果到证据</span>
          <h2>看清每次实验支持了什么。</h2>
          <p>导入已审计研究的验收条目、全部候选与成本对照。冻结选择保留原样，未测组合明确留空。</p>
          <p>在本地导出研究文件后，点击上方按钮打开：</p>
          <pre>
            bun run research:trend review --plan plan.json --manifest manifest.json --input run目录
            --receipt 阶段凭证.json --output review.json
          </pre>
          <p>
            阶段凭证可省略；省略时只展示描述性结果。文件在本地读取，不会修改当前回测或解锁后续数据。
          </p>
        </div>
      )}
    </div>
  );
}
