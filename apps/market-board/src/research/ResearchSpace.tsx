import { useMemo } from "react";
import {
  bundledCycleSnapshot,
  cyclePeriods,
  cycleSpacePoints,
  monthIndex,
} from "@bcr/market-data/cycle";
import { economicPeriodEnd } from "@bcr/market-data/economy";
import CycleSpace3D from "../cycle/CycleSpace3D";
import { bundledEconomicRepository } from "@bcr/market-data/economy";

export default function ResearchSpace({
  countries,
  focus,
  onFocus,
  colors,
  cutoff,
  range,
  active,
}: {
  countries: string[];
  focus: string | null;
  onFocus: (country: string) => void;
  colors: Record<string, string>;
  cutoff: string;
  range: [string, string];
  active: boolean;
}) {
  const key = countries.join(",");
  const data = useMemo(() => {
    const ids = key.split(",").filter(Boolean);
    const period = cyclePeriods(bundledCycleSnapshot, ids)
      .filter(
        (value) =>
          economicPeriodEnd(value, "M") <= cutoff && economicPeriodEnd(value, "M") >= range[0],
      )
      .at(-1);
    const months = period
      ? Math.min(36, Math.max(1, monthIndex(period) - monthIndex(range[0].slice(0, 7)) + 1))
      : 0;
    return {
      period,
      points: period ? cycleSpacePoints(bundledCycleSnapshot, ids, period, months) : [],
    };
  }, [key, cutoff, range]);
  const selected = useMemo(
    () =>
      countries.map((id) => ({
        id,
        name: bundledEconomicRepository.countries.find((country) => country.id === id)?.name ?? id,
        color: colors[id] ?? "",
      })),
    [countries, colors],
  );
  if (!data.period) return <p className="research-empty">当前观察窗口没有可用 CLI 轨迹。</p>;
  return (
    <div className="research-space">
      <p className="research-caption">
        CLI 最后可用观察月 {data.period} · 统一截止 {cutoff}。纵深为历史月份，与主屏共用国家选择。
      </p>
      <CycleSpace3D
        points={data.points}
        countries={selected}
        period={data.period}
        selectedCountry={focus}
        onSelectCountry={onFocus}
        active={active}
      />
    </div>
  );
}
