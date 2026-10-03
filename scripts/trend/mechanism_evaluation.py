"""Describe frozen mechanism contrasts with paired blocks; never rank or select."""
import argparse
from pathlib import Path

from artifacts import audit_window, ensure_writable, evaluation_identity, load_evidence, sha, source_fingerprint, write_once
from evaluation import evaluation_contract
from protocol import DAY, development_window, is_development, timestamp
from account_statistics import account_window, identifiers, paired_bootstrap, require

VERSION = "trend-mechanism-evaluation-1"
SOURCES = ("mechanism_evaluation.py", "account_statistics.py", "evaluation.py",
           "artifacts.py", "daily.py", "protocol.py", "warmup.py")


def settings_for(plan):
    settings = plan.get("mechanismEvaluation")
    require(isinstance(settings, dict)
            and set(settings) == {"primary", "groups", "samples", "seed", "blockDays", "method"},
            "mechanismEvaluation must contain exactly the supported frozen protocol fields")
    primary = settings["primary"]
    declared_candidates = [candidate["id"] for candidate in plan["candidates"]]
    identifiers(declared_candidates, "candidate ids")
    require(isinstance(primary, str) and primary in declared_candidates,
            "mechanism primary must name a declared candidate")
    require(plan.get("selectionMode") == "fixed" and plan.get("fixedCandidate") == primary,
            "mechanism evaluation requires the predeclared fixed primary; no ranking")
    require(type(settings["samples"]) is int and settings["samples"] > 0, "invalid mechanism samples")
    require(type(settings["seed"]) is int, "invalid mechanism seed")
    blocks = settings["blockDays"]
    require(isinstance(blocks, list) and blocks and all(type(b) is int and b > 0 for b in blocks)
            and len(blocks) == len(set(blocks)), "blockDays must contain unique positive integers")
    require(isinstance(settings["method"], str) and settings["method"].strip(),
            "mechanism method description is required")
    declared_windows = {window["id"]: window for window in plan["windows"]}
    identifiers([window["id"] for window in plan["windows"]], "window ids")
    development = development_window(plan)
    dev_start, dev_end = timestamp(development["start"]), timestamp(development["end"])
    groups = settings["groups"]
    require(isinstance(groups, list) and groups
            and all(isinstance(group, dict) and set(group) == {"id", "windows"} for group in groups),
            "mechanism groups require exactly id and windows")
    identifiers([group["id"] for group in groups], "group ids")
    for group in groups:
        identifiers(group["windows"], f"group {group['id']} windows")
        require(set(group["windows"]) <= set(declared_windows), "mechanism window is missing from the plan")
        windows = [declared_windows[name] for name in group["windows"]]
        require(all(not is_development(window) for window in windows),
                "development cannot be a mechanism evaluation window")
        intervals = sorted((timestamp(window["start"]), timestamp(window["end"])) for window in windows)
        require(all(start % DAY == 0 and end % DAY == 0 and end > start for start, end in intervals)
                and all(left[1] <= right[0] for left, right in zip(intervals, intervals[1:])),
                "mechanism group windows require non-overlapping complete UTC dates")
        require(all(end <= dev_start or start >= dev_end for start, end in intervals),
                "mechanism evaluation dates overlap the development period")
    comparisons = plan.get("comparisons")
    require(isinstance(comparisons, list) and comparisons
            and all(isinstance(value, dict) and {"id", "candidate", "reference"} <= set(value)
                    for value in comparisons), "mechanism comparisons are required")
    identifiers([value["id"] for value in comparisons], "comparison ids")
    identifiers([value["candidate"] for value in comparisons], "comparison candidates")
    require(all(value["candidate"] in declared_candidates and value["candidate"] != primary
                and value["reference"] == primary for value in comparisons),
            "each mechanism comparison must contrast a declared candidate against the fixed primary")
    return settings


def contrast_bootstrap(windows, candidate, primary, samples, block, seed):
    # Paired means comparator minus primary. The same seed and window order
    # give every contrast identical date draws; labels stay local to this study.
    mapping = {"comparatorBase": (candidate, "base"), "primaryBase": (primary, "base"),
               "comparatorStress": (candidate, "stress"), "primaryStress": (primary, "stress")}
    sampled = [{"times": window["times"],
                "returns": {key: window["returns"][name][cost] for key, (name, cost) in mapping.items()}}
               for window in windows]
    pairs = {"base": ("comparatorBase", "primaryBase"), "stress": ("comparatorStress", "primaryStress")}
    result = paired_bootstrap(sampled, tuple(mapping), pairs, samples, block, seed)
    result["absolute"] = {
        "primary": {"base": result["absolute"]["primaryBase"], "stress": result["absolute"]["primaryStress"]},
        "comparator": {"base": result["absolute"]["comparatorBase"], "stress": result["absolute"]["comparatorStress"]}}
    return result


