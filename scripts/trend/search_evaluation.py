"""Audit a declared search with paired, least-favorable block max-mean diagnostics."""
import argparse
import math
from pathlib import Path
import random

from artifacts import audit_window, ensure_writable, evaluation_identity, load_evidence, read, sha, source_fingerprint, write_once
from evaluation import evaluation_contract, fixed_qualification
from protocol import DAY, development_window, is_development, timestamp
from account_statistics import account_window, circular_indices, identifiers, require

VERSION = "trend-search-evaluation-1"
SOURCES = ("search_evaluation.py", "account_statistics.py",
           "evaluation.py", "artifacts.py", "daily.py", "protocol.py", "warmup.py")
REFERENCE = "https://doi.org/10.1111/1468-0262.00152"
COSTS = ("base", "stress")


def settings_for(plan):
    settings = plan.get("searchEvaluation")
    fields = {"windows", "samples", "seed", "blockDays", "method", "acceptance", "minimumDays",
              "minimumTrades", "minimumTradesPerSymbol", "maxDailyDrawdown", "alpha",
              "requireEachWindowPositive", "requireDevelopmentQualified"}
    require(isinstance(settings, dict) and set(settings) == fields,
            "searchEvaluation must contain exactly the supported frozen protocol fields")
    candidates = [candidate["id"] for candidate in plan["candidates"]]
    identifiers(candidates, "search candidates")
    require(len(candidates) <= 32, "search evaluation supports at most 32 declared candidates")
    require(plan.get("baseline") in candidates, "search baseline must be a declared candidate")
    require(len({name + suffix for name in candidates for suffix in ("", "-stress")}) == len(candidates) * 2,
            "declared search candidate and generated stress ids collide")
    identifiers(settings["windows"], "search windows")
    identifiers([window["id"] for window in plan["windows"]], "window ids")
    declared = {window["id"]: window for window in plan["windows"]}
    require(set(settings["windows"]) <= set(declared), "search window is missing from the plan")
    development = development_window(plan)
    dev_start, dev_end = timestamp(development["start"]), timestamp(development["end"])
    windows = [declared[name] for name in settings["windows"]]
    require(all(not is_development(window) for window in windows), "development cannot enter search validation")
    intervals = sorted((timestamp(window["start"]), timestamp(window["end"])) for window in windows)
    require(all(start % DAY == 0 and end % DAY == 0 and end > start for start, end in intervals)
            and all(left[1] <= right[0] for left, right in zip(intervals, intervals[1:])),
            "search windows require non-overlapping complete UTC dates")
    require(all(end <= dev_start or start >= dev_end for start, end in intervals),
            "search validation dates overlap development")
    for field in ("samples", "minimumDays", "minimumTrades", "minimumTradesPerSymbol"):
        require(type(settings[field]) is int and settings[field] > 0, f"invalid search {field}")
    require(type(settings["seed"]) is int, "invalid search seed")
    blocks = settings["blockDays"]
    require(isinstance(blocks, list) and blocks and all(type(value) is int and value > 0 for value in blocks)
            and len(blocks) == len(set(blocks)), "blockDays must contain unique positive integers")
    for field in ("maxDailyDrawdown", "alpha"):
        require(type(settings[field]) in (int, float) and math.isfinite(settings[field])
                and 0 < settings[field] < 1, f"invalid search {field}")
    for field in ("requireEachWindowPositive", "requireDevelopmentQualified"):
        require(type(settings[field]) is bool, f"invalid search {field}")
    require(all(isinstance(settings[field], str) and settings[field].strip() for field in ("method", "acceptance")),
            "search method and acceptance descriptions are required")
    return settings


def pointwise(values, mean):
    ordered = sorted(values)
    count = len(ordered)
    return {"meanDailyReturn": mean,
            "meanDailyReturn95CI": [ordered[int(count * .025)], ordered[min(count - 1, int(count * .975))]]}


def max_mean_family(means, samples, days):
    """Single-step, unstudentized max test; every declared series is centered."""
    require(means and len(means) == len(samples), "max family requires aligned nonempty series")
    count = len(samples[0])
    require(count > 0 and all(len(values) == count for values in samples), "max family resamples differ")
    require(days > 0 and all(math.isfinite(value) for value in means)
            and all(math.isfinite(value) for values in samples for value in values),
            "max family requires finite means and samples")
    scale = math.sqrt(days)
    observed = [scale * max(0.0, value) for value in means]
    null = [max(0.0, max(scale * (samples[index][b] - means[index]) for index in range(len(means))))
            for b in range(count)]

    def probability(statistic):
        # Treat machine-precision ties conservatively. This is far below one
        # basis point; it avoids turning exact equal series into false evidence.
        return (1 + sum(value >= statistic or math.isclose(value, statistic, rel_tol=1e-12, abs_tol=1e-14)
                        for value in null)) / (count + 1)

    return {"seriesCount": len(means), "globalStatistic": max(observed),
            "globalPValue": probability(max(observed)),
            "rows": [{"statistic": statistic, "adjustedPValue": probability(statistic)} for statistic in observed]}


