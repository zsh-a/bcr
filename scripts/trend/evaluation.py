"""Pure account aggregation, uncertainty estimates, and development selection."""
import datetime as dt
import math
import random
import statistics

from protocol import DAY, sleeve_capital

EVALUATION_VERSION = "trend-account-evaluation-1"


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
    curves = [r["daily"] for _, r in selected]
    if any(not c for c in curves):
        raise ValueError("daily equity cannot be empty")
    if any([p["time"] for p in c] != [p["time"] for p in curves[0]] for c in curves):
        raise ValueError("calendar mismatch across sleeves")
    portfolio = [{"time": p["time"], "equity": sum(c[i]["equity"] for c in curves)} for i, p in enumerate(curves[0])]
    return selected, portfolio, initial, curves


def summarize(plan, batches, candidate_id, bootstrap=True):
    selected, portfolio, initial, curves = account_series(plan, batches, candidate_id)
    per_sleeve = sleeve_capital(plan)
    daily_returns = returns(portfolio, initial)
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
    ci = confidence(daily_returns, plan["bootstrap"]["samples"], plan["bootstrap"]["blockDays"], plan["bootstrap"]["seed"]) if bootstrap else None
    profit = sum(profits)
    loss = -sum(t["netPnl"] for t in all_trades if t["netPnl"] < 0)
    months = {}
    last = initial
    for i, point in enumerate(portfolio):
        day = dt.datetime.fromtimestamp(point["time"] / 1000, dt.timezone.utc)
        next_day = day + dt.timedelta(days=1)
        if day.month != next_day.month or i == len(portfolio) - 1:
            months[day.strftime("%Y-%m")] = point["equity"] / last - 1
            last = point["equity"]
    sigma = statistics.stdev(daily_returns) if len(daily_returns) > 1 else 0
    sleeve_returns = [returns(c, per_sleeve) for c in curves]
    correlations = [correlation(sleeve_returns[i], sleeve_returns[j]) for i in range(len(curves)) for j in range(i + 1, len(curves))]
    return {"id": candidate_id, "symbols": [{"symbol": symbol, "metrics": r["metrics"]} for symbol, r in selected],
            "capitalMode": plan.get("capitalMode", "independent-equal-sleeves"),
            "accountInitialCapital": initial, "sleeveInitialCapital": per_sleeve,
            "accountFinalEquity": portfolio[-1]["equity"], "accountNetPnl": account_pnl,
            "profitableSymbols": sum(r["metrics"]["totalReturn"] > 0 for _, r in selected),
            "sleeveCount": len(selected), "equalSleeveReturn": portfolio[-1]["equity"] / initial - 1,
            "dailyPortfolioDrawdown": drawdown, "worstSleeveDrawdown": min(r["metrics"]["maxDrawdown"] for _, r in selected),
            "dailySharpe": statistics.mean(daily_returns) / sigma * math.sqrt(365) if sigma else None,
            "meanDailyReturn": statistics.mean(daily_returns), "dailyMean95CI": ci,
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
            "monthlyReturns": months, "positiveMonths": sum(x > 0 for x in months.values())}


def select_development(plan, summaries):
    """A frozen objective is chosen on development only, never on later windows."""
    objective = plan.get("selectionObjective", "medianSymbolMeanR")
    if objective not in ["medianSymbolMeanR", "dailySharpe"]:
        raise ValueError("selectionObjective must be medianSymbolMeanR or dailySharpe")
    eligible = [s for s in summaries
                if all(r["metrics"]["trades"] >= plan.get("selectionMinTrades", 30) for r in s["symbols"])
                and s.get(objective) is not None and math.isfinite(s[objective])]
    if not eligible:
        raise ValueError("no candidate meets the declared minimum sample size; do not inspect holdout")
    best = max(eligible, key=lambda s: s[objective])
    qualified = best["profitableSymbols"] >= plan.get("selectionMinProfitableSymbols", 4) and best["medianSymbolMeanR"] > 0
    return best, objective, qualified


def paired_comparison(plan, batches, selected, baseline):
    _, selected_curve, initial, _ = account_series(plan, batches, selected)
    _, baseline_curve, _, _ = account_series(plan, batches, baseline)
    if [p["time"] for p in selected_curve] != [p["time"] for p in baseline_curve]:
        raise ValueError("paired comparison calendars differ")
    difference = [a - b for a, b in zip(returns(selected_curve, initial), returns(baseline_curve, initial))]
    settings = plan["bootstrap"]
    return {"meanDailyDifference": statistics.mean(difference),
            "meanDailyDifference95CI": confidence(difference, settings["samples"], settings["blockDays"], settings["seed"]),
            "days": len(difference)}
