"""Evaluate a frozen choice on declared historical transfer windows, without reselection."""
import argparse
import math
from pathlib import Path
import statistics

from artifacts import (audit_window, ensure_writable, evaluation_identity, load_evidence, read, resolve_selection_source,
                       sha, source_fingerprint, write_once)
from account_statistics import account_window, paired_bootstrap, require
from evaluation import account_series, current_returns, evaluation_contract, fixed_qualification
from protocol import DAY, development_window, is_development, timestamp

VERSION = "trend-transfer-evaluation-1"
INHERITED_VERSION = "trend-transfer-evaluation-2"
SERIES = ("selectedBase", "baselineBase", "selectedStress", "baselineStress")
PAIRS = {"base": ("selectedBase", "baselineBase"), "stress": ("selectedStress", "baselineStress")}
SOURCES = ("transfer_evaluation.py", "account_statistics.py", "evaluation.py",
           "artifacts.py", "daily.py", "protocol.py", "warmup.py")


def settings_for(plan):
    settings = plan.get("transferEvaluation")
    expected = {"windows", "samples", "seed", "blockDays", "minimumDays", "minimumTrades",
                "minimumTradesPerSymbol", "maxDailyDrawdown", "requireEachWindowPositive",
                "requireDevelopmentQualified", "method", "acceptance"}
    require(isinstance(settings, dict) and set(settings) == expected,
            "transferEvaluation must contain exactly the supported frozen protocol fields")
    windows = settings["windows"]
    require(isinstance(windows, list) and windows and all(isinstance(w, str) for w in windows)
            and len(windows) == len(set(windows)), "transfer windows must be nonempty and unique")
    declared = {w["id"]: w for w in plan["windows"]}
    require(set(windows) <= set(declared), "transfer window is missing from the plan")
    intervals = sorted((timestamp(declared[w]["start"]), timestamp(declared[w]["end"])) for w in windows)
    require(all(start % DAY == 0 and end % DAY == 0 and end > start for start, end in intervals)
            and all(left[1] <= right[0] for left, right in zip(intervals, intervals[1:])),
            "transfer windows require non-overlapping complete UTC dates")
    if plan.get("selectionMode") == "inherited":
        require(not any(is_development(window) for window in plan["windows"]),
                "inherited transfer cannot introduce a new development window")
    else:
        require(development_window(plan)["id"] not in windows, "development cannot be a transfer window")
    for name in ("samples", "minimumDays", "minimumTrades", "minimumTradesPerSymbol"):
        require(type(settings[name]) is int and settings[name] > 0, f"invalid transfer {name}")
    require(type(settings["seed"]) is int, "invalid transfer seed")
    blocks = settings["blockDays"]
    require(isinstance(blocks, list) and blocks and all(type(b) is int and b > 0 for b in blocks)
            and len(blocks) == len(set(blocks)), "blockDays must contain unique positive integers")
    limit = settings["maxDailyDrawdown"]
    require(type(limit) in (int, float) and math.isfinite(limit) and 0 < limit <= 1,
            "invalid transfer maxDailyDrawdown")
    for name in ("requireEachWindowPositive", "requireDevelopmentQualified"):
        require(type(settings[name]) is bool, f"invalid transfer {name}")
    require(all(isinstance(settings[k], str) and settings[k] for k in ("method", "acceptance")),
            "transfer method and acceptance descriptions are required")
    require(isinstance(plan.get("baseline"), str), "transfer requires a declared baseline")
    return settings


def leave_one_symbol_out(plan, batches, candidate):
    """Describe each original fixed-sleeve omission without reallocating capital."""
    selected, portfolio, initial, curves = account_series(plan, batches, candidate)
    # Remove a fixed sleeve with its original allocation. Do not redistribute
    # capital, re-execute trades, or rank/select the remaining coins.
    omitted = {}
    if len(selected) > 1:
        sleeve_initial = initial / len(selected)
        for index, (symbol, _) in enumerate(selected):
            curve = [{"time": point["time"], "equity": point["equity"] - curves[index][i]["equity"]}
                     for i, point in enumerate(portfolio)]
            values = current_returns(curve, initial - sleeve_initial)
            omitted[symbol] = (statistics.mean(values)
                               if all(value is not None and math.isfinite(value) for value in values) else None)
    return omitted


