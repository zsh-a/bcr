import {
  displayLabel,
  displayName,
  EMPTY_DISPLAY_NAMES,
  type DisplayNames,
} from "@bcr/market-data/research/display-names";
import type { SelectedRun } from "../session/model";
import { money, percent } from "./format";
import type { ResearchSummary } from "./research-analysis";

export const escapeHtml = (v: unknown) =>
  String(v).replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export const csvCell = (v: unknown) =>
  `"${(typeof v === "string" ? v.replace(/^[=+@\-\t\r]/u, "'$&") : String(v)).replaceAll('"', '""')}"`;
export function downloadText(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ledgerCsv(summary: ResearchSummary, names: DisplayNames = EMPTY_DISPLAY_NAMES) {
  return (
    "\uFEFF" +
    [
      [
        "代码",
        "证券名称",
        "行业代码",
        "行业名称",
        "期末数量",
        "期末市值",
        "净盈亏",
        "已实现",
        "未实现",
        "费用",
        "分配收入",
        "应收款",
        "最后估值日",
      ],
      ...summary.assets.map((a) => [
        a.code,
        displayName(names, "instruments", a.code),
        a.industry,
        displayName(names, "industries", a.industry),
        a.quantity,
        a.value,
        a.profit,
        a.realized,
        a.unrealized,
        a.fees,
        a.income,
        a.receivable,
        a.markDate,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export function researchReport(
  selected: SelectedRun,
  summary: ResearchSummary,
  names: DisplayNames = selected.dataset.manifest.displayNames ?? EMPTY_DISPLAY_NAMES,
) {
  const { run, dataset, result } = selected;
  const table = (head: string[], rows: unknown[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>JSG 研究报告</title><style>body{font:14px/1.7 system-ui;max-width:1080px;margin:48px auto;padding:0 24px;color:#25332f}h1{font-size:28px}h2{margin-top:32px;font-size:18px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:right;border-bottom:1px solid #ddd;padding:8px}th:first-child,td:first-child{text-align:left}pre{white-space:pre-wrap;font-size:12px}p{color:#59645f}@media print{body{margin:0}tr{break-inside:avoid}}</style><h1>JSG · 研究报告</h1><p>${escapeHtml(run.name)} · ${run.startDate} — ${run.endDate} · 运行 ${escapeHtml(run.id)}<br>数据 ${escapeHtml(dataset.manifestRef.hash ?? dataset.manifestRef.id)}</p>
  ${table(["收益", "年化", "最大回撤", "Sharpe", "净盈亏", "费用"], [[percent(result.metrics.totalReturn), percent(result.metrics.annualizedReturn), percent(result.metrics.maxDrawdown), result.metrics.sharpe.toFixed(2), money(summary.profit), money(summary.fees)]])}
  <h2>数据与假设</h2><p>${escapeHtml([...dataset.manifest.warnings, ...result.warnings].join("；") || "无额外警告")}<br>来源 ${escapeHtml(dataset.manifest.source)} · 获取时间 ${escapeHtml(dataset.snapshot?.createdAt ?? "未知")} · 获取时源最新日 ${escapeHtml(dataset.snapshot?.sourceLastDate ?? "未知")}</p><pre>${escapeHtml(JSON.stringify({ config: run.config, versions: run.versions, diagnostics: result.diagnostics }, null, 2))}</pre>
  <p>证券与行业名称仅用于展示，采用源库最新名称${names.capturedAt ? `；获取时间 ${escapeHtml(names.capturedAt)}` : ""}。</p>
  <h2>证券盈亏账本</h2>${table(
    ["证券", "行业", "数量", "市值", "净盈亏", "已实现", "未实现", "费用"],
    summary.assets.map((a) => [
      displayLabel(names, "instruments", a.code),
      displayLabel(names, "industries", a.industry),
      a.quantity,
      money(a.value),
      money(a.profit),
      money(a.realized),
      money(a.unrealized),
      money(a.fees),
    ]),
  )}
  <h2>行业归因与期末暴露</h2>${table(
    ["行业", "净贡献", "市值", "仓位"],
    summary.industries.map((a) => [
      displayLabel(names, "industries", a.industry),
      money(a.profit),
      money(a.value),
      percent(a.weight),
    ]),
  )}
  <h2>回撤区间</h2>${table(
    ["峰值", "谷底", "恢复", "深度", "交易日"],
    summary.episodes.map((e) => [
      e.peak,
      e.trough,
      e.recovered ?? "尚未恢复",
      percent(e.depth),
      e.sessions,
    ]),
  )}
  <p>净盈亏 = 累计交易与分配现金流 + 市值 + 应收款。费用已扣除，滑点包含在成交价中。股票成本含买入费用，送转股分摊成本，现金分红计入已实现收入；已实现 = 净盈亏 − 未实现。复权研究模型使用复权价格单位。行业贡献按每日盈亏发生时的行业累计。资产对账最大误差 ${summary.reconciliationError.toFixed(6)} 元。可通过浏览器打印为 PDF。</p></html>`;
}