def evaluate(plan, batches_by_window):
    """Pure descriptive statistics on audited batches; no qualification gates."""
    settings = settings_for(plan)
    primary = settings["primary"]
    candidates = [primary, *[value["candidate"] for value in plan["comparisons"]]]
    required = {name for group in settings["groups"] for name in group["windows"]}
    require(required <= set(batches_by_window), "missing declared mechanism window; no partial evaluation")
    compact, series, contract = {}, {}, None
    for window in plan["windows"]:
        name = window["id"]
        if name not in required:
            continue
        batches = batches_by_window[name]
        current = evaluation_contract(batches)
        require(contract is None or contract == current, "mixed evaluation versions across mechanism windows")
        contract = current
        ids = [value + suffix for value in candidates for suffix in ("", "-stress")]
        require(all(sum(row["id"] == value for row in batch["results"]) == 1
                    for batch in batches for value in ids),
                f"missing or duplicated mechanism candidate/cost result: {name}")
        accounts, returns, times = {}, {}, None
        for candidate in candidates:
            accounts[candidate], returns[candidate] = {}, {}
            for cost, suffix in (("base", ""), ("stress", "-stress")):
                account, daily = account_window(plan, batches, candidate + suffix, window)
                require(times is None or times == daily["times"], "mechanism candidate/cost calendars differ")
                times = daily["times"]
                accounts[candidate][cost] = account
                returns[candidate][cost] = daily["returns"]
        compact[name] = {"id": name, "role": window.get("role"), "start": window["start"],
                         "end": window["end"], "days": len(times), "accounts": accounts}
        series[name] = {"times": times, "returns": returns}
    groups = []
    for group in settings["groups"]:
        sampled = [series[name] for name in group["windows"]]
        contrasts = [{**comparison, "bootstrap": [contrast_bootstrap(
            sampled, comparison["candidate"], primary, settings["samples"], block, settings["seed"])
            for block in settings["blockDays"]]} for comparison in plan["comparisons"]]
        groups.append({"id": group["id"], "days": sum(len(row["times"]) for row in sampled),
                       "windows": [compact[name] for name in group["windows"]], "comparisons": contrasts})
    return {"version": VERSION, "status": "descriptive-only", "primary": primary,
            "selectionRecomputed": False, "protocol": settings, "groups": groups,
            "conventions": {"returnUnit": "fraction", "calendar": "UTC", "poolWeight": "observation-days",
                "drawdownSampling": "daily-close", "windowCapital": "independent-reset",
                "pairedDifference": "comparator-minus-primary",
                "bootstrapPairing": "same within-window date indices for all sleeves, contrasts and costs",
                "interval": "95% percentile, sorted ranks floor(samples*.025) and floor(samples*.975)",
                "singleSleeveEvaluationVersion": contract},
            "limitations": ["Descriptive historical mechanism contrasts; no ranking, reselection or profitability acceptance gate.",
                "Each window resets its original capital. Blocks never cross windows or gaps; longer windows carry more day weight.",
                "Paired differences compare complete account paths, not identical entry opportunities or independent trades.",
                "Intervals do not correct the project's prior adaptive trials or establish future profitability."]}


def run(args):
    ensure_writable(args.output)
    require(not args.output.exists(), "mechanism evaluation already exists; choose a new output file")
    require(args.input.resolve() not in args.output.resolve().parents and args.input.resolve() != args.output.resolve(),
            "mechanism output must be outside the raw run directory")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    settings = settings_for(evidence["plan"])
    require(evidence["selection"]["id"] == settings["primary"], "frozen selection differs from mechanism primary")
    for window in evidence["plan"]["windows"]:
        for symbol in evidence["plan"]["symbols"]:
            require((args.input / window["id"] / f"{symbol}.json").exists(),
                    f"incomplete study: missing {window['id']}/{symbol}; no partial mechanism evaluation")
    identity = evaluation_identity(evidence)
    generator = source_fingerprint(*SOURCES)
    required = {name for group in settings["groups"] for name in group["windows"]}
    retained, provenance, contract = {}, [], None
    for window in evidence["plan"]["windows"]:
        batches, records = audit_window(evidence, window)
        current = evaluation_contract(batches)
        require(contract is None or current == contract, "mixed study evaluation versions")
        contract = current
        provenance.extend(records)
        if window["id"] in required:
            retained[window["id"]] = batches
    result = evaluate(evidence["plan"], retained)
    result.update(evaluationIdentity=identity, engine=evidence["engine"], selection=evidence["selection"],
                  generatorSha256=generator, mechanismSourceSha256=sha(__file__), provenance=provenance,
                  auditScope="All recorded study receipts/configurations, canonical daily calendars and cash ledgers; no new price reads or source CSV rehash.")
    require(evaluation_identity(evidence) == identity and sha(args.plan) == evidence["planSha256"]
            and sha(args.manifest) == evidence["manifestSha256"] and source_fingerprint(*SOURCES) == generator,
            "evidence or evaluation source changed during mechanism evaluation")
    write_once(args.output, result)
    print({"output": str(args.output), "primary": result["primary"], "status": result["status"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
