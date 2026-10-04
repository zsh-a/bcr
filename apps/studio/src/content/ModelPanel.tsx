import { useState } from "react";
import { Button, Input, Select } from "@bcr/react";
import {
  PARAMETER_INFO,
  PARAMETER_KEYS,
  formatDecimal,
  validateModel,
  type FixedUseModel,
} from "@bcr/economics-core";
import { runModel, type ContentProject } from "./model";
import { Field, useUnsavedForm, type RunAction, type SaveProject } from "./forms";

export function ModelPanel({
  project,
  save,
  action,
  busy,
}: {
  project: ContentProject;
  save: SaveProject;
  action: RunAction;
  busy: boolean;
}) {
  const [model, setModel] = useState<FixedUseModel>(() => structuredClone(project.model!));
  const dirty = JSON.stringify(model) !== JSON.stringify(project.model);
  useUnsavedForm(dirty);
  const run = runModel(project);
  const parameter = (
    key: (typeof PARAMETER_KEYS)[number],
    patch: Partial<FixedUseModel["parameters"][typeof key]>,
  ) =>
    setModel({
      ...model,
      parameters: { ...model.parameters, [key]: { ...model.parameters[key], ...patch } },
    });
  const scenario = (index: number, patch: Partial<FixedUseModel["scenarios"][number]>) =>
    setModel({
      ...model,
      scenarios: model.scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  return (
    <div className="content-stack">
      <div className="content-section-head">
        <div>
          <p className="content-eyebrow">可复算的假设</p>
          <h2>固定成本与使用次数</h2>
          <p>比较同一周期内的现金支出。出勤率会影响实际使用次数。</p>
        </div>
        <span className="content-tag">CNY · 模型 v1</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          action(async () => {
            validateModel(model);
            await save({ ...project, model });
          });
        }}
      >
        <fieldset disabled={busy} className="content-stack">
          <div className="content-parameter-grid">
            {PARAMETER_KEYS.map((key) => (
              <div className="content-parameter" key={key}>
                <Field label={`${PARAMETER_INFO[key].label}（${PARAMETER_INFO[key].unit}）`}>
                  <Input
                    value={model.parameters[key].value}
                    inputMode="decimal"
                    required
                    onChange={(e) => parameter(key, { value: e.target.value })}
                  />
                </Field>
                <div className="content-field-pair">
                  <Field label="数值类型">
                    <Select
                      value={model.parameters[key].provenance}
                      onChange={(e) =>
                        parameter(key, {
                          provenance: e.target.value as "recorded" | "external" | "assumed",
                        })
                      }
                    >
                      <option value="assumed">自设假设</option>
                      <option value="external">外部统计 / 报价</option>
                      <option value="recorded">实际记录</option>
                    </Select>
                  </Field>
                  <Field label="关联证据">
                    <Select
                      value={model.parameters[key].evidenceId ?? ""}
                      onChange={(e) => parameter(key, { evidenceId: e.target.value || null })}
                    >
                      <option value="">未关联</option>
                      {project.evidence.map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <div className="content-section-head">
            <h3>出勤情景</h3>
            <Button
              type="button"
              disabled={model.scenarios.length >= 12}
              onClick={() =>
                setModel({
                  ...model,
                  scenarios: [
                    ...model.scenarios,
                    {
                      id: crypto.randomUUID(),
                      label: `情景 ${model.scenarios.length + 1}`,
                      weeklyVisits: "1",
                      attendance: "0.8",
                    },
                  ],
                })
              }
            >
              添加情景
            </Button>
          </div>
          {model.scenarios.map((s, i) => (
            <div className="content-scenario" key={s.id}>
              <Field label="情景名称">
                <Input
                  value={s.label}
                  maxLength={80}
                  onChange={(e) => scenario(i, { label: e.target.value })}
                />
              </Field>
              <Field label="每周计划次数">
                <Input
                  value={s.weeklyVisits}
                  inputMode="decimal"
                  onChange={(e) => scenario(i, { weeklyVisits: e.target.value })}
                />
              </Field>
              <Field label="出勤率（0–1）">
                <Input
                  value={s.attendance}
                  inputMode="decimal"
                  onChange={(e) => scenario(i, { attendance: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                disabled={model.scenarios.length === 1}
                onClick={() =>
                  setModel({ ...model, scenarios: model.scenarios.filter((_, j) => j !== i) })
                }
              >
                移除
              </Button>
            </div>
          ))}
          <div className="content-form-actions">
            <span>{dirty ? "参数已修改，保存后更新图表与复核状态" : "参数已保存"}</span>
            {dirty && (
              <Button type="button" onClick={() => setModel(structuredClone(project.model!))}>
                撤销修改
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!dirty}>
              保存并重算
            </Button>
          </div>
        </fieldset>
      </form>
      <div className="content-result-band">
        <div>
          <span>持平点</span>
          <strong>
            {formatDecimal(run.result.breakEven.equalAt)}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <span>首次严格更便宜</span>
          <strong>
            {run.result.breakEven.firstCheaper ?? "—"}
            <small> 次</small>
          </strong>
        </div>
        <p>{run.result.breakEven.reason ?? "持平点允许小数；实际购买判断按整数使用次数计算。"}</p>
      </div>
      <div className="content-table-wrap">
        <table>
          <caption>已保存情景的计算结果</caption>
          <thead>
            <tr>
              <th>情景</th>
              <th>期望次数</th>
              <th>年卡支出</th>
              <th>次卡支出</th>
              <th>年卡每次</th>
              <th>节省</th>
            </tr>
          </thead>
          <tbody>
            {run.result.scenarios.map((s) => (
              <tr key={s.id}>
                <th>{s.label}</th>
                <td>{formatDecimal(s.visits)}</td>
                <td>¥{formatDecimal(s.total)}</td>
                <td>¥{formatDecimal(s.alternative)}</td>
                <td>{s.average === null ? "未定义" : `¥${formatDecimal(s.average)}`}</td>
                <td>¥{formatDecimal(s.savings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="content-table-wrap">
        <table>
          <caption>敏感性分析 · 改变出勤率后的年卡平均单次成本</caption>
          <thead>
            <tr>
              <th>出勤率</th>
              {run.result.scenarios.map((s) => (
                <th key={s.id}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.result.sensitivity.map((row) => (
              <tr key={row.attendance}>
                <th>{Number(row.attendance) * 100}%</th>
                {row.scenarios.map((s) => (
                  <td key={s.id}>¥{formatDecimal(s.average)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="content-details">
        <summary>查看公式与计算规则</summary>
        <pre>
          {Object.entries(run.result.formula)
            .map(([name, formula]) => `${name} = ${formula}`)
            .join("\n")}
        </pre>
        <p>
          计算保留 40
          位有效数字，显示按四舍五入保留两位小数。全年周数是明确假设；期望出勤次数不提前取整。零次使用的平均成本未定义。本模型仅比较现金支出。
        </p>
      </details>
    </div>
  );
}
