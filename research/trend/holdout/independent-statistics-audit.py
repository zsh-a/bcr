"""Independent daily-ledger audit of the frozen cross-symbol holdout.

Uses only the Python standard library. Does not import the production account,
bootstrap, qualification or acceptance implementations and does not read prices.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[3]
DAY = 86_400_000
PLAN_SHA256 = "8255384163aa20d51f9743b15dc74567194d762fdaf359ec9533269779059a8e"
SERIES = ("selectedBase", "baselineBase", "selectedStress", "baselineStress")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def timestamp(value):
    return int(dt.datetime.fromisoformat(value).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def close(left, right, label):
    require(type(left) in (float, int) and type(right) in (float, int)
            and math.isfinite(left) and math.isfinite(right)
            and math.isclose(left, right, rel_tol=1e-10, abs_tol=1e-10), f"numeric mismatch: {label}")
    return abs(left - right)


def resample(windows, samples, block, seed):
    """Direct observation indexing, shared dates; no prefix-sum shortcut."""
    total_days = sum(len(window[SERIES[0]]) for window in windows)
    means = {key: math.fsum(value for window in windows for value in window[key]) / total_days
             for key in SERIES}
    means.update(pairedBase=means["selectedBase"] - means["baselineBase"],
                 pairedStress=means["selectedStress"] - means["baselineStress"])
    draws = {key: [] for key in means}
    rng = random.Random(seed)
    for _ in range(samples):
        sums = {key: 0.0 for key in SERIES}
        for window in windows:
            n = len(window[SERIES[0]])
            indexes = []
            while len(indexes) < n:
                start = rng.randrange(n)
                indexes += [(start + offset) % n for offset in range(min(block, n - len(indexes)))]
            for key in SERIES:
                sums[key] += math.fsum(window[key][index] for index in indexes)
        for key in SERIES:
            draws[key].append(sums[key] / total_days)
        draws["pairedBase"].append((sums["selectedBase"] - sums["baselineBase"]) / total_days)
        draws["pairedStress"].append((sums["selectedStress"] - sums["baselineStress"]) / total_days)
    result = {}
    for key, values in draws.items():
        values.sort()
        result[key] = {"meanDailyReturn": means[key],
                       "meanDailyReturn95CI": [values[int(samples * .025)], values[int(samples * .975)]]}
    return {"blockDays": block, "days": total_days, "statistics": result}


def account(rows, symbols, window, initial):
    times = list(range(timestamp(window["start"]) + DAY - 1, timestamp(window["end"]), DAY))
    require(len(rows) == len(symbols) and times, "incomplete account inputs")
    counts, net_values, r_values = {}, [], []
    for symbol, row in zip(symbols, rows):
        require([point["time"] for point in row["daily"]] == times, "incomplete raw calendar")
        canonical = row["metrics"]["evaluation"]["daily"]
        require(len(canonical) == len(times), "incomplete canonical calendar")
        for point, observation in zip(row["daily"], canonical):
            require(observation["complete"] is True and observation["from"] == point["time"] + 1 - DAY
                    and observation["to"] == point["time"] + 1, "canonical UTC interval mismatch")
            close(point["equity"], observation["equity"], "canonical equity")
        close(row["config"]["execution"]["initialCapital"], initial / len(symbols), "sleeve allocation")
        net = math.fsum(trade["netPnl"] for trade in row["trades"])
        close(initial / len(symbols) + net, row["daily"][-1]["equity"], "final cash reconciliation")
        counts[symbol] = len(row["trades"])
        require(row["metrics"]["trades"] == counts[symbol], "trade-count mismatch")
        net_values.extend(trade["netPnl"] for trade in row["trades"])
        r_values.extend(trade["rMultiple"] for trade in row["trades"])
    equities = [math.fsum(row["daily"][day]["equity"] for row in rows) for day in range(len(times))]
    require(all(math.isfinite(value) and value > 0 for value in [initial, *equities]),
            "nonpositive/nonfinite account equity cannot be silently dropped")
    returns = [value / previous - 1 for previous, value in zip([initial, *equities[:-1]], equities)]
    peak, drawdown = initial, 0.0
    for value in equities:
        peak = max(peak, value)
        drawdown = min(drawdown, value / peak - 1)
    wins = math.fsum(value for value in net_values if value > 0)
    losses = -math.fsum(value for value in net_values if value < 0)
    count, net = len(net_values), math.fsum(net_values)
    compact = {"days": len(times), "initialCapital": initial, "return": equities[-1] / initial - 1,
               "dailyMaxDrawdown": drawdown, "trades": count, "tradesBySymbol": counts, "netPnl": net,
               "netExpectancy": net / count if count else None,
               "meanNetR": math.fsum(r_values) / count if count else None,
               "profitFactor": wins / losses if losses else None,
               "meanDailyReturn": math.fsum(returns) / len(returns)}
    return compact, returns


def source_qualification(plan, summary):
    """Independently apply only the old plan's recorded qualification gates."""
    development = [window for window in plan["windows"]
                   if window.get("role", "development" if window["id"] == "development" else "") == "development"]
    require(len(development) == 1, "source needs its original development window")
    window = development[0]
    counts = {row["symbol"]: row["metrics"]["trades"] for row in summary["symbols"]}
    require(set(counts) == set(plan["symbols"]) and len(counts) == len(summary["symbols"]),
            "qualification must belong to original source symbols")
    days = (timestamp(window["end"]) - timestamp(window["start"])) // DAY
    minimum = plan.get("selectionMinTrades", 30)
    reasons = [f"too-few-trades:{symbol}" for symbol, count in counts.items() if count < minimum]
    if days < 30:
        reasons.append("too-few-complete-days")
    if reasons:
        status = "insufficient-sample"
    else:
        if summary.get("dailySharpe") is None or not math.isfinite(summary["dailySharpe"]):
            reasons.append("daily-sharpe-undefined")
        if summary["profitableSymbols"] < plan.get("selectionMinProfitableSymbols", 4):
            reasons.append("too-few-profitable-symbols")
        if summary.get("medianSymbolMeanR") is None or not math.isfinite(summary["medianSymbolMeanR"]) or summary["medianSymbolMeanR"] <= 0:
            reasons.append("median-symbol-mean-r-nonpositive")
        status = "failed" if reasons else "passed"
    return {"status": status, "reasons": reasons, "completeDays": days,
            "minimumTradesPerSymbol": minimum, "tradesBySymbol": counts}


