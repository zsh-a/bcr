import { ArrowUpRight } from "lucide-react";
import { Dialog } from "@bcr/react";
import type { MacroEvent } from "@bcr/market-data/macro/events";
import { eventDateLabel } from "./state";

export function EventClusterDialog({
  events,
  onClose,
  onSelect,
}: {
  events: MacroEvent[];
  onClose: () => void;
  onSelect: (event: MacroEvent) => void;
}) {
  return (
    <Dialog
      open={events.length > 1}
      onClose={onClose}
      title="同年历史事件"
      className="macro-data-dialog"
    >
      <p className="macro-caption">
        这一年度有 {events.length} 条同类事件。选择一条，查看背景与原始资料。
      </p>
      <div className="macro-cluster-list">
        {events.map((event) => (
          <button
            type="button"
            key={event.id}
            onClick={() => {
              onSelect(event);
              onClose();
            }}
          >
            <span>{eventDateLabel(event)}</span>
            <strong>{event.title}</strong>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
