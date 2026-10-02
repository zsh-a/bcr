import { dateText } from "@bcr/market-data/research/model";
import { Button, Dialog } from "@bcr/react";
import { Trash2 } from "lucide-react";
import { percent, timeLabel } from "../results/format";
import type { ResearchController } from "../session/service";

export function RunHistory({
  research,
  open,
  onClose,
  busy,
}: {
  research: ResearchController;
  open: boolean;
  onClose: () => void;
  busy: boolean;
}) {
  const { state } = research;
  const selected = state.selected;
  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="运行历史"
      placement="sheet"
      className="research-history-dialog"
    >
      <p className="research-dialog-lead">
        所有运行持续保存，可在研究目录中组织实验。选择历史只切换结果，下一次运行的参数保持当前编辑值。
      </p>
      <div className="research-history-list">
        {state.runs.toReversed().map((run) => (
          <div key={run.id} className="research-history-row">
            <button
              type="button"
              aria-pressed={selected?.run.id === run.id}
              onClick={() => {
                onClose();
                void research.selectRun(run.id);
              }}
            >
              <span>
                <b>{timeLabel(run.createdAt)}</b>
                <small>
                  {dateText(run.startDate)} — {dateText(run.endDate)}
                </small>
                <small>
                  目标 {run.config.stockCount} 只 · 佣金 {run.config.commissionBps / 100}% · 滑点{" "}
                  {run.config.slippageBps} bps
                </small>
              </span>
              <span>
                <strong>{percent(run.metrics.totalReturn)}</strong>
                <small>回撤 {percent(run.metrics.maxDrawdown)}</small>
                {selected?.run.id === run.id && <small>当前查看</small>}
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`移除运行 ${timeLabel(run.createdAt)}`}
              disabled={busy}
              onClick={() => research.forgetRun(run.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