def bootstrap(windows, candidates, baseline, samples, block, seed):
    """Preserve window lengths; all candidate/cost series share every date draw."""
    identifiers(candidates, "bootstrap candidates")
    require(baseline in candidates and windows, "bootstrap needs windows and a declared baseline")
    require(type(samples) is int and samples > 0 and type(block) is int and block > 0
            and type(seed) is int, "invalid search bootstrap settings")
    keys = [(candidate, cost) for candidate in candidates for cost in COSTS]
    prepared, days = [], 0
    for window in windows:
        n = len(window["times"])
        require(n > 0 and set(window["returns"]) == set(candidates), "bootstrap candidate set is incomplete")
        require(all(set(window["returns"][candidate]) == set(COSTS) for candidate in candidates),
                "bootstrap requires both cost scenarios")
        columns = [window["returns"][candidate][cost] for candidate, cost in keys]
        require(all(len(values) == n for values in columns), "bootstrap candidate/cost calendars differ")
        require(all(type(value) in (int, float) and math.isfinite(value) for values in columns for value in values),
                "bootstrap cannot omit undefined daily returns")
        # A doubled prefix sum makes a circular block sum O(1). Date indices
        # still come from the existing sampler, preserving its exact RNG order.
        prefixes = []
        for values in columns:
            prefix = [0.0]
            for value in [*values, *values]:
                prefix.append(prefix[-1] + value)
            prefixes.append(prefix)
        prepared.append((n, columns, prefixes))
        days += n
    means = [math.fsum(value for _, columns, _ in prepared for value in columns[index]) / days
             for index in range(len(keys))]
    estimates = [[] for _ in keys]
    rng = random.Random(seed)
    for _ in range(samples):
        totals = [0.0] * len(keys)
        for n, _, prefixes in prepared:
            chosen = circular_indices(n, block, rng)
            chunks = [(chosen[offset], min(block, n - offset)) for offset in range(0, n, block)]
            for index, prefix in enumerate(prefixes):
                totals[index] += math.fsum(prefix[start + size] - prefix[start] for start, size in chunks)
        for index, total in enumerate(totals):
            estimates[index].append(total / days)
    cash = max_mean_family(means, estimates, days)
    references = {cost: keys.index((baseline, cost)) for cost in COSTS}
    increments = [index for index, (candidate, _) in enumerate(keys) if candidate != baseline]
    differences = [means[index] - means[references[keys[index][1]]] for index in increments]
    difference_samples = [[a - b for a, b in zip(estimates[index], estimates[references[keys[index][1]]])]
                          for index in increments]
    relative = max_mean_family(differences, difference_samples, days) if increments else {
        "seriesCount": 0, "globalStatistic": None, "globalPValue": None, "rows": []}
    incremental_rows = {index: (mean, values, row) for index, mean, values, row
                        in zip(increments, differences, difference_samples, relative["rows"])}
    rows = {candidate: {} for candidate in candidates}
    for index, (candidate, cost) in enumerate(keys):
        if candidate == baseline:
            comparison = {"meanDailyReturn": 0.0, "meanDailyReturn95CI": [0.0, 0.0],
                          "statistic": 0.0, "adjustedPValue": None, "includedInFamily": False}
        else:
            mean, values, adjusted = incremental_rows[index]
            comparison = {**pointwise(values, mean), **adjusted, "includedInFamily": True}
        rows[candidate][cost] = {"absolute": {**pointwise(estimates[index], means[index]), **cash["rows"][index]},
                                 "relativeToBaseline": comparison}
    return {"blockDays": block, "samples": samples, "seed": seed, "days": days, "candidates": rows,
            "families": {"cash": {key: value for key, value in cash.items() if key != "rows"},
                         "baselineIncremental": {key: value for key, value in relative.items() if key != "rows"}}}


