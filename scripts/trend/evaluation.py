"""Pure account aggregation, uncertainty estimates, and development selection."""
import datetime as dt
import math
import random
import statistics

from protocol import DAY, development_window, sleeve_capital, timestamp
from daily import daily_equity

EVALUATION_VERSION = "trend-account-evaluation-2"
RUST_CONVENTIONS = {"calendar": "UTC", "annualizationDays": 365, "riskFreeRate": 0,
                    "downsideTarget": 0, "minDailyObservations": 30, "variance": "sample",
                    "drawdownSampling": "minute-mark-and-fills"}


def evaluation_contract(batches):
    """A study cannot silently combine incompatible per-sleeve evaluations."""
    versions = set()
    for batch in batches:
        for row in batch["results"]:
            value = row["metrics"].get("evaluation") or {}
            version = value.get("version", "legacy")
            if version not in ["legacy", 2]:
                raise ValueError("unsupported Rust evaluation version")
            versions.add(version)
            if version == 2 and value.get("conventions") != RUST_CONVENTIONS:
                raise ValueError("incompatible Rust evaluation conventions")
    if len(versions) != 1:
        raise ValueError("mixed Rust evaluation versions")
    return next(iter(versions))


def finite_ratio(numerator, denominator):
    if numerator is None or not math.isfinite(numerator) or not math.isfinite(denominator) or denominator <= 0:
        return None
    value = numerator / denominator
    return value if math.isfinite(value) else None


def current_returns(curve, initial):
    """Preserve invalid observations as missing; never skip insolvency days."""
    result, previous = [], initial
    for point in curve:
        equity = point["equity"]
        ratio = finite_ratio(equity, previous)
        result.append(ratio - 1 if ratio is not None else None)
        previous = equity
    return result


def account_evaluation(portfolio, initial):
    """Evaluate summed daily equity; this cannot substitute for minute drawdown."""
    start = portfolio[0]["time"] + 1 - DAY
    end = portfolio[-1]["time"] + 1
    if (start % DAY or [point["time"] for point in portfolio] != list(range(start + DAY - 1, end, DAY))
            or initial <= 0 or not math.isfinite(initial)
            or any(not math.isfinite(point["equity"]) for point in portfolio)):
        raise ValueError("account evaluation requires a complete finite UTC daily curve")
    daily_returns = current_returns(portfolio, initial)
    valid = all(value is not None for value in daily_returns)
    n = len(daily_returns)
    enough_days = n >= RUST_CONVENTIONS["minDailyObservations"]
    valid_path = (all(point["equity"] > 0 for point in portfolio[:-1])
                  and portfolio[-1]["equity"] >= 0)
    ready = valid and enough_days and valid_path
    mean = statistics.mean(daily_returns) if ready else None
    try:
        variance = statistics.variance(daily_returns) if ready else None
    except OverflowError:
        variance = None
    downside = statistics.mean(min(value, 0) ** 2 for value in daily_returns) if ready else None
    annualized = None
    if enough_days and valid_path:
        try:
            value = (portfolio[-1]["equity"] / initial) ** (365 * DAY / (end - start)) - 1
            annualized = value if math.isfinite(value) else None
        except OverflowError:
            pass
    peak, peak_time, worst, longest, current_duration = initial, start, 0.0, 0, 0
    underwater = False
    for point in portfolio:
        equity, time = point["equity"], point["time"]
        if equity >= peak:
            if underwater:
                longest = max(longest, time - peak_time)
            peak, peak_time, underwater = equity, time, False
            current_duration = 0
        else:
            underwater = True
            current_duration = time - peak_time
            longest = max(longest, current_duration)
        worst = min(worst, equity / peak - 1)
    return {"version": 2, "conventions": {**RUST_CONVENTIONS, "drawdownSampling": "daily-close"},
            "durationMs": end - start, "totalDays": n,
            "annualizedReturn": annualized,
            "annualizedVolatility": finite_ratio(math.sqrt(variance) * math.sqrt(365), 1) if variance is not None else None,
            "dailySharpe": finite_ratio(mean * math.sqrt(365), math.sqrt(variance)) if variance is not None else None,
            "sortino": finite_ratio(mean * math.sqrt(365), math.sqrt(downside)) if ready else None,
            "calmar": finite_ratio(annualized, -worst), "dailyMaxDrawdown": worst,
            "maxDrawdownDurationMs": longest, "currentDrawdownDurationMs": current_duration,
            "currentDrawdown": portfolio[-1]["equity"] / peak - 1,
            "bestDayReturn": max(daily_returns) if valid else None,
            "worstDayReturn": min(daily_returns) if valid else None}