def acceptance(settings, windows, pooled, intervals, development_qualified):
    checks = []

    def record(name, passed, actual, threshold):
        checks.append({"criterion": name, "passed": bool(passed), "actual": actual, "threshold": threshold})

    if settings["requireDevelopmentQualified"]:
        record("development-qualified", development_qualified is True, development_qualified, True)
    record("minimum-transfer-days", pooled["days"] >= settings["minimumDays"], pooled["days"], settings["minimumDays"])
    for cost in ("base", "stress"):
        value = pooled[cost]
        record(f"{cost}:minimum-trades", value["trades"] >= settings["minimumTrades"],
               value["trades"], settings["minimumTrades"])
        for symbol, count in value["tradesBySymbol"].items():
            record(f"{cost}:minimum-trades:{symbol}", count >= settings["minimumTradesPerSymbol"],
                   count, settings["minimumTradesPerSymbol"])
        for window in windows:
            result = window["accounts"]["selectedBase" if cost == "base" else "selectedStress"]
            if settings["requireEachWindowPositive"]:
                record(f"{cost}:{window['id']}:positive-return", result["return"] > 0, result["return"], ">0")
            record(f"{cost}:{window['id']}:daily-drawdown", result["dailyMaxDrawdown"] >= -settings["maxDailyDrawdown"],
                   result["dailyMaxDrawdown"], -settings["maxDailyDrawdown"])
        for interval in intervals:
            key = "selectedBase" if cost == "base" else "selectedStress"
            lower = interval["absolute"][key]["meanDailyReturn95CI"][0]
            record(f"{cost}:block{interval['blockDays']}:absolute-lower-bound", lower > 0, lower, ">0")
    failed = [row["criterion"] for row in checks if not row["passed"]]
    return {"status": "not-established" if failed else "passed-for-forward-observation",
            "checks": checks, "failedCriteria": failed,
            "meaning": "Historical transfer evidence only; no guarantee of future profitability, reselection, or automatic deployment."}


