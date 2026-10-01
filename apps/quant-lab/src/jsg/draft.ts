import { canonicalConfig, datasetKey, type ResearchSession } from "./session";
import type { DataSourceController } from "./useDataSource";

export interface DraftChange {
  label: string;
  before: string;
  after: string;
}
const labels: Record<string, string> = {
  initialCapital: "初始本金",
  poolSize: "候选池大小",
  stockCount: "目标股票数",
  commissionBps: "佣金 / bps",
  slippageBps: "滑点 / bps",
  stopLoss: "个股止损",
  trailingStop: "移动止盈",
  maxDrawdown: "组合回撤",
  tPlusOne: "T+1",
  executionModel: "成交模型",
  industryBlacklist: "行业黑名单",
  participation: "成交量参与率",
  fees: "分期费用",
};
const display = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "无效值";
  if (value === null) return "无效值";
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "未设置";
  return JSON.stringify(value) ?? "未设置";
};
const configDisplay = (
  config: ReturnType<typeof canonicalConfig>,
  key: keyof typeof config,
): string => {
  if (config[key] === null) return "无效值";
  if (key === "executionModel") return config[key] === "jsg-raw-v2" ? "原始价格" : "复权研究";
  if (["stopLoss", "trailingStop", "maxDrawdown", "participation"].includes(key))
    return `${((config[key] as number) * 100).toLocaleString("zh-CN")}%`;
  if (key === "industryBlacklist") return config.industryBlacklist.join("、") || "未设置";
  if (key === "fees")
    return (
      (config.fees ?? [])
        .map(
          (fee) =>
            `${fee.from} 起：佣金 ${fee.commissionBps ?? config.commissionBps} bps，最低 ${fee.minimumCommission} 元，过户 ${fee.transferBps} bps，卖出 ${fee.sellTaxBps} bps`,
        )
        .join("；") || "未设置"
    );
  return display(config[key]);
};
export function draftChanges(
  state: ResearchSession,
  source: Pick<DataSourceController, "kind" | "connection" | "range">,
): DraftChange[] {
  const selected = state.selected;
  if (!selected) return [];
  const changes: DraftChange[] = [];
  const add = (label: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push({ label, before: display(before), after: display(after) });
  };
  const before = canonicalConfig(selected.run.config),
    after = canonicalConfig(state.draft);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      changes.push({
        label: labels[key] ?? key,
        before: configDisplay(before, key),
        after: configDisplay(after, key),
      });
  const request = selected.dataset.snapshot?.request;
  if (source.kind === "clickhouse") {
    if (request) {
      let url = source.connection.url;
      try {
        url = new URL(url).toString();
      } catch {
        /* keep invalid drafts editable */
      }
      add("服务器", request.url, url);
      add("数据库", request.database, source.connection.database);
      add("用户名", request.user, source.connection.user);
      add("开始日期", request.start, source.range.start);
      add("结束日期", request.end, source.range.end);
      add("严格历史数据", request.strictPit, source.range.strictPit);
    } else add("数据来源", "本地快照", "ClickHouse");
    if (source.range.refresh) add("重新获取数据", false, true);
  } else if (!state.dataset || datasetKey(state.dataset) !== datasetKey(selected.run.dataset))
    add("数据快照", selected.run.name, state.dataset?.manifest.name ?? "未选择");
  return changes;
}