def account_costs(selected, net_pnl):
    """Costs are diagnostics already embedded in account equity, never a second debit."""
    keys = ["fees", "funding", "slippageAndRounding", "total", "grossBeforeCosts", "netPnl"]
    result = {key: sum(row["metrics"]["evaluation"]["costs"][key] for _, row in selected) for key in keys}
    for _, row in selected:
        metrics, costs = row["metrics"], row["metrics"]["evaluation"]["costs"]
        if (any(not math.isfinite(costs[key]) for key in keys)
                or any(not math.isclose(costs[key], metrics[key], rel_tol=1e-8, abs_tol=1e-6)
                       for key in ["fees", "funding"])
                or not math.isclose(costs["total"], costs["fees"] + costs["funding"] + costs["slippageAndRounding"], rel_tol=1e-8, abs_tol=1e-6)
                or not math.isclose(costs["grossBeforeCosts"] - costs["total"], costs["netPnl"], rel_tol=1e-8, abs_tol=1e-6)
                or not math.isclose(costs["netPnl"], sum(t["netPnl"] for t in row["trades"]), rel_tol=1e-8, abs_tol=1e-6)):
            raise ValueError("Rust cost attribution does not reconcile with the sleeve ledger")
    if (any(not math.isfinite(value) for value in result.values())
            or not math.isclose(result["netPnl"], net_pnl, rel_tol=1e-8, abs_tol=1e-6)):
        raise ValueError("account cost attribution does not reconcile")
    result["costToGrossProfit"] = finite_ratio(result["total"], result["grossBeforeCosts"])
    return result


def returns(curve, initial):
    result, last = [], initial
    for point in curve:
        result.append(point["equity"] / last - 1)
        last = point["equity"]
    return result


def confidence(values, samples, block, seed):
    """Circular calendar block bootstrap; preserves adjacent-day dependence."""
    if not values or samples < 1 or block < 1:
        raise ValueError("bootstrap requires observations, positive samples and positive block size")
    rng = random.Random(seed)
    estimates = []
    for _ in range(samples):
        chosen = []
        while len(chosen) < len(values):
            start = rng.randrange(len(values))
            chosen.extend(values[(start + i) % len(values)] for i in range(block))
        estimates.append(statistics.mean(chosen[:len(values)]))
    estimates.sort()
    return [estimates[int(samples * .025)], estimates[min(samples - 1, int(samples * .975))]]


def correlation(a, b):
    ma, mb = statistics.mean(a), statistics.mean(b)
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb) if va * vb else None


def account_series(plan, batches, candidate_id):
    selected = [(b["symbol"], next(r for r in b["results"] if r["id"] == candidate_id)) for b in batches]
    if len(selected) != len(plan["symbols"]) or {symbol for symbol, _ in selected} != set(plan["symbols"]):
        raise ValueError("portfolio must contain each declared sleeve exactly once")
    per_sleeve = sleeve_capital(plan)
    initial = per_sleeve * len(selected)
    curves = [daily_equity(r) for _, r in selected]
    if any(not c for c in curves):
        raise ValueError("daily equity cannot be empty")
    if any([p["time"] for p in c] != [p["time"] for p in curves[0]] for c in curves):
        raise ValueError("calendar mismatch across sleeves")
    portfolio = [{"time": p["time"], "equity": sum(c[i]["equity"] for c in curves)} for i, p in enumerate(curves[0])]
    return selected, portfolio, initial, curves


