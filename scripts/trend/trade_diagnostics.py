"""Audited completed-trade attribution; no execution, strategy selection or event labels."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[2]
from artifacts import audit_window, atomic_bytes, evaluation_identity, load_evidence, read, sha


def mean(values):
    return statistics.fmean(values) if values else None


def quantile(values, fraction):
    if not values:
        return None
    values = sorted(values)
    index = (len(values) - 1) * fraction
    lower = math.floor(index)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (index - lower)


def summarize(trades):
    risks = [abs(t["entryPrice"] - t["initialStop"]) * t["quantity"] for t in trades]
    gross = [t["grossPnl"] + t["slippageAndRounding"] for t in trades]
    costs = [t["fees"] + t["funding"] + t["slippageAndRounding"] for t in trades]
    for t, risk, g, c in zip(trades, risks, gross, costs):
        assert risk > 0 and math.isclose(risk, t["risk"], abs_tol=1e-9)
        assert math.isclose(t["netPnl"] / risk, t["rMultiple"], abs_tol=1e-9)
        assert math.isclose(g - c, t["netPnl"], abs_tol=1e-9)
        assert t["exitTime"] >= t["entryTime"]
    wins = [t for t in trades if t["netPnl"] > 0]
    losses = [t for t in trades if t["netPnl"] < 0]
    positive, negative = sum(t["netPnl"] for t in wins), -sum(t["netPnl"] for t in losses)
    net = sum(t["netPnl"] for t in trades)
    cost_r = [c / r for c, r in zip(costs, risks)]
    winner_order = sorted(wins, key=lambda t: t["netPnl"], reverse=True)
    tails = {}
    for label, count in [("topFive", 5), ("topFivePct", math.ceil(len(trades) * .05))]:
        top = winner_order[:count]
        pnl = sum(t["netPnl"] for t in top)
        tails[label] = {"requestedTrades": count, "positiveTrades": len(top), "netPnl": pnl,
                        "shareOfPositiveNetPnl": pnl / positive if positive else None,
                        "ledgerNetWithoutTheseTrades": net - pnl,
                        "trades": [{k: t[k] for k in ["symbol", "id", "entryTime", "exitTime", "netPnl", "rMultiple"]} for t in top]}
    reasons = defaultdict(list)
    for t in trades:
        reasons[t["reason"]].append(t)
    result = {
        "trades": len(trades), "wins": len(wins), "losses": len(losses),
        "flat": len(trades) - len(wins) - len(losses),
        "netWinRate": len(wins) / len(trades) if trades else None,
        "averageWin": mean([t["netPnl"] for t in wins]),
        "averageLoss": mean([t["netPnl"] for t in losses]),
        "profitFactor": positive / negative if negative else None,
        "netPnl": net, "netExpectancy": net / len(trades) if trades else None,
        "grossBeforeCosts": sum(gross), "costs": sum(costs),
        "meanGrossBeforeCostsR": mean([g / r for g, r in zip(gross, risks)]),
        "meanCostR": mean(cost_r), "medianCostR": quantile(cost_r, .5),
        "p90CostR": quantile(cost_r, .9), "meanNetR": mean([t["rMultiple"] for t in trades]),
        "meanHoldHours": mean([(t["exitTime"] - t["entryTime"]) / 3600000 for t in trades]),
        "medianHoldHours": quantile([(t["exitTime"] - t["entryTime"]) / 3600000 for t in trades], .5),
        "medianCompletedTradeMfeR": quantile([t["mfeR"] for t in trades], .5),
        "medianCompletedTradeMaeR": quantile([t["maeR"] for t in trades], .5),
        "tails": tails,
        "exitReasons": {reason: {"trades": len(group), "netPnl": sum(t["netPnl"] for t in group),
                                   "wins": sum(t["netPnl"] > 0 for t in group),
                                   "meanNetR": mean([t["rMultiple"] for t in group])}
                        for reason, group in sorted(reasons.items())},
    }
    for key, field in [("fees", "fees"), ("funding", "funding"), ("slippageAndRounding", "slippageAndRounding")]:
        result[key] = sum(t[field] for t in trades)
        result["mean" + key[0].upper() + key[1:] + "R"] = mean([t[field] / r for t, r in zip(trades, risks)])
    if trades:
        assert math.isclose(result["meanGrossBeforeCostsR"] - result["meanCostR"], result["meanNetR"], abs_tol=1e-9)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = load_evidence(args.plan, args.manifest, args.input)
    bundle = read(args.results)
    if bundle.get("evaluationIdentity") != evaluation_identity(evidence):
        raise ValueError("published evaluation does not match the recorded run")
    output = {
        "version": 1, "purpose": "Completed-account-trade attribution for every frozen normal and stress candidate. No rerun, candidate selection or event-label statistics.",
        "sources": {"plan": {"path": str(args.plan), "sha256": sha(args.plan)},
                    "manifest": {"path": str(args.manifest), "sha256": sha(args.manifest)},
                    "results": {"path": str(args.results), "sha256": sha(args.results)},
                    "generator": {"path": str(Path(__file__).relative_to(ROOT)), "sha256": sha(__file__)}},
        "definitions": {
            "R": "Actual entry-to-initial-stop distance times quantity. Arithmetic R means weight completed trades equally; dollar averages use netPnl.",
            "netWinRate": "Strictly positive netPnl trades divided by all completed trades, including exact zero outcomes. Depends on the full exit policy; not independent breakout accuracy.",
            "sides": "Long/short attribution of the same executed account path; not independently replayed directional accounts.",
            "averageLoss": "Mean netPnl over strictly negative trades, kept negative. PF=sum positive netPnl / abs(sum negative netPnl); undefined ratios remain null.",
            "grossBeforeCosts": "grossPnl plus recorded adverse slippageAndRounding. Costs=fees+funding+slippageAndRounding. Attribution of actual path, not zero-cost replay.",
            "timeExposure": "Equal mean of per-sleeve native position-minute fractions. Not notional exposure, beta or shared-margin leverage.",
            "tails": "Most profitable five / ceil(5% of all completed trades) positive trades. Removing profits is descriptive ledger arithmetic, not an executable replay or qualification test.",
            "mfeMae": "Native completed-trade excursions stop at actual exit. They are exit-censored and must not replace fixed-horizon event observations.",
        },
        "inputBatches": [], "windows": {},
    }
    checked = 0
    for window in evidence["plan"]["windows"]:
        key = window["id"]
        batches, _ = audit_window(evidence, window)
        groups = defaultdict(list)
        for batch in batches:
            symbol = batch["symbol"]
            path = args.input / key / (symbol + ".json")
            output["inputBatches"].append({"path": str(path), "sha256": sha(path)})
            for row in batch["results"]:
                groups[row["id"]].append((symbol, row))
        output["windows"][key] = {}
        for published in bundle["summaries"][key]:
            candidate = published["id"]
            native = groups[candidate]
            assert len(native) == len(evidence["plan"]["symbols"])
            trades = [dict(t, symbol=symbol) for symbol, row in native for t in row["trades"]]
            summary = summarize(trades)
            checked += len(trades)
            for field, reference in [("netPnl", "accountNetPnl"), ("netExpectancy", "netExpectancy"),
                                     ("meanNetR", "meanNetR"), ("profitFactor", "profitFactor")]:
                actual, expected = summary[field], published[reference]
                assert actual is None and expected is None or actual is not None and expected is not None and math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-6)
            summary.update(costScenario=published["costScenario"], strategy=published["strategy"],
                           meanSleeveTimeExposure=mean([row["metrics"]["evaluation"]["exposurePct"] for _, row in native]),
                           sides={side: summarize([trade for trade in trades if trade["side"] == side])
                                  for side in ("long", "short")},
                           symbols={symbol: summarize([dict(t, symbol=symbol) for t in row["trades"]]) for symbol, row in native})
            assert sum(value["trades"] for value in summary["sides"].values()) == summary["trades"]
            assert math.isclose(sum(value["netPnl"] for value in summary["sides"].values()),
                                summary["netPnl"], rel_tol=1e-9, abs_tol=1e-6)
            output["windows"][key][candidate] = summary
    output["checkedCompletedTrades"] = checked
    atomic_bytes(args.output, (json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())
    print(json.dumps({"output": str(args.output), "sha256": sha(args.output), "checkedCompletedTrades": checked}))


if __name__ == "__main__":
    main()
