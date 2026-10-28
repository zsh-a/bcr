import rawSnapshot from "./us-signals-snapshot.json?raw";
import { normalizeUsSignalPeriod, US_SIGNAL_DEFINITIONS } from "./us-signals";
import type { CycleSnapshot } from "./model";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("美国补充信号快照对象无效");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** Decode the bundled source observations without starting any network request. */
export function decodeUsSignalsSnapshot(value: unknown, now = new Date()): CycleSnapshot {
  const input = object(value);
  if (
    input["version"] !== 1 ||
    !timestamp(input["fetchedAt"]) ||
    !Number.isFinite(now.getTime()) ||
    input["fetchedAt"] > now.toISOString() ||
    !Array.isArray(input["series"]) ||
    input["series"].length !== US_SIGNAL_DEFINITIONS.length
  )
    throw new Error("美国补充信号快照元数据或序列数量无效");
  const seen = new Set<string>();
  for (const raw of input["series"]) {
    const series = object(raw),
      definition = US_SIGNAL_DEFINITIONS.find((item) => item.indicator === series["indicator"]);
    if (
      !definition ||
      series["country"] !== "USA" ||
      series["frequency"] !== definition.frequency ||
      series["unit"] !== definition.unit ||
      series["seasonalAdjustment"] !== definition.seasonalAdjustment ||
      !timestamp(series["fetchedAt"]) ||
      series["fetchedAt"] > input["fetchedAt"] ||
      series["sourceUpdatedAt"] !== null ||
      typeof series["note"] !== "string" ||
      !series["note"] ||
      !Array.isArray(series["observations"]) ||
      !series["observations"].length ||
      series["observations"].length > 10_000
    )
      throw new Error("美国补充信号快照口径或抓取日期无效");
    if (seen.has(definition.indicator)) throw new Error("美国补充信号快照序列重复");
    seen.add(definition.indicator);
    const source = object(series["source"]);
    if (
      source["name"] !== `${definition.publisher} · FRED` ||
      source["seriesCode"] !== definition.code ||
      source["url"] !== `https://fred.stlouisfed.org/series/${definition.code}` ||
      source["licenseUrl"] !== definition.licenseUrl
    )
      throw new Error("美国补充信号快照来源不匹配");
    let previous = "",
      hasValue = false;
    for (const rawPoint of series["observations"]) {
      const point = object(rawPoint),
        period = point["period"];
      if (
        typeof period !== "string" ||
        period < "2000" ||
        period <= previous ||
        normalizeUsSignalPeriod(period, definition.frequency, new Date(series["fetchedAt"])) !==
          period ||
        (point["value"] !== null &&
          (typeof point["value"] !== "number" || !Number.isFinite(point["value"]))) ||
        (point["status"] !== undefined && typeof point["status"] !== "string")
      )
        throw new Error("美国补充信号快照观测或原生期次无效");
      if (point["value"] !== null) hasValue = true;
      previous = period;
    }
    if (!hasValue) throw new Error("美国补充信号快照全为空值");
  }
  return value as CycleSnapshot;
}

export const bundledUsSignalsSnapshot = decodeUsSignalsSnapshot(JSON.parse(rawSnapshot) as unknown);