def acceptance(settings, selected, windows, pooled, intervals, qualified):
    checks = []

    def record(criterion, passed, actual, threshold):
        checks.append({"criterion": criterion, "passed": bool(passed), "actual": actual, "threshold": threshold})

    if settings["requireDevelopmentQualified"]:
        record("development-qualified", qualified is True, qualified, True)
    record("minimum-validation-days", pooled["days"] >= settings["minimumDays"], pooled["days"], settings["minimumDays"])
    for cost in COSTS:
        account = pooled["candidates"][selected][cost]
        record(f"{cost}:minimum-trades", account["trades"] >= settings["minimumTrades"], account["trades"], settings["minimumTrades"])
        for symbol, count in account["tradesBySymbol"].items():
            record(f"{cost}:minimum-trades:{symbol}", count >= settings["minimumTradesPerSymbol"], count, settings["minimumTradesPerSymbol"])
        for window in windows:
            value = window["accounts"][selected][cost]
            if settings["requireEachWindowPositive"]:
                record(f"{cost}:{window['id']}:positive-return", value["return"] > 0, value["return"], ">0")
            record(f"{cost}:{window['id']}:daily-drawdown", value["dailyMaxDrawdown"] >= -settings["maxDailyDrawdown"],
                   value["dailyMaxDrawdown"], -settings["maxDailyDrawdown"])
        for interval in intervals:
            value = interval["candidates"][selected][cost]["absolute"]
            lower, probability = value["meanDailyReturn95CI"][0], value["adjustedPValue"]
            record(f"{cost}:block{interval['blockDays']}:absolute-lower-bound", lower > 0, lower, ">0")
            record(f"{cost}:block{interval['blockDays']}:selected-cash-adjusted-p", probability <= settings["alpha"],
                   probability, settings["alpha"])
    failed = [row["criterion"] for row in checks if not row["passed"]]
    return {"status": "not-established" if failed else "historical-criteria-passed", "checks": checks,
            "failedCriteria": failed,
            "meaning": "Known-history research only, not new out-of-sample or live evidence; no reselection, automatic deployment or guarantee."}


def evaluate(plan, selection, batches_by_window, development_summary):
    settings = settings_for(plan)
    candidates = [candidate["id"] for candidate in plan["candidates"]]
    selected, baseline = selection["id"], plan["baseline"]
    require(selected in candidates and development_summary.get("id") == selected,
            "development summary differs from the frozen selected candidate")
    require(type(selection.get("developmentQualified")) is bool, "selection lacks development qualification")
    qualification = fixed_qualification(plan, development_summary)
    require((qualification["status"] == "passed") == selection["developmentQualified"],
            "recorded development qualification disagrees with frozen summary")
    require(set(settings["windows"]) <= set(batches_by_window), "missing declared search window; no partial evaluation")
    declared = {window["id"]: window for window in plan["windows"]}
    windows, sampled, contract = [], [], None
    pooled = {"days": 0, "candidates": {candidate: {cost: {"trades": 0, "netPnl": 0.0, "sumNetR": 0.0,
              "tradesBySymbol": {symbol: 0 for symbol in plan["symbols"]}} for cost in COSTS} for candidate in candidates}}
    for name in settings["windows"]:
        window, batches = declared[name], batches_by_window[name]
        current = evaluation_contract(batches)
        require(contract is None or current == contract, "mixed evaluation versions across search windows")
        contract = current
        ids = [candidate + suffix for candidate in candidates for suffix in ("", "-stress")]
        require(all(sum(row["id"] == candidate for row in batch["results"]) == 1
                    for batch in batches for candidate in ids), f"missing or duplicated search candidate/cost result: {name}")
        accounts, returns, times = {}, {}, None
        for candidate in candidates:
            accounts[candidate], returns[candidate] = {}, {}
            for cost, suffix in (("base", ""), ("stress", "-stress")):
                account, daily = account_window(plan, batches, candidate + suffix, window)
                require(times is None or times == daily["times"], "search candidate/cost calendars differ")
                times = daily["times"]
                accounts[candidate][cost], returns[candidate][cost] = account, daily["returns"]
                total = pooled["candidates"][candidate][cost]
                total["trades"] += account["trades"]
                total["netPnl"] += account["netPnl"]
                total["sumNetR"] += (account["meanNetR"] or 0) * account["trades"]
                for symbol, count in account["tradesBySymbol"].items():
                    total["tradesBySymbol"][symbol] += count
        pooled["days"] += len(times)
        windows.append({"id": name, "role": window.get("role"), "start": window["start"], "end": window["end"],
                        "days": len(times), "accounts": accounts})
        sampled.append({"times": times, "returns": returns})
    for account in pooled["candidates"].values():
        for value in account.values():
            count = value["trades"]
            value["netExpectancy"] = value["netPnl"] / count if count else None
            total_r = value.pop("sumNetR")
            value["meanNetR"] = total_r / count if count else None
    intervals = [bootstrap(sampled, candidates, baseline, settings["samples"], block, settings["seed"])
                 for block in settings["blockDays"]]
    verdict = acceptance(settings, selected, windows, pooled, intervals, selection["developmentQualified"])
    return {"version": VERSION, "status": verdict["status"], "protocol": settings, "selected": selected,
            "baseline": baseline, "selectionRecomputed": False, "developmentQualified": selection["developmentQualified"],
            "developmentQualification": qualification, "windows": windows, "pooled": pooled, "bootstrap": intervals,
            "selectedSummary": {"id": selected, "pooled": pooled["candidates"][selected],
                "bootstrap": [{"blockDays": row["blockDays"], **row["candidates"][selected]} for row in intervals]},
            "acceptance": verdict,
            "conventions": {"returnUnit": "fraction", "calendar": "UTC", "poolWeight": "observation-days",
                "drawdownSampling": "daily-close", "windowCapital": "independent-reset",
                "bootstrapPairing": "same within-window date indices for all candidates, costs and both null families",
                "interval": "Pointwise 95% percentile, sorted ranks floor(samples*.025) and floor(samples*.975); not simultaneous bands.",
                "singleSleeveEvaluationVersion": contract, "cashBenchmarkDailyReturn": 0,
                "statistic": "sqrt(N) * max(0, mean); unstudentized, N is total validation days",
                "nullStatistic": "max(0, max_j sqrt(N) * (bootstrapMean_j - observedMean_j)); center every series at zero",
                "adjustedPValue": "(1 + count(nullMax >= observedIndividual)) / (samples + 1)",
                "globalPValue": "(1 + count(nullMax >= observedFamilyMax)) / (samples + 1)",
                "ties": "Conservative math.isclose rel_tol=1e-12, abs_tol=1e-14 on scaled statistics",
                "cashFamily": "all declared candidates x base/stress, including development-ineligible rules",
                "incrementalFamily": "non-baseline candidates x base/stress minus baseline at the same cost"},
            "method": {"name": "White-inspired least-favorable centered circular-block max-mean diagnostic", "reference": REFERENCE},
            "limitations": ["All validation history is already known; the procedure cannot undo prior adaptive design or project-wide searches.",
                "This is an unstudentized least-favorable max test, not SPA, DSR, a stepdown procedure or an exact finite-sample test.",
                "Weak-dependence/stability assumptions within windows are not established. Fixed window-stratified circular blocks differ from White's original stationary-bootstrap implementation.",
                "High-variance or poor candidates can make this max test conservative; none are removed after viewing validation results.",
                "Cash and incremental families and both block lengths are reported separately, without a joint-family significance claim. Global rejection does not certify the frozen selected rule.",
                "Only the selected rule's absolute lower bounds and selected cash-family adjusted p-values enter historical acceptance; baseline increments are descriptive.",
                "Per-window resets are not a continuous investment record. Complete account differences include changed positions, risk states and subsequent entries."]}