def evaluate(plan, selection, batches_by_window, development_summary=None, *, selection_source=None):
    """Pure evaluation of already audited batches; frozen choice is never ranked."""
    settings = settings_for(plan)
    require(type(selection.get("developmentQualified")) is bool, "selection lacks frozen development qualification")
    inherited = plan.get("selectionMode") == "inherited"
    if inherited:
        require(isinstance(selection_source, dict) and development_summary is None,
                "inherited transfer requires audited source-domain selection, not a target development summary")
        source = selection_source
        require(selection.get("selectionMode") == "inherited" and selection.get("objective") == "inherited"
                and selection.get("qualificationScope") == "source-domain",
                "inherited selection must retain its source-domain qualification")
        require(selection["id"] == plan.get("fixedCandidate") == source["selection"]["id"]
                == source["developmentSummary"].get("id"), "inherited selected identity differs from source")
        require(selection.get("selectionSource") == source["identity"]
                and all(source["identity"].get(key) == value for key, value in plan["selectionSource"].items()),
                "inherited selection source identity differs from the frozen declaration")
        # The source plan owns this qualification. The target symbols and its
        # observed returns must never enter the development eligibility check.
        qualification = fixed_qualification(source["plan"], source["developmentSummary"])
        require(qualification == source["qualification"] == selection.get("developmentQualification")
                and source["selection"].get("developmentQualified") is selection["developmentQualified"],
                "inherited development qualification differs from audited source")
    else:
        require(selection_source is None, "ordinary transfer cannot substitute an external qualification")
        require(isinstance(development_summary, dict) and development_summary.get("id") == selection["id"],
                "development summary differs from frozen choice")
        qualification = fixed_qualification(plan, development_summary)
    require((qualification["status"] == "passed") == selection["developmentQualified"],
            "recorded development qualification disagrees with its frozen summary")
    require(set(settings["windows"]) <= set(batches_by_window), "missing declared transfer window; no partial evaluation")
    selected, baseline = selection["id"], plan["baseline"]
    candidates = {"selectedBase": selected, "baselineBase": baseline,
                  "selectedStress": selected + "-stress", "baselineStress": baseline + "-stress"}
    windows, sampled, omitted_rows = [], [], []
    pooled = {"days": 0, **{cost: {"trades": 0, "netPnl": 0.0, "sumNetR": 0.0,
                                  "tradesBySymbol": {symbol: 0 for symbol in plan["symbols"]}}
                            for cost in ("base", "stress")}}
    contract = None
    for window_id in settings["windows"]:
        window = next(w for w in plan["windows"] if w["id"] == window_id)
        batches = batches_by_window[window_id]
        current = evaluation_contract(batches)
        require(contract is None or current == contract, "mixed evaluation versions across transfer windows")
        contract = current
        require(all(len([r for r in batch["results"] if r["id"] == candidate]) == 1
                    for batch in batches for candidate in set(candidates.values())),
                f"missing or duplicated selected/baseline cost result: {window_id}")
        accounts, returns, leave_out, times = {}, {}, {}, None
        for key, candidate in candidates.items():
            accounts[key], series = account_window(plan, batches, candidate, window)
            leave_out[key] = leave_one_symbol_out(plan, batches, candidate)
            require(times is None or times == series["times"], "candidate/cost dates differ")
            times, returns[key] = series["times"], series["returns"]
        windows.append({"id": window_id, "role": window.get("role"), "start": window["start"],
                        "end": window["end"], "accounts": accounts})
        sampled.append({"id": window_id, "times": times, "returns": returns})
        omitted_rows.append({"window": window_id, "days": len(times), "meanDailyReturn": leave_out})
        pooled["days"] += len(times)
        for cost, key in [("base", "selectedBase"), ("stress", "selectedStress")]:
            value, aggregate = accounts[key], pooled[cost]
            aggregate["trades"] += value["trades"]
            aggregate["netPnl"] += value["netPnl"]
            aggregate["sumNetR"] += (value["meanNetR"] or 0) * value["trades"]
            for symbol, count in value["tradesBySymbol"].items():
                aggregate["tradesBySymbol"][symbol] += count
    for cost in ("base", "stress"):
        value = pooled[cost]
        n = value["trades"]
        value["netExpectancy"] = value["netPnl"] / n if n else None
        value["meanNetR"] = value.pop("sumNetR") / n if n else None
    intervals = [paired_bootstrap(sampled, SERIES, PAIRS, settings["samples"], block, settings["seed"])
                 for block in settings["blockDays"]]
    leave_out = {key: {symbol: None if any(row["meanDailyReturn"][key].get(symbol) is None for row in omitted_rows)
                      else sum(row["meanDailyReturn"][key][symbol] * row["days"] for row in omitted_rows) / pooled["days"]
                      for symbol in plan["symbols"]} for key in SERIES}
    result = {"version": INHERITED_VERSION if inherited else VERSION, "protocol": settings, "selected": selected, "baseline": baseline,
            "selectionRecomputed": False, "developmentQualified": selection["developmentQualified"],
            "developmentQualification": qualification, "windows": windows, "pooled": pooled,
            "bootstrap": intervals, "leaveOneSymbolOut": {"windows": omitted_rows, "pooledMeanDailyReturn": leave_out,
                "scope": "Descriptive account daily means after omitting one original fixed sleeve; no capital redistribution, rerun, selection, or acceptance criterion."},
            "acceptance": acceptance(settings, windows, pooled, intervals, selection["developmentQualified"]),
            "conventions": {"returnUnit": "fraction", "calendar": "UTC", "poolWeight": "observation-days",
                "drawdownSampling": "daily-close", "windowCapital": "independent-reset",
                "bootstrapPairing": "same within-window date indices for all sleeves, candidates and costs",
                "interval": "95% percentile, sorted ranks floor(samples*.025) and floor(samples*.975)",
                "singleSleeveEvaluationVersion": contract},
            "limitations": ["Retrospective historical transfer, not prospective or live evidence.",
                "No cross-window blocks, gap filling or chained NAV. Longer windows receive proportionally more weight.",
                "Intervals describe the frozen choice; they do not correct all earlier adaptive research trials or prove stationarity.",
                "Trade net-R and dollar expectancy are ledger descriptions, not independent-trade inference. Paired improvement cannot replace absolute profitability."]}
    if inherited:
        source_symbols = selection_source["identity"]["sourceSymbols"]
        target_symbols = list(plan["symbols"])
        result.update(qualificationScope="source-domain", selectionSource=selection_source["identity"],
                      targetDomain={"symbols": target_symbols, "sourceSymbols": source_symbols,
                          "disjointSymbols": not set(source_symbols).intersection(target_symbols),
                          "timeIndependenceClaim": False, "prospective": False})
        result["limitations"].extend([
            "Development qualification belongs only to the recorded source universe and dates; no development ranking or qualification is fitted to the target symbols.",
            "Disjoint, previously untested symbols provide a cross-symbol historical holdout, not independent-time, prospective or live validation. They share already-known calendar regimes and crypto market dependence.",
            "Passing this transfer criterion does not revise the source study's recorded conclusion or correct its prior search multiplicity. No target result can replace the frozen selected rule."])
    return result


