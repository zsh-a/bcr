import { useState } from "react";
import { Badge, Dialog } from "@bcr/react";
import { CircleCheck, Info } from "lucide-react";
import type { JsgResult, ResearchManifest } from "./model";

export function Quality({ manifest, result }: { manifest: ResearchManifest; result?: JsgResult }) {
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
