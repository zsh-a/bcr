import type { MarketSectorPulse } from "@bcr/market-data";
import { compact, signed } from "../data/marketFormat";

export function SectorMap({
  sectors,
  onSelect,
}: {
  sectors: readonly MarketSectorPulse[];
  onSelect: (sector: MarketSectorPulse) => void;
}) {
  return (
    <div className="ma-sector-map">
      {sectors.map((sector) => (
        <button
          type="button"
          key={sector.code}
          onClick={() => onSelect(sector)}
          aria-label={`查看${sector.name}行业`}
          style={{
            background: `color-mix(in srgb, ${sector.changePercent >= 0 ? "var(--color-success)" : "var(--color-danger)"} ${Math.min(28, 8 + Math.abs(sector.changePercent) * 4)}%, var(--color-surface))`,
          }}
        >
          <span>
            <b>{sector.name}</b>
            <small>{sector.code}</small>
          </span>
          <strong className={sector.changePercent >= 0 ? "positive" : "negative"}>
            {signed(sector.changePercent)}
          </strong>
          <footer>
            <span>
              {sector.riseCount} 涨 · {sector.fallCount} 跌
            </span>
            <span>净流入 {compact(sector.mainNetInflow)}</span>
          </footer>
        </button>
      ))}
    </div>
  );
}
