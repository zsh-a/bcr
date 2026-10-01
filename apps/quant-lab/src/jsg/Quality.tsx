import { useState } from "react";
import { Badge, Dialog } from "@bcr/react";
import { CircleCheck, Info } from "lucide-react";
import { dateText, type JsgResult, type ResearchManifest, type ResearchDataset } from "./model";
import { percent } from "./Orders";

export function Quality({
  manifest,
  result,
  snapshot,
}: {
  manifest: ResearchManifest;
  result?: JsgResult;
  snapshot?: ResearchDataset["snapshot"];
}) {
  const [open, setOpen] = useState(false);
  const complete =
    manifest.universeMode === "historical" &&
    manifest.dataQuality?.financials === "revisions" &&
    manifest.dataQuality.corporateActions === "complete" &&
    manifest.dataQuality.priceLimits === "daily";
  const warnings = [...new Set([...manifest.warnings, ...(result?.warnings ?? [])])];
  const mode =
    manifest.universeMode === "synthetic" ? "演示数据" : complete ? "历史数据" : "数据局限";
  return (
    <>
      <button
        type="button"
        className="research-quality-button"
        onClick={() => setOpen(true)}
        aria-label={`数据质量：${mode}`}
      >
        <Badge tone={complete ? "success" : "amber"}>
          {complete ? <CircleCheck size={12} /> : <Info size={12} />}
          {mode}
          {warnings.length > 0 ? ` · ${warnings.length}` : ""}
        </Badge>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="数据质量与研究假设"
        className="research-quality-dialog"
      >
        <p className="research-dialog-lead">
          {manifest.universeMode === "synthetic"
            ? "合成数据仅用于验证工作流和策略行为。"
            : complete
              ? "此快照声明提供历史成分、财报修订、公司行动和每日价格限制。"
              : "此结果使用的快照存在覆盖限制，请结合下面的假设解读收益。"}
        </p>
        <dl className="research-facts">
          {[
            ["请求区间", `${dateText(manifest.startDate)} — ${dateText(manifest.endDate)}`],
            [
              "交易日 / 预热日",
              `${manifest.calendar.filter((d) => d.date >= manifest.startDate).length} / ${manifest.calendar.filter((d) => d.date < manifest.startDate).length}`,
            ],
            [
              "证券 / 行业",
              `${manifest.instruments.length.toLocaleString()} / ${manifest.industries.length.toLocaleString()}`,
            ],
            [
              "冻结数据",
              `${manifest.partitions.reduce((n, p) => n + p.rows, 0).toLocaleString()} 行 · ${(manifest.partitions.reduce((n, p) => n + p.bytes, 0) / 1048576).toFixed(1)} MiB`,
            ],
            [
              "快照获取时间",
              snapshot
                ? new Date(snapshot.createdAt).toLocaleString("zh-CN")
                : "导入文件 · 获取时间未知",
            ],
            ["获取时源数据最新日", snapshot?.sourceLastDate ?? "未知"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          {[
            [
              "成分股",
              manifest.universeMode === "historical"
                ? "历史成分"
                : manifest.universeMode === "synthetic"
                  ? "合成样本"
                  : "当前快照 · 存在幸存者偏差",
            ],
            [
              "财务数据",
              manifest.dataQuality?.financials === "revisions"
                ? "历史修订"
                : "最新记录 · 未追溯修订",
            ],
            [
              "公司行动",
              manifest.dataQuality?.corporateActions === "complete" ? "完整事件" : "未提供完整事件",
            ],
            ["价格限制", manifest.dataQuality?.priceLimits === "daily" ? "逐日限制" : "静态比例"],
            ["成交模型", result?.metrics.model === "jsg-raw-v2" ? "原始价格" : "复权研究"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="research-help">
          新鲜度基于获取时的源覆盖与快照时间；冻结结果不会随源库更新。历史能力按快照声明展示。
        </p>
        {result?.diagnostics ? (
          <>
            <h3>本次窗口观测诊断</h3>
            <dl className="research-facts">
              {[
                [
                  "实际观测范围",
                  `${result.diagnostics.firstDate} — ${result.diagnostics.lastDate}`,
                ],
                [
                  "实际行情观测",
                  `${result.diagnostics.rows.toLocaleString()} 行 · ${result.diagnostics.days} 日`,
                ],
                [
                  "宇宙格点覆盖率",
                  percent(result.diagnostics.rows / Math.max(1, result.diagnostics.instrumentDays)),
                ],
                [
                  "无正利润观测",
                  percent(
                    result.diagnostics.nonPositiveProfit / Math.max(1, result.diagnostics.rows),
                  ),
                ],
                [
                  "股本不可用率",
                  percent(result.diagnostics.zeroShares / Math.max(1, result.diagnostics.rows)),
                ],
                [
                  "行业未知率",
                  percent(
                    result.diagnostics.unknownIndustry / Math.max(1, result.diagnostics.rows),
                  ),
                ],
                [
                  "停牌 / ST 观测",
                  `${result.diagnostics.suspended.toLocaleString()} / ${result.diagnostics.st.toLocaleString()}`,
                ],
                [
                  "持仓沿用旧价格",
                  `${result.diagnostics.staleHeldMarks.toLocaleString()} 个证券交易日`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="research-help">
              格点覆盖以证券宇宙 ×
              交易日为分母，上市前、退市后和停牌可能没有行情，因此未覆盖格点不等同于数据缺失。无正利润观测也不等同于缺失财报。
            </p>
          </>
        ) : result ? (
          <p className="research-help">此运行尚无观测诊断，重新回测后可查看。</p>
        ) : null}
        {warnings.length > 0 && (
          <ul className="research-warning-list">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