def run(args):
    ensure_writable(args.output)
    require(not args.output.exists(), "transfer evaluation already exists; choose a new output file")
    require(args.input.resolve() not in args.output.resolve().parents and args.input.resolve() != args.output.resolve(),
            "transfer output must be outside the raw run directory")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    settings = settings_for(evidence["plan"])
    for window in evidence["plan"]["windows"]:
        for symbol in evidence["plan"]["symbols"]:
            path = args.input / window["id"] / f"{symbol}.json"
            require(path.exists(), f"incomplete study: missing {window['id']}/{symbol}; no partial transfer evaluation")
    identity = evaluation_identity(evidence)
    transfer, provenance, contract = {}, [], None
    for window in evidence["plan"]["windows"]:
        batches, records = audit_window(evidence, window)
        current = evaluation_contract(batches)
        require(contract is None or current == contract, "mixed study evaluation versions")
        contract = current
        provenance.extend(records)
        if window["id"] in settings["windows"]:
            transfer[window["id"]] = batches
    inherited = evidence["plan"].get("selectionMode") == "inherited"
    if inherited:
        source = evidence["selectionSource"]
        result = evaluate(evidence["plan"], evidence["selection"], transfer, selection_source=source)
    else:
        development = development_window(evidence["plan"])
        stored = read(args.input / f"{development['id']}-summary.json")
        chosen = [row for row in stored if row["id"] == evidence["selection"]["id"]]
        require(len(chosen) == 1, "development summary must contain the frozen choice exactly once")
        result = evaluate(evidence["plan"], evidence["selection"], transfer, chosen[0])
    result.update(evaluationIdentity=identity, engine=evidence["engine"], selection=evidence["selection"],
                  generatorSha256=source_fingerprint(*SOURCES),
                  transferSourceSha256=sha(__file__), provenance=provenance,
                  auditScope="Recorded receipts/configurations, complete canonical daily calendars and cash ledgers; no new price reads or source CSV rehash.")
    require(evaluation_identity(evidence) == identity and sha(args.plan) == evidence["planSha256"]
            and sha(args.manifest) == evidence["manifestSha256"], "evidence changed during transfer evaluation")
    if inherited:
        require(resolve_selection_source(evidence["plan"])["identity"] == source["identity"],
                "source evidence changed during transfer evaluation")
    write_once(args.output, result)
    print({"output": str(args.output), "selected": result["selected"], "status": result["acceptance"]["status"],
           "failedCriteria": result["acceptance"]["failedCriteria"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
