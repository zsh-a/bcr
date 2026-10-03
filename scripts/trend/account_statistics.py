"""Complete account windows and paired date sampling, independent of study policy.

Scenario evaluators own selection, acceptance, and multiple-testing rules. This
module never chooses candidates or omits dates from an account return series.
"""
import math
import random
import re
import statistics

from evaluation import account_series, current_returns, summarize
from protocol import DAY, timestamp


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identifiers(values, label):
    require(isinstance(values, list) and values
            and all(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", value)
                    for value in values) and len(values) == len(set(values)),
            f"{label} must contain nonempty unique identifiers")


def circular_indices(length, block, rng):
    """Exactly one window's original length; wrapping never enters another window."""
    require(length > 0 and block > 0, "circular blocks require positive lengths")
    chosen = []
    while len(chosen) < length:
        start = rng.randrange(length)
        chosen.extend((start + offset) % length for offset in range(min(block, length - len(chosen))))
    return chosen


def paired_bootstrap(windows, series, pairs, samples, block, seed):
    """One date resample per window/replicate shared by all account/cost series."""
    require(series and len(series) == len(set(series)), "bootstrap requires unique series")
    require(all(len(pair) == 2 and all(key in series for key in pair) for pair in pairs.values()),
            "bootstrap pairs must name two declared series")
    require(windows and type(samples) is int and samples > 0, "bootstrap requires windows and positive samples")
    for window in windows:
        require(set(window["returns"]) == set(series), "bootstrap needs all candidate/cost series")
        length = len(window["times"])
        require(length > 0 and all(len(window["returns"][key]) == length for key in series),
                "bootstrap candidate/cost calendars differ")
        require(all(type(value) in (int, float) and math.isfinite(value)
                    for values in window["returns"].values() for value in values),
                "bootstrap cannot omit undefined daily returns")
    days = sum(len(window["times"]) for window in windows)
    means = {key: sum(sum(w["returns"][key]) for w in windows) / days for key in series}
    estimates = {key: [] for key in series}
    paired_estimates = {key: [] for key in pairs}
    rng = random.Random(seed)
    for _ in range(samples):
        totals = {key: 0.0 for key in series}
        for window in windows:
            chosen = circular_indices(len(window["times"]), block, rng)
            for key in series:
                totals[key] += sum(window["returns"][key][index] for index in chosen)
        for key in series:
            estimates[key].append(totals[key] / days)
        for key, (left, right) in pairs.items():
            paired_estimates[key].append((totals[left] - totals[right]) / days)

    def interval(values, mean):
        ordered = sorted(values)
        return {"meanDailyReturn": mean,
                "meanDailyReturn95CI": [ordered[int(samples * .025)], ordered[min(samples - 1, int(samples * .975))]]}

    return {"blockDays": block, "samples": samples, "seed": seed, "days": days,
            "absolute": {key: interval(estimates[key], means[key]) for key in series},
            "paired": {key: interval(paired_estimates[key], means[left] - means[right])
                       for key, (left, right) in pairs.items()}}


def account_window(plan, batches, candidate, window):
    selected, portfolio, initial, _ = account_series(plan, batches, candidate)
    start, end = timestamp(window["start"]), timestamp(window["end"])
    expected = list(range(start + DAY - 1, end, DAY))
    require([point["time"] for point in portfolio] == expected, f"incomplete account calendar: {window['id']}/{candidate}")
    daily = current_returns(portfolio, initial)
    require(all(value is not None and math.isfinite(value) for value in daily),
            f"undefined account daily return: {window['id']}/{candidate}; observations cannot be dropped")
    summary = summarize(plan, batches, candidate, bootstrap=False)
    trades = [trade for _, row in selected for trade in row["trades"]]
    require(all(math.isfinite(t["netPnl"]) and math.isfinite(t["rMultiple"]) for t in trades),
            "non-finite account trade ledger")
    counts = {symbol: len(row["trades"]) for symbol, row in selected}
    compact = {"candidate": candidate, "days": len(expected), "initialCapital": initial,
               "return": summary["equalSleeveReturn"], "dailyMaxDrawdown": summary["dailyPortfolioDrawdown"],
               "trades": len(trades), "tradesBySymbol": counts,
               "netPnl": summary["accountNetPnl"], "netExpectancy": summary["netExpectancy"],
               "meanNetR": summary["meanNetR"], "profitFactor": summary["profitFactor"],
               "meanDailyReturn": statistics.mean(daily)}
    return compact, {"times": expected, "returns": daily}