def summarize(plan, batches, candidate_id, bootstrap=True):
    version = evaluation_contract(batches)
    selected, portfolio, initial, curves = account_series(plan, batches, candidate_id)
    account = account_evaluation(portfolio, initial) if version == 2 else None
    per_sleeve = sleeve_capital(plan)
    compute_returns = current_returns if version == 2 else returns
    daily_returns = compute_returns(portfolio, initial)
    valid_returns = all(value is not None for value in daily_returns)
    peak, drawdown = initial, 0
    for point in portfolio:
        peak = max(peak, point["equity"])
        drawdown = min(drawdown, point["equity"] / peak - 1)
    all_trades = [t for _, r in selected for t in r["trades"]]
    net = sum(t["netPnl"] for t in all_trades)
    account_pnl = portfolio[-1]["equity"] - initial
    if not math.isclose(account_pnl, net, rel_tol=1e-8, abs_tol=1e-6):
        raise ValueError("portfolio daily cash does not reconcile with the trade ledger")
    profits = sorted([t["netPnl"] for t in all_trades if t["netPnl"] > 0], reverse=True)
    remove_n = max(1, math.ceil(len(all_trades) * .05)) if all_trades else 0
    ci = confidence(daily_returns, plan["bootstrap"]["samples"], plan["bootstrap"]["blockDays"], plan["bootstrap"]["seed"]) if bootstrap and valid_returns else None
    profit = sum(profits)
    loss = -sum(t["netPnl"] for t in all_trades if t["netPnl"] < 0)
    months = {}
    last = initial
    for i, point in enumerate(portfolio):
        day = dt.datetime.fromtimestamp(point["time"] / 1000, dt.timezone.utc)
        next_day = day + dt.timedelta(days=1)
        if day.month != next_day.month or i == len(portfolio) - 1:
            if version == 2:
                value = finite_ratio(point["equity"], last)
                months[day.strftime("%Y-%m")] = value - 1 if value is not None else None
            else:
                months[day.strftime("%Y-%m")] = point["equity"] / last - 1
            last = point["equity"]
    sigma = statistics.stdev(daily_returns) if version != 2 and len(daily_returns) > 1 else 0
    sleeve_returns = [compute_returns(c, per_sleeve) for c in curves]
    correlations = [correlation(a, b) if all(value is not None for value in a + b) else None
                    for i, a in enumerate(sleeve_returns) for b in sleeve_returns[i + 1:]]
    summary = {"id": candidate_id, "symbols": [{"symbol": symbol, "metrics": r["metrics"]} for symbol, r in selected],
            "capitalMode": plan.get("capitalMode", "independent-equal-sleeves"),
            "accountInitialCapital": initial, "sleeveInitialCapital": per_sleeve,
            "accountFinalEquity": portfolio[-1]["equity"], "accountNetPnl": account_pnl,
            "profitableSymbols": sum(r["metrics"]["totalReturn"] > 0 for _, r in selected),
            "sleeveCount": len(selected), "equalSleeveReturn": portfolio[-1]["equity"] / initial - 1,
            "dailyPortfolioDrawdown": drawdown, "worstSleeveDrawdown": min(r["metrics"]["maxDrawdown"] for _, r in selected),
            "dailySharpe": statistics.mean(daily_returns) / sigma * math.sqrt(365) if sigma else None,
            "meanDailyReturn": statistics.mean(daily_returns) if valid_returns else None, "dailyMean95CI": ci,
            "netExpectancy": net / len(all_trades) if all_trades else None,
            "meanNetR": statistics.mean(t["rMultiple"] for t in all_trades) if all_trades else None,
            "medianSymbolMeanR": statistics.median(r["metrics"]["meanR"] or 0 for _, r in selected),
            "trades": len(all_trades), "profitFactor": profit / loss if loss else None,
            "withoutBestFivePctPnl": net - sum(profits[:remove_n]),
            "bestFivePctProfitShare": sum(profits[:remove_n]) / profit if profit else None,
            "fees": sum(r["metrics"]["fees"] for _, r in selected), "funding": sum(r["metrics"]["funding"] for _, r in selected),
            "feesToInitialCapital": sum(r["metrics"]["fees"] for _, r in selected) / initial,
            "fundingToInitialCapital": sum(r["metrics"]["funding"] for _, r in selected) / initial,
            "longNetPnl": sum(t["netPnl"] for t in all_trades if t["side"] == "long"),
            "shortNetPnl": sum(t["netPnl"] for t in all_trades if t["side"] == "short"),
            "meanPairCorrelation": statistics.mean(c for c in correlations if c is not None) if any(c is not None for c in correlations) else None,
            "monthlyReturns": months, "positiveMonths": sum(x is not None and x > 0 for x in months.values())}
    if version == 2:
        summary["accountEvaluation"] = account
        summary["dailySharpe"] = summary["accountEvaluation"]["dailySharpe"]
        summary["accountEvaluation"]["costs"] = account_costs(selected, account_pnl)
    return summary


