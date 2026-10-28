import rawSnapshot from "./china-snapshot.json?raw";
import { CHINA_CREDIT_IDS, isChinaCreditIndicator } from "./china";
import type { DebtSnapshot } from "./model";

export function decodeChinaDebtSnapshot(value: unknown): DebtSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("中国信用快照无效");
  const input = value as Record<string, unknown>;
  if (
    input["version"] !== 1 ||
    typeof input["fetchedAt"] !== "string" ||
    !Number.isFinite(Date.parse(input["fetchedAt"])) ||
    !Array.isArray(input["series"])
  )
    throw new Error("中国信用快照元数据无效");
  const ids = new Set<string>();
  for (const raw of input["series"]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("中国信用快照序列无效");
    const series = raw as Record<string, unknown>,
      id = series["indicator"];
    if (
      !isChinaCreditIndicator(id) ||
      ids.has(id) ||
      series["country"] !== "CHN" ||
      series["frequency"] !== "M" ||
      series["currency"] !== (id === "socialFinancingGrowth" ? null : "CNY") ||
      series["seasonalAdjustment"] !== "NSA" ||
      series["valuation"] !== "nominal" ||
      series["unit"] !== (id === "socialFinancingGrowth" ? "percent" : "trillionLocal") ||
      !Array.isArray(series["observations"]) ||
      typeof series["fetchedAt"] !== "string" ||
      !Number.isFinite(Date.parse(series["fetchedAt"]))
    )
      throw new Error("中国信用快照口径或来源日期无效");
    ids.add(id);
    const source = series["source"] as Record<string, unknown> | undefined;
    if (
      !source ||
      typeof source["url"] !== "string" ||
      new URL(source["url"]).hostname !== "www.pbc.gov.cn" ||
      typeof series["note"] !== "string" ||
      (series["sourceUpdatedAt"] !== null &&
        (typeof series["sourceUpdatedAt"] !== "string" ||
          !Number.isFinite(Date.parse(series["sourceUpdatedAt"]))))
    )
      throw new Error("中国信用快照缺少可核查来源");
    let previous = "";
    for (const rawPoint of series["observations"]) {
      const point = rawPoint as Record<string, unknown>;
      if (
        !point ||
        typeof point["period"] !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/u.test(point["period"]) ||
        point["period"] <= previous ||
        point["period"] > (series["fetchedAt"] as string).slice(0, 7) ||
        (point["value"] !== null &&
          (typeof point["value"] !== "number" || !Number.isFinite(point["value"])))
      )
        throw new Error("中国信用快照月份重复、未来或数值无效");
      previous = point["period"];
    }
  }
  if (ids.size !== CHINA_CREDIT_IDS.length) throw new Error("中国信用快照缺少指标");
  return value as DebtSnapshot;
}

export const bundledChinaDebtSnapshot = decodeChinaDebtSnapshot(JSON.parse(rawSnapshot) as unknown);
