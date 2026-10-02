import type { ResearchDataset } from "@bcr/market-data/research/model";
import { Button } from "@bcr/react";
import { Play } from "lucide-react";
import { Quality } from "../results/Quality";

export function EmptyResearch({
  dataset,
  canRun,
  onRun,
  onDataSettings,
}: {
  dataset: ResearchDataset | null;
  canRun: boolean;
  onRun: () => void;
  onDataSettings: () => void;
}) {
  return (
    <div className="research-empty">
      <span className="research-eyebrow">从一次回测开始</span>
      <div className="research-empty-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <h2>
        让策略的每一次调整
        <br />
        都有结果可对照。
      </h2>
      <p>
        选择数据和区间，调整目标股票数，然后运行回测。
        <br />
        净值、成交与调仓记录会保存为独立的运行。
      </p>
      <div>
        <Button variant="primary" disabled={!canRun} onClick={() => onRun()}>
          <Play size={15} />
          运行首次回测
        </Button>
        <Button variant="ghost" onClick={() => onDataSettings()}>
          选择数据源
        </Button>
      </div>
      {dataset && <Quality manifest={dataset.manifest} snapshot={dataset.snapshot} />}
    </div>
  );
}
