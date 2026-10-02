import type { MarketLandscapeSnapshot } from "@bcr/market-data";
import { compact } from "../data/marketFormat";
import { DataStamp } from "../components/DataStamp";

export function BreadthSummary({ snapshot }: { snapshot: MarketLandscapeSnapshot }) {
  const b = snapshot.breadth;
  return (
    <section className="ma-overview-summary" aria-label="A 股市场概况">
      <div className="ma-section-heading">
        <h2>A 股市场</h2>
        <span>当日涨跌分布</span>
      </div>
      <dl className="ma-market-breadth-strip">
        {[
          ["上涨", b.advancing, "positive"],
          ["下跌", b.declining, "negative"],
          ["平盘", b.unchanged, ""],
          ["涨停 / 跌停", `${b.limitUp} / ${b.limitDown}`, ""],
          ["成交额", `¥${compact(b.amount)}`, ""],
        ].map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={String(tone)}>
              {typeof value === "number" ? value.toLocaleString() : value}
            </dd>
          </div>
        ))}
      </dl>
      <div
        className="ma-distribution"
        aria-label={`上涨 ${b.advancing}，下跌 ${b.declining}，平盘 ${b.unchanged}`}
      >
        <i style={{ flex: b.advancing }} />
        <i style={{ flex: b.declining }} />
        <i style={{ flex: b.unchanged }} />
      </div>
      <DataStamp source={snapshot.provider} quality={snapshot.quality} at={snapshot.receivedAt} />
    </section>
  );
}