def fixed_qualification(plan, summary):
    """Describe evidence for a predeclared rule; this never changes its identity."""
    minimum = plan.get("selectionMinTrades", 30)
    window = development_window(plan)
    days = (timestamp(window["end"]) - timestamp(window["start"])) // DAY
    counts = {row["symbol"]: row["metrics"]["trades"] for row in summary["symbols"]}
    if set(counts) != set(plan["symbols"]) or len(counts) != len(summary["symbols"]):
        raise ValueError("fixed qualification requires every declared symbol exactly once")
    reasons = [f"too-few-trades:{symbol}" for symbol, count in counts.items() if count < minimum]
    if days < RUST_CONVENTIONS["minDailyObservations"]:
        reasons.append("too-few-complete-days")
    if reasons:
        status = "insufficient-sample"
    else:
        if summary.get("dailySharpe") is None or not math.isfinite(summary["dailySharpe"]):
            reasons.append("daily-sharpe-undefined")
        if summary["profitableSymbols"] < plan.get("selectionMinProfitableSymbols", 4):
            reasons.append("too-few-profitable-symbols")
        mean_r = summary.get("medianSymbolMeanR")
        if mean_r is None or not math.isfinite(mean_r) or mean_r <= 0:
            reasons.append("median-symbol-mean-r-nonpositive")
        status = "failed" if reasons else "passed"
    return {"status": status, "reasons": reasons, "completeDays": days,
            "minimumTradesPerSymbol": minimum, "tradesBySymbol": counts}


def select_development(plan, summaries):
    """A frozen objective is chosen on development only, never on later windows."""
    if plan.get("selectionMode") == "fixed":
        selected = [row for row in summaries if row["id"] == plan["fixedCandidate"]]
        if len(selected) != 1:
            raise ValueError("fixed candidate must have exactly one development summary")
        qualification = fixed_qualification(plan, selected[0])
        return selected[0], "fixed", qualification["status"] == "passed"
    objective = plan.get("selectionObjective", "medianSymbolMeanR")
    if objective not in ["medianSymbolMeanR", "dailySharpe"]:
        raise ValueError("selectionObjective must be medianSymbolMeanR or dailySharpe")
    allowed = plan.get("selectionCandidates")
    eligible = [s for s in summaries
                if (allowed is None or s["id"] in allowed)
                and all(r["metrics"]["trades"] >= plan.get("selectionMinTrades", 30) for r in s["symbols"])
                and s.get(objective) is not None and math.isfinite(s[objective])]
    if not eligible:
        raise ValueError("no candidate meets the declared minimum sample size; do not inspect holdout")
    best = max(eligible, key=lambda s: s[objective])
    qualified = best["profitableSymbols"] >= plan.get("selectionMinProfitableSymbols", 4) and best["medianSymbolMeanR"] > 0
    return best, objective, qualified


def paired_comparison(plan, batches, selected, baseline):
    version = evaluation_contract(batches)
    _, selected_curve, initial, _ = account_series(plan, batches, selected)
    _, baseline_curve, _, _ = account_series(plan, batches, baseline)
    if [p["time"] for p in selected_curve] != [p["time"] for p in baseline_curve]:
        raise ValueError("paired comparison calendars differ")
    compute_returns = current_returns if version == 2 else returns
    pairs = list(zip(compute_returns(selected_curve, initial), compute_returns(baseline_curve, initial)))
    if any(a is None or b is None for a, b in pairs):
        return {"meanDailyDifference": None, "meanDailyDifference95CI": None, "days": len(pairs)}
    difference = [a - b for a, b in pairs]
    settings = plan["bootstrap"]
    return {"meanDailyDifference": statistics.mean(difference),
            "meanDailyDifference95CI": confidence(difference, settings["samples"], settings["blockDays"], settings["seed"]),
            "days": len(difference)}
