import rawSnapshot from "./fred-snapshot.json?raw";
import { FRED_CYCLE_DEFINITIONS } from "./fred";
import type { CycleSnapshot } from "./model";

/** Frozen, attributed source observations; importing this module never contacts the network. */
export function decodeFredSnapshot(value: unknown): CycleSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("美国周期快照无效");
  const input = value as Record<string, unknown>;
  if (
    input["version"] !== 1 ||
    typeof input["fetchedAt"] !== "string" ||
    !Number.isFinite(Date.parse(input["fetchedAt"])) ||
    !Array.isArray(input["series"])
  )
    throw new Error("美国周期快照版本或元数据无效");
  const seen = new Set<string>();
  for (const raw of input["series"]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("美国周期快照序列无效");
    const series = raw as Record<string, unknown>;
    const definition = FRED_CYCLE_DEFINITIONS.find(
      (item) => item.indicator === series["indicator"],
    );
    if (
      !definition ||
      series["country"] !== "USA" ||
      series["frequency"] !== definition.frequency ||
      series["unit"] !== definition.unit ||
      series["seasonalAdjustment"] !== definition.seasonalAdjustment ||
      !Array.isArray(series["observations"]) ||
      typeof series["fetchedAt"] !== "string" ||
      !Number.isFinite(Date.parse(series["fetchedAt"])) ||
      (series["sourceUpdatedAt"] !== null &&
        (typeof series["sourceUpdatedAt"] !== "string" ||
          !Number.isFinite(Date.parse(series["sourceUpdatedAt"]))))
    )
      throw new Error("美国周期快照口径或日期无效");
    if (seen.has(definition.indicator)) throw new Error("美国周期快照序列重复");
    seen.add(definition.indicator);
    const source = series["source"] as Record<string, unknown> | undefined;
    if (
      !source ||
      typeof source["name"] !== "string" ||
      typeof source["seriesCode"] !== "string" ||
      typeof source["url"] !== "string" ||
      !source["url"].startsWith("https://")
    )
      throw new Error("美国周期快照缺少来源");
    let previous = "";
    for (const rawPoint of series["observations"]) {
      const point = rawPoint as Record<string, unknown>;
      if (
        !point ||
        typeof point !== "object" ||
        typeof point["period"] !== "string" ||
        point["period"] <= previous ||
        !/^\d{4}-(?:\d{2}(?:-\d{2})?|Q[1-4])$/u.test(point["period"]) ||
        (point["value"] !== null &&
          (typeof point["value"] !== "number" || !Number.isFinite(point["value"])))
      )
        throw new Error("美国周期快照观测无效或重复");
      previous = point["period"];
    }
  }
  return value as CycleSnapshot;
}

export const bundledFredSnapshot = decodeFredSnapshot(JSON.parse(rawSnapshot) as unknown);
