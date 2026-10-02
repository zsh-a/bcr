import type { DataQuality } from "@bcr/market-data";
import { qualityLabel, receivedTime } from "../data/marketFormat";

export function DataStamp({
  source,
  quality,
  at,
}: {
  source: string;
  quality: DataQuality;
  at: number;
}) {
  return (
    <div className={`ma-data-stamp ${quality}`}>
      <span>
        <i />
        {qualityLabel(quality)}
      </span>
      <span>{source}</span>
      <time dateTime={new Date(at).toISOString()}>
        {new Date(at).toLocaleDateString()} {receivedTime(at)}
      </time>
    </div>
  );
}