def run(args):
    require(not args.output.exists(), "audit output already exists")
    require(args.input.resolve() not in args.output.resolve().parents, "audit output must be outside raw data")
    tracked = {}

    def read(path, expected=None):
        path = Path(path).resolve()
        data = path.read_bytes()
        hashed = hashlib.sha256(data).hexdigest()
        require(expected is None or hashed == expected, f"checksum mismatch: {path}")
        require(path not in tracked or tracked[path] == hashed, f"input changed: {path}")
        tracked[path] = hashed
        return json.loads(data)

    plan = read(args.plan, PLAN_SHA256)
    require(plan["selectionMode"] == "inherited" and len(plan["symbols"]) == 6
            and len(plan["candidates"]) == 2, "unexpected frozen study shape")
    settings = plan["transferEvaluation"]
    require(settings["blockDays"] == [7, 28] and settings["samples"] == 2000
            and settings["seed"] == 20261003, "unexpected frozen resampling protocol")
    manifest = read(args.manifest)
    selection = read(args.input / "selection.json")
    native_run = read(args.input / "run.json")
    evaluation = read(args.evaluation)
    require(evaluation["version"] == "trend-transfer-evaluation-2" and evaluation["protocol"] == settings,
            "transfer protocol/version differs from frozen plan")
    identity = evaluation["evaluationIdentity"]
    require(identity["planSha256"] == manifest["planSha256"] == selection["planSha256"] == PLAN_SHA256,
            "target plan identity mismatch")
    require(identity["manifestSha256"] == selection["manifestSha256"] == tracked[args.manifest.resolve()]
            and identity["selectionSha256"] == tracked[(args.input / "selection.json").resolve()],
            "target selection/manifest identity mismatch")
    require(selection["id"] == plan["fixedCandidate"] == evaluation["selected"]
            and plan["baseline"] == evaluation["baseline"] and evaluation["selectionRecomputed"] is False,
            "frozen rule was replaced or reranked")
    require(selection["qualificationScope"] == evaluation["qualificationScope"] == "source-domain"
            and "developmentSha256" not in selection, "fabricated target-domain development qualification")
    source = plan["selectionSource"]
    source_plan = read(ROOT / source["plan"], source["planSha256"])
    read(ROOT / source["manifest"], source["manifestSha256"])
    source_run = ROOT / source["run"]
    old_run = read(source_run / "run.json", source["runSha256"])
    old_selection = read(source_run / "selection.json", source["selectionSha256"])
    require(old_selection["id"] == selection["id"] and source_plan["baseline"] == plan["baseline"],
            "target identities differ from the original source choice")
    require(old_selection["binarySha256"] == old_run["binarySha256"] == selection["binarySha256"]
            == native_run["binarySha256"], "native binary changed across domains")
    source_window = selection["selectionSource"]["sourceDevelopmentWindow"]
    old_summary = read(source_run / f"{source_window['id']}-summary.json", source["developmentSha256"])
    old_choice = [row for row in old_summary if row["id"] == selection["id"]]
    require(len(old_choice) == 1, "source selected summary missing or duplicated")
    qualification = source_qualification(source_plan, old_choice[0])
    require(qualification == selection["developmentQualification"] == evaluation["developmentQualification"]
            and (qualification["status"] == "passed") is old_selection["developmentQualified"]
            is selection["developmentQualified"] is evaluation["developmentQualified"],
            "source-only qualification mismatch")
    require(all(selection["selectionSource"][key] == value for key, value in source.items())
            and selection["selectionSource"] == evaluation["selectionSource"], "source evidence identity mismatch")
    require(set(source_plan["symbols"]).isdisjoint(plan["symbols"]), "target symbols overlap source")
    require(evaluation["targetDomain"]["disjointSymbols"] is True
            and evaluation["targetDomain"]["timeIndependenceClaim"] is False
            and evaluation["targetDomain"]["prospective"] is False, "incorrect validation-domain claim")
    for candidate in plan["candidates"]:
        require(candidate == next(row for row in source_plan["candidates"] if row["id"] == candidate["id"]),
                "inherited candidate definition changed")
    require(plan["costs"] == source_plan["costs"] and plan["risk"] == source_plan["risk"]
            and plan["initialCapital"] / len(plan["symbols"]) == source_plan["initialCapital"] / len(source_plan["symbols"]),
            "source costs, risk or per-symbol capital changed")

    names = {"selectedBase": selection["id"], "baselineBase": plan["baseline"],
             "selectedStress": selection["id"] + "-stress", "baselineStress": plan["baseline"] + "-stress"}
    expected_ids = set(names.values())
    windows, sampled, raw_hashes = {}, [], []
    counts = {"batches": 0, "rows": 0, "trades": 0}
    max_error = 0.0
    for window in plan["windows"]:
        batches = []
        for symbol in plan["symbols"]:
            path = args.input / window["id"] / f"{symbol}.json"
            receipt = read(path.with_suffix(".receipt.json"))
            batch = read(path, receipt["resultSha256"])
            configs = read(path.with_name(f"{symbol}-configs.json"), receipt["configsSha256"])
            require(receipt["window"] == window and batch["window"] == window["id"] and batch["symbol"] == symbol,
                    "raw window/symbol identity mismatch")
            require(batch["startTime"] == timestamp(window["start"]) and batch["endTime"] == timestamp(window["end"])
                    and batch["planSha256"] == PLAN_SHA256, "raw plan/date mismatch")
            require(all(receipt[key] == selection[key] == native_run[key] for key in
                        ["planSha256", "manifestSha256", "binarySha256", "replayVersion"]), "receipt run identity mismatch")
            require(len(batch["results"]) == len(configs) == 4
                    and {row["id"] for row in batch["results"]} == {row["id"] for row in configs} == expected_ids,
                    "all four candidate/cost series are required")
            indexed = {row["id"]: row for row in batch["results"]}
            for request in configs:
                require(request["config"] == indexed[request["id"]]["config"], "raw/config disagreement")
            batches.append(indexed)
            raw_hashes.append({"window": window["id"], "symbol": symbol, "sha256": tracked[path.resolve()]})
            counts["batches"] += 1
            counts["rows"] += len(indexed)
            counts["trades"] += sum(len(row["trades"]) for row in indexed.values())
        if window["id"] not in settings["windows"]:
            continue
        recorded = next(row for row in evaluation["windows"] if row["id"] == window["id"])
        accounts, daily = {}, {}
        for key, name in names.items():
            compact, daily[key] = account([batch[name] for batch in batches], list(plan["symbols"]), window, plan["initialCapital"])
            accounts[key] = compact
            target = recorded["accounts"][key]
            require(target["candidate"] == name and target["tradesBySymbol"] == compact["tradesBySymbol"], "account identity/count mismatch")
            for field, value in compact.items():
                if field == "tradesBySymbol":
                    continue
                if value is None:
                    require(target[field] is None, f"undefined ratio replaced: {field}")
                else:
                    max_error = max(max_error, close(value, target[field], f"account {field}"))
        windows[window["id"]] = accounts
        sampled.append(daily)
    require(set(windows) == set(settings["windows"]), "incomplete declared evaluation")
    raw_digest = hashlib.sha256(json.dumps(raw_hashes, sort_keys=True).encode()).hexdigest()
    require(raw_digest == identity["rawResultsSha256"], "raw account identity differs from transfer evaluation")
    days = sum(len(window[SERIES[0]]) for window in sampled)
    require(days == evaluation["pooled"]["days"] == 760, "unexpected holdout calendar length")
    intervals = []
    max_interval_error = 0.0
    for block in settings["blockDays"]:
        independent = resample(sampled, settings["samples"], block, settings["seed"])
        recorded = next(row for row in evaluation["bootstrap"] if row["blockDays"] == block)
        require(recorded["samples"] == settings["samples"] and recorded["seed"] == settings["seed"]
                and recorded["days"] == days, "bootstrap settings mismatch")
        for key, value in independent["statistics"].items():
            target = recorded["absolute"][key] if key in SERIES else recorded["paired"]["base" if key == "pairedBase" else "stress"]
            errors = [close(value["meanDailyReturn"], target["meanDailyReturn"], "bootstrap mean")]
            errors += [close(a, b, "percentile bound") for a, b in zip(value["meanDailyReturn95CI"], target["meanDailyReturn95CI"])]
            max_interval_error = max(max_interval_error, *errors)
        intervals.append(independent)
    checks = {}
    if settings["requireDevelopmentQualified"]:
        checks["development-qualified"] = qualification["status"] == "passed"
    checks["minimum-transfer-days"] = days >= settings["minimumDays"]
    for cost, key in [("base", "selectedBase"), ("stress", "selectedStress")]:
        counts_by_symbol = {symbol: sum(row[key]["tradesBySymbol"][symbol] for row in windows.values()) for symbol in plan["symbols"]}
        require(counts_by_symbol == evaluation["pooled"][cost]["tradesBySymbol"], "pooled symbol counts mismatch")
        trades = sum(counts_by_symbol.values())
        require(trades == evaluation["pooled"][cost]["trades"], "pooled trade count mismatch")
        checks[f"{cost}:minimum-trades"] = trades >= settings["minimumTrades"]
        for symbol, count in counts_by_symbol.items():
            checks[f"{cost}:minimum-trades:{symbol}"] = count >= settings["minimumTradesPerSymbol"]
        for name, row in windows.items():
            if settings["requireEachWindowPositive"]:
                checks[f"{cost}:{name}:positive-return"] = row[key]["return"] > 0
            checks[f"{cost}:{name}:daily-drawdown"] = row[key]["dailyMaxDrawdown"] >= -settings["maxDailyDrawdown"]
        for interval in intervals:
            checks[f"{cost}:block{interval['blockDays']}:absolute-lower-bound"] = interval["statistics"][key]["meanDailyReturn95CI"][0] > 0
    require(len(evaluation["acceptance"]["checks"]) == len(checks)
            and checks == {row["criterion"]: row["passed"] for row in evaluation["acceptance"]["checks"]},
            "independent acceptance differs")
    failed = [key for key, value in checks.items() if not value]
    status = "not-established" if failed else "passed-for-forward-observation"
    require(status == evaluation["acceptance"]["status"] and failed == evaluation["acceptance"]["failedCriteria"], "verdict mismatch")
    require(all(digest(path) == hashed for path, hashed in tracked.items()), "input changed during audit")
    record = {"version": 1, "auditStatus": "passed", "scope": "Independent source-domain qualification, raw daily accounts, direct-index circular blocks and transfer acceptance. No price-source, minute execution or fresh-selection audit.",
              "inputs": [{"path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path), "sha256": hashed} for path, hashed in tracked.items()],
              "scriptSha256": digest(__file__), "counts": {**counts, "days": days, "series": 4, "acceptanceChecks": len(checks)},
              "selected": selection["id"], "baseline": plan["baseline"], "qualificationScope": "source-domain",
              "sourceQualification": qualification, "sourceSymbols": list(source_plan["symbols"]), "targetSymbols": list(plan["symbols"]),
              "knownTime": True, "prospective": False, "windows": windows, "bootstrap": intervals,
              "maxAccountMetricError": max_error, "maxMeanOrCIError": max_interval_error,
              "checks": checks, "failedCriteria": failed, "evaluationStatus": status}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as stream:
        json.dump(record, stream, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.output), "auditStatus": "passed", "evaluationStatus": status,
                      "failedCriteria": failed, "maxMeanOrCIError": max_interval_error}))


def self_test():
    windows = [{key: [rate] * days for key in SERIES} for days, rate in [(2, .01), (8, .03)]]
    result = resample(windows, 100, 7, 19)
    for key in SERIES:
        close(result["statistics"][key]["meanDailyReturn"], .026, "day weighting")
        for bound in result["statistics"][key]["meanDailyReturn95CI"]:
            close(bound, .026, "no cross-window sampling")
    require(result["statistics"]["pairedBase"]["meanDailyReturn95CI"] == [0.0, 0.0], "paired dates")
    print("synthetic sampler checks passed; no target data read")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--plan", type=Path, default=ROOT / "research/trend/holdout-plan.json")
    parser.add_argument("--manifest", type=Path, default=ROOT / "tmp/trend-holdout-v8/manifest.json")
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/trend-holdout-v8")
    parser.add_argument("--evaluation", type=Path, default=ROOT / "research/trend/holdout/transfer-evaluation.json")
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/holdout/independent-statistics-audit.json")
    arguments = parser.parse_args()
    self_test() if arguments.self_test else run(arguments)
