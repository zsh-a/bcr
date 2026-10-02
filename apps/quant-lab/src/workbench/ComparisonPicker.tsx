import { Button, Dialog } from "@bcr/react";
import { MAX_COMPARISONS } from "../results/comparison";
import { percent, timeLabel } from "../results/format";
import type { RunComparisons } from "./useRunComparisons";

export function ComparisonPicker({
  open,
  onClose,
  comparison,
}: {
  open: boolean;
  onClose: () => void;
  comparison: RunComparisons;
}) {
  const { compatible, pendingComparison, comparisons, comparing, compare, clear } = comparison;
  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="对照运行"
      className="research-comparison-dialog"
    >
      <p className="research-dialog-lead">选择相同回测区间的运行，最多添加四次对照。</p>
      <div className="research-comparison-options">
        {compatible.toReversed().map((run) => {
          const checked =
            pendingComparison === run.id || comparisons.some((item) => item.run.id === run.id);
          return (
            <label key={run.id}>
              <input
                type="checkbox"
                aria-label={`对照 ${timeLabel(run.createdAt)}，${run.config.stockCount} 只，收益 ${percent(run.metrics.totalReturn)}`}
                data-comparison-id={run.id}
                checked={checked}
                disabled={comparing || (!checked && comparisons.length >= MAX_COMPARISONS)}
                onChange={() => void compare(run.id)}
              />
              <span>
                {timeLabel(run.createdAt)} · {run.config.stockCount} 只<small>{run.name}</small>
              </span>
              <b>{percent(run.metrics.totalReturn)}</b>
            </label>
          );
        })}
      </div>
      {!compatible.length && (
        <p className="research-help">此区间尚无其他运行。调整参数并运行后，可以在这里比较。</p>
      )}
      <div className="research-comparison-footer">
        <span aria-live="polite">
          {comparing ? "正在读取…" : `已选 ${comparisons.length} / ${MAX_COMPARISONS}`}
        </span>
        <Button variant="ghost" disabled={comparing || !comparisons.length} onClick={() => clear()}>
          清空
        </Button>
        <Button onClick={() => onClose()}>完成</Button>
      </div>
    </Dialog>
  );
}
