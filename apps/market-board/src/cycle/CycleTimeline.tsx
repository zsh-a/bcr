import { Pause, Play } from "lucide-react";
import { Button, Select } from "@bcr/react";
import type { CycleViewState } from "./state";

export function CycleTimeline({
  state,
  periods,
  playing,
  onPlaying,
  onUpdate,
}: {
  state: CycleViewState;
  periods: string[];
  playing: boolean;
  onPlaying: (value: boolean) => void;
  onUpdate: (patch: Partial<CycleViewState>, replace?: boolean) => void;
}) {
  const index = Math.max(0, periods.indexOf(state.period));
  const move = (period: string) => {
    onPlaying(false);
    onUpdate({ period, asOf: "period" }, true);
  };
  return (
    <div className="macro-playback cycle-playback">
      <Button
        variant="ghost"
        aria-label={playing ? "暂停周期回放" : "播放周期轨迹"}
        onClick={() => {
          if (!playing)
            onUpdate(
              {
                asOf: "period",
                ...(index === periods.length - 1 && periods[0] ? { period: periods[0] } : {}),
              },
              true,
            );
          onPlaying(!playing);
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </Button>
      <label htmlFor="cycle-period">{state.period}</label>
      <input
        id="cycle-period"
        type="range"
        aria-label="周期观察月份"
        min={0}
        max={Math.max(0, periods.length - 1)}
        value={index}
        onChange={(event) => {
          const period = periods[Number(event.target.value)];
          if (period) move(period);
        }}
      />
      <Select
        aria-label="精确选择周期月份"
        value={state.period}
        onChange={(event) => move(event.target.value)}
      >
        {periods.map((period) => (
          <option key={period}>{period}</option>
        ))}
      </Select>
    </div>
  );
}
