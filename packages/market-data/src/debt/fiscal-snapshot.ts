import rawSnapshot from "./fiscal-snapshot.json?raw";
import { FISCAL_COUNTRIES, FISCAL_DEFINITIONS } from "./fiscal";
import type { DebtSnapshot } from "./model";

export function decodeFiscalDebtSnapshot(value: unknown): DebtSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("财政快照无效");
  const input = value as Record<string, unknown>;
  if (
    input["version"] !== 1 ||
    typeof input["fetchedAt"] !== "string" ||
    !Number.isFinite(Date.parse(input["fetchedAt"])) ||
    !Array.isArray(input["series"])
  )
    throw new Error("财政快照元数据无效");
  const keys = new Set<string>();
  for (const raw of input["series"]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("财政快照序列无效");
    const series = raw as Record<string, unknown>;
    const definition = FISCAL_DEFINITIONS.find((item) => item.id === series["indicator"]);
    if (
      !definition ||
      typeof series["country"] !== "string" ||
      !(FISCAL_COUNTRIES as readonly string[]).includes(series["country"]) ||
      series["frequency"] !== "A" ||
      series["unit"] !== definition.unit ||
      series["currency"] !== null ||
      series["seasonalAdjustment"] !== "notApplicable" ||
      series["valuation"] !== "notApplicable" ||
      !Array.isArray(series["observations"]) ||
      typeof series["fetchedAt"] !== "string" ||
      !Number.isFinite(Date.parse(series["fetchedAt"]))
    )
      throw new Error("财政快照口径无效");
    const key = `${series["country"]}:${definition.id}`;
    if (keys.has(key)) throw new Error("财政快照重复序列");
    keys.add(key);
    const source = series["source"] as Record<string, unknown> | undefined;
    if (
      !source ||
      source["seriesCode"] !== definition.code ||
      typeof source["url"] !== "string" ||
      !source["url"].startsWith("https://data.worldbank.org/indicator/") ||
      typeof series["note"] !== "string" ||
      typeof series["sourceUpdatedAt"] !== "string" ||
      !Number.isFinite(Date.parse(series["sourceUpdatedAt"]))
    )
      throw new Error("财政快照来源无效");
    let previous = "";
    for (const rawPoint of series["observations"]) {
      const point = rawPoint as Record<string, unknown>;
      if (
        !point ||
        typeof point["period"] !== "string" ||
        !/^\d{4}$/u.test(point["period"]) ||
        point["period"] <= previous ||
        point["period"] >= (series["fetchedAt"] as string).slice(0, 4) ||
        (point["value"] !== null &&
          (typeof point["value"] !== "number" || !Number.isFinite(point["value"]))) ||
        (point["status"] !== undefined && typeof point["status"] !== "string")
      )
        throw new Error("财政快照观测、状态或年份无效");
      previous = point["period"];
    }
  }
  return value as DebtSnapshot;
}

export const bundledFiscalDebtSnapshot = decodeFiscalDebtSnapshot(
  JSON.parse(rawSnapshot) as unknown,
);