def run(args):
    ensure_writable(args.output)
    require(not args.output.exists(), "search evaluation already exists; choose a new output file")
    require(args.input.resolve() not in args.output.resolve().parents and args.input.resolve() != args.output.resolve(),
            "search output must be outside the raw run directory")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    settings = settings_for(evidence["plan"])
    for window in evidence["plan"]["windows"]:
        for symbol in evidence["plan"]["symbols"]:
            require((args.input / window["id"] / f"{symbol}.json").exists(),
                    f"incomplete study: missing {window['id']}/{symbol}; no partial search evaluation")
    identity, generator = evaluation_identity(evidence), source_fingerprint(*SOURCES)
    retained, provenance, contract = {}, [], None
    for window in evidence["plan"]["windows"]:
        batches, records = audit_window(evidence, window)
        current = evaluation_contract(batches)
        require(contract is None or contract == current, "mixed study evaluation versions")
        contract = current
        provenance.extend(records)
        if window["id"] in settings["windows"]:
            retained[window["id"]] = batches
    development = development_window(evidence["plan"])
    stored = read(args.input / f"{development['id']}-summary.json")
    chosen = [row for row in stored if row["id"] == evidence["selection"]["id"]]
    require(len(chosen) == 1, "development summary must contain the frozen choice exactly once")
    result = evaluate(evidence["plan"], evidence["selection"], retained, chosen[0])
    result.update(evaluationIdentity=identity, engine=evidence["engine"], selection=evidence["selection"],
                  generatorSha256=generator, searchSourceSha256=sha(__file__), provenance=provenance,
                  auditScope="All recorded receipts/configurations, canonical daily calendars and cash ledgers; no new price reads or source CSV rehash.")
    require(evaluation_identity(evidence) == identity and sha(args.plan) == evidence["planSha256"]
            and sha(args.manifest) == evidence["manifestSha256"] and source_fingerprint(*SOURCES) == generator,
            "evidence or evaluation source changed during search evaluation")
    write_once(args.output, result)
    print({"output": str(args.output), "selected": result["selected"],
           "status": result["status"], "failedCriteria": result["acceptance"]["failedCriteria"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
