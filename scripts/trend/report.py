"""Audit a frozen study and render a descriptive report into a new directory."""
import argparse
import hashlib
import json
from pathlib import Path

from artifacts import (atomic_bytes, audit_window, ensure_writable, evaluation_fingerprint,
                       load_evidence, sha, source_fingerprint, write)
from evaluation import EVALUATION_VERSION, account_series, evaluation_contract, paired_comparison, summarize
from protocol import DAY, is_development, sleeve_capital, timestamp


def pct(value):
    return "—" if value is None else f"{value * 100:.2f}%"


def number(value):
    return "—" if value is None else f"{value:.3f}"


def text(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def report_identity(evidence):
    records = [{"window": window["id"], "symbol": symbol,
                "sha256": sha(evidence["directory"] / window["id"] / f"{symbol}.json")}
               for window in evidence["plan"]["windows"] for symbol in evidence["plan"]["symbols"]]
    return {"planSha256": evidence["planSha256"], "manifestSha256": evidence["manifestSha256"],
            "selectionSha256": sha(evidence["directory"] / "selection.json"),
            "rawResultsSha256": hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest(),
            "evaluationVersion": EVALUATION_VERSION, "evaluationSha256": evaluation_fingerprint()}


def prepare_destination(evidence, output):
    ensure_writable(output, directory=True)
    raw, destination = evidence["directory"].resolve(), output.resolve()
    if raw == destination or raw in destination.parents:
        raise ValueError("report output must be outside the raw run directory")
    identity = report_identity(evidence)
    result_path = output / "results.json"
    if result_path.exists() and json.loads(result_path.read_text()).get("evaluationIdentity") != identity:
        raise ValueError("report directory belongs to a different study or evaluation; choose a new output directory")
    return identity


def build_bundle(evidence):
    """Re-evaluate verified ledgers while keeping the historical choice fixed."""
    plan, selection = evidence["plan"], evidence["selection"]
    chosen, baseline = selection["id"], plan.get("baseline")
    summaries, comparisons, provenance, curves = {}, {}, [], []
    contract = None
    for window in plan["windows"]:
        batches, receipts = audit_window(evidence, window)
        current = evaluation_contract(batches)
        if contract is not None and contract != current:
            raise ValueError("mixed Rust evaluation versions across study windows")
        contract = current
        candidates = [row["id"] for row in batches[0]["results"]]
        summaries[window["id"]] = [summarize(plan, batches, candidate) for candidate in candidates]
        provenance.extend(receipts)
        if baseline is not None:
            comparisons[window["id"]] = paired_comparison(plan, batches, chosen, baseline)
        for candidate in dict.fromkeys([chosen] if baseline is None else [baseline, chosen]):
            _, account, initial, _ = account_series(plan, batches, candidate)
            curves.append({"window": window["id"], "candidate": candidate,
                           "points": [{"time": point["time"], "nav": point["equity"] / initial}
                                      for point in account]})
    bundle = {"version": 2, "engine": evidence["engine"], "plan": plan,
              "planSha256": evidence["planSha256"], "manifestSha256": evidence["manifestSha256"],
              "selection": selection, "baseline": baseline,
              "evaluation": {"version": EVALUATION_VERSION, "sourceSha256": evaluation_fingerprint(),
                             "selectionRecomputed": False, "singleSleeveEvaluationVersion": contract,
                             "accountDrawdownSampling": "daily-close"},
              "reportSourceSha256": source_fingerprint("report.py"),
              "auditSourceSha256": source_fingerprint("artifacts.py", "protocol.py", "warmup.py"),
              "auditScope": "Recorded receipt/configuration identities, UTC daily calendars and cash/trade reconciliation; source CSV files are not rehashed.",
              "summaries": summaries, "pairedComparisons": comparisons, "provenance": provenance,
              "archives": {symbol: row["archives"] for symbol, row in evidence["manifest"]["symbols"].items()}}
    return bundle, curves


def render_report(bundle):
    plan, selection = bundle["plan"], bundle["selection"]
    chosen, baseline = selection["id"], bundle["baseline"]
    windows = plan["windows"]
    capital = sleeve_capital(plan)
    count = len(plan["symbols"])
    def row(window, candidate):
        return next(value for value in bundle["summaries"][window] if value["id"] == candidate)
    lines = [f"# {plan.get('title', '趋势策略研究评估')}", "",
             f"引擎：`{bundle['engine']}`。冻结选择：`{chosen}`。" + (f"基线：`{baseline}`。" if baseline else "计划未声明独立基线。"), "",
             "本报告审计已有运行并重新汇总账本，保留当时的开发期选择，不重新挑选历史赢家。窗口身份以计划声明为准；未声明身份的历史窗口不能视为新的样本外证据。报告不自动判断策略已具备长期正期望。", "",
             f"计划冻结说明：{plan.get('frozenAt', '原计划未记录')}。", "",
             "## 资金与执行口径", "",
             f"{count} 个独立固定子账户，总初始资金 {capital * count:,.2f} USDT，每个子账户 {capital:,.2f} USDT。"
             f"资金模式：`{plan.get('capitalMode', 'independent-equal-sleeves')}`。按实际数量和订单门槛回放后合计，不共享保证金或跨账户调拨。", "",
             f"品种：{', '.join(plan['symbols'])}。单边手续费 {plan['costs']['feeBps']} bps，滑点 {plan['costs']['slippageBps']} bps；"
             f"压力情形分别为 {plan['costs']['stressFeeBps']} 与 {plan['costs']['stressSlippageBps']} bps。收益扣除手续费、模拟滑点和历史资金费。", "",
             f"每笔子账户风险 {pct(plan['risk']['riskPct'])}，名义敞口上限 {pct(plan['risk']['maxExposurePct'])}。各研究窗口独立开始，不拼接为连续实盘净值。", "",
             f"冻结选择规则：{plan['selection']}", "",
             f"统计采用 {plan['bootstrap']['samples']} 次、{plan['bootstrap']['blockDays']} 天循环块重采样，种子 {plan['bootstrap']['seed']}。区间未校正候选选择偏差。", "",
             "## 研究窗口", "", "| ID | 声明身份 | 开始日期 | 结束日期（不含） | 日样本数 |", "|---|---|---|---|---:|"]
    for window in windows:
        role = window.get("role", "development" if is_development(window) else "未声明的历史窗口")
        days = (timestamp(window["end"]) - timestamp(window["start"])) // DAY
        lines.append(f"| {text(window['id'])} | {text(role)} | {window['start']} | {window['end']} | {days} |")
    lines += ["", "## 全部声明候选的净收益", "",
              "| 规则 | " + " | ".join(text(w.get("label", w["id"])) for w in windows) + " |",
              "|---|" + "---:|" * len(windows)]
    for candidate in plan["candidates"]:
        lines.append("| " + text(candidate["id"]) + " | " + " | ".join(pct(row(w["id"], candidate["id"])["equalSleeveReturn"]) for w in windows) + " |")
    lines += ["", "## 冻结选择的账户表现", "",
              "| 区间 | 净收益 | 日收益 Sharpe | 日最大回撤 | 笔数 | 盈利品种 | 手续费 USDT | 资金费净支出 USDT |",
              "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for window in windows:
        value = row(window["id"], chosen)
        lines.append("| " + " | ".join([text(window["id"]), pct(value["equalSleeveReturn"]), number(value["dailySharpe"]),
                     pct(value["dailyPortfolioDrawdown"]), str(value["trades"]), f"{value['profitableSymbols']}/{count}",
                     f"{value['fees']:.2f}", f"{value['funding']:.2f}"]) + " |")
    modern = [window for window in windows if "accountEvaluation" in row(window["id"], chosen)]
    if modern:
        lines += ["", "合计账户先汇总各子账户的完整 UTC 日终权益，再计算日收益。年化使用 365 日，无风险利率和下行目标均为 0；"
                  "CAGR、波动率与风险比率至少需要 30 个完整日，这只是展示门槛。未定义或非有限值显示为 —。"
                  "账户 Calmar 使用日终最大回撤；逐币 Rust Calmar 使用分钟估值与成交回撤，二者不能混比。", "",
                  "| 区间 | 账户 CAGR | 年化波动 | Sortino | 日终 Calmar | 最差日 | 最长日终回撤天数 | 期末未恢复天数 |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for window in modern:
            value = row(window["id"], chosen)["accountEvaluation"]
            lines.append("| " + " | ".join([text(window["id"]), pct(value["annualizedReturn"]),
                         pct(value["annualizedVolatility"]), number(value["sortino"]), number(value["calmar"]),
                         pct(value["worstDayReturn"]), number(value["maxDrawdownDurationMs"] / DAY),
                         number(value["currentDrawdownDurationMs"] / DAY)]) + " |")
        lines += ["", "最长回撤从此前峰值计到恢复或区间结束，包含尚未恢复的区段；日终采样可能漏掉日内峰谷。", "",
                  "| 区间 | 手续费 | 资金费净支出 | 滑点及取整 | 总成本 | 成本前盈亏 | 净盈亏 |",
                  "|---|---:|---:|---:|---:|---:|---:|"]
        for window in modern:
            costs = row(window["id"], chosen)["accountEvaluation"]["costs"]
            lines.append("| " + " | ".join([text(window["id"]), *[f"{costs[key]:.2f}" for key in
                         ["fees", "funding", "slippageAndRounding", "total", "grossBeforeCosts", "netPnl"]]]) + " |")
        lines += ["", "金额单位 USDT。资金费负值为收入；滑点及取整已包含在成交价中，总成本仅作归因，不从净值重复扣除。", "",
                  "<details>", "<summary>冻结选择的逐币评价 · 直接读取 Rust evaluation v2</summary>", "",
                  "| 区间 / 品种 | CAGR | 日 Sharpe | Sortino | Calmar | 分钟最大回撤 | 最长回撤天数 | 总成本 USDT |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for window in modern:
            for sleeve in row(window["id"], chosen)["symbols"]:
                metrics = sleeve["metrics"]
                value = metrics["evaluation"]
                lines.append("| " + " | ".join([text(f"{window['id']} / {sleeve['symbol']}"),
                             pct(value["annualizedReturn"]), number(value["dailySharpe"]), number(value["sortino"]),
                             number(value["calmar"]), pct(metrics["maxDrawdown"]),
                             number(value["maxDrawdownDurationMs"] / DAY), f"{value['costs']['total']:.2f}"]) + " |")
        lines += ["", "逐币日/月明细、成本与采样约定保留在 results.json 的原始 metrics.evaluation；未从图表或组合指标反推。", "", "</details>"]
    else:
        lines += ["", "本研究为旧版未标记评价，保留原账户统计和原选择；不补造 v2 成本归因、回撤时长或逐币指标。"]
    if baseline:
        lines += ["", "## 同风险预算的基线比较", "",
                  "| 区间 | 基线净收益 | 选择净收益 | 选择压力收益 | 日均收益差 95% 配对区间 bps |",
                  "|---|---:|---:|---:|---| "]
        for window in windows:
            key = window["id"]
            stress = next((value for value in bundle["summaries"][key] if value["id"] == chosen + "-stress"), None)
            interval = bundle["pairedComparisons"][key]["meanDailyDifference95CI"]
            lines.append("| " + " | ".join([text(key), pct(row(key, baseline)["equalSleeveReturn"]),
                         pct(row(key, chosen)["equalSleeveReturn"]), pct(stress["equalSleeveReturn"] if stress else None),
                         f"[{interval[0] * 10000:.3f}, {interval[1] * 10000:.3f}]" if interval is not None else "—"]) + " |")
        lines += ["", "配对以同一天的合计账户收益为单位，保留共同市场冲击。区间跨零或短样本均不能据此确认相对优势。"]
    lines += ["", "## 证据与复核", "",
              f"计划 SHA-256：`{bundle['planSha256']}`。",
              f"评价版本：`{bundle['evaluation']['version']}`，评价源码 SHA-256：`{bundle['evaluation']['sourceSha256']}`。", "",
              "results.json 保存原冻结选择、当前评价身份、原始收据及档案来源；curves.json 保存独立窗口曲线。审计核对原始结果、配置、清单、二进制身份、完整 UTC 日历与现金账本，不要求当前源码等于历史源码，也未重新下载或重算分钟成交。", "",
              "本次审计未逐一重新计算来源 CSV 的文件哈希；档案身份来自原运行冻结清单。新评价与原发布报告分开保存，原证据保持不变。", "",
              "## 原计划的接受条件与局限", "", str(plan.get("acceptance", "未声明结构化接受条件；本报告仅描述结果。")), ""]
    lines += [f"- {value}" for value in plan.get("limitations", [])]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    ensure_writable(args.output, directory=True)
    evidence = load_evidence(args.plan, args.manifest, args.input)
    identity = prepare_destination(evidence, args.output)
    bundle, curves = build_bundle(evidence)
    if report_identity(evidence) != identity:
        raise ValueError("inputs or evaluation sources changed while the report was being built")
    bundle["evaluationIdentity"] = identity
    write(args.output / "curves.json", curves)
    bundle["curvesSha256"] = sha(args.output / "curves.json")
    write(args.output / "results.json", bundle)
    atomic_bytes(args.output / "REPORT.md", render_report(bundle).encode())
    print(args.output / "REPORT.md")


if __name__ == "__main__":
    main()
