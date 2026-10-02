import { dateText, type ResearchDataset } from "@bcr/market-data/research/model";
import { strategySpec, warmupSessions, type JsgConfig } from "@bcr/quant-core";
export function researchContext(dataset: ResearchDataset, config: JsgConfig) {
  const m = dataset.manifest,
    q = m.dataQuality,
    spec = strategySpec(config);
  const start = config.researchWindow?.start ?? m.startDate;
  const raw = config.executionModel === "jsg-raw-v2";
  const warmup = m.calendar.filter((d) => d.date < start).length;
  return {
    raw,
    spec,
    warmup,
    requiredWarmup: warmupSessions(spec),
    rows: [
      {
        label: "选择成分",
        value:
          m.universeMode === "synthetic"
            ? "合成样本"
            : q?.membership === "historical" && m.universeMode === "historical"
              ? "历史成分"
              : "当前成分快照",
        ready: m.universeMode === "historical" && q?.membership === "historical",
      },
      {
        label: "财务数据",
        value:
          spec.id === "momentum"
            ? "策略不使用财务筛选"
            : q?.financials === "revisions"
              ? "历史公布与修订"
              : "最新记录",
        ready: spec.id === "momentum" || q?.financials === "revisions",
      },
      {
        label: "公司行为",
        value: q?.corporateActions === "complete" ? "完整事件声明" : "未提供完整事件",
        ready: q?.corporateActions === "complete",
      },
      {
        label: "价格限制",
        value: q?.priceLimits === "daily" ? "逐日限制" : "静态比例",
        ready: q?.priceLimits === "daily",
      },
      {
        label: "预热范围",
        value: `${warmup} / ${warmupSessions(spec)} 个交易日`,
        ready: warmup >= warmupSessions(spec),
      },
    ],
    execution: [
      ["成交价格", raw ? "原始价格 · 次日开盘" : "复权研究 · 次日开盘"],
      ["可卖约束", raw || config.tPlusOne ? "T+1" : "允许当日卖出"],
      [
        "成交量约束",
        raw
          ? `日成交量的 ${(100 * (config.participation ?? 0.1)).toFixed(1)}%`
          : "未模拟成交量限制",
      ],
      [
        "费用规则",
        raw
          ? `${config.fees?.length ?? 0} 段费用表 · 最低佣金 / 过户 / 卖出税费`
          : `佣金 ${config.commissionBps} bps`,
      ],
      ["滑点", `${config.slippageBps} bps`],
      ["目标投资比例", `${(spec.investment * 100).toFixed(1)}%`],
    ],
    snapshot: dataset.manifestRef.hash ?? dataset.manifestRef.id,
  };
}
export function snapshotDifference(before: ResearchDataset, after: ResearchDataset) {
  const a = new Set(
    before.manifest.calendar.filter((d) => d.date >= before.manifest.startDate).map((d) => d.date),
  );
  const b = new Set(
    after.manifest.calendar.filter((d) => d.date >= after.manifest.startDate).map((d) => d.date),
  );
  const codesA = new Set(before.manifest.instruments.map((i) => i.code)),
    codesB = new Set(after.manifest.instruments.map((i) => i.code));
  const hashes = new Set(before.partitions.map((p) => p.hash ?? p.id));
  const added = [...b].filter((d) => !a.has(d));
  return {
    addedDates: added.length,
    removedDates: [...a].filter((d) => !b.has(d)).length,
    addedRange: added.length
      ? `${dateText(Math.min(...added))} — ${dateText(Math.max(...added))}`
      : null,
    addedSymbols: [...codesB].filter((c) => !codesA.has(c)).length,
    removedSymbols: [...codesA].filter((c) => !codesB.has(c)).length,
    differentPartitions: after.partitions.filter((p) => !hashes.has(p.hash ?? p.id)).length,
  };
}
