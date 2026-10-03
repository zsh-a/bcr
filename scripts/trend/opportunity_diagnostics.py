"""Fixed-horizon labels for the account-independent structured detector.

The detector retains each candidate's EMA/direction lifecycle. This consumes
recorded first breaks, not all market patterns, and does not simulate a portfolio.
No horizon or candidate is selected by these diagnostics.
"""
import argparse
from collections import Counter
import gzip
import json
import math
from pathlib import Path

import numpy as np

from artifacts import atomic_bytes, audit_window, load_evidence, read, sha, source_fingerprint, write_once
from breakout_study import first_hit, trading_candles, validate_minutes, wilder_atr
from details_audit import Sources, check, equal

MINUTE, PERIOD = 60_000, 30 * 60_000
SCOPE = "account-independent-current-detector"
FIXED = {"version": 1, "scope": SCOPE, "tradeMinutes": 30, "horizonsBars": [12, 48],
         "targetsR": [1, 2], "adverseR": 1, "ambiguity": "same-minute-unknown",
         "incomplete": "exclude", "entry": "next-minute-open-adverse-grid",
         "risk": "two-signal-atr-adverse-grid", "costPolicy": "same-as-account"}
DEPENDENCIES = ("opportunity_diagnostics.py", "details_audit.py", "literature_audit.py",
                "breakout_study.py", "artifacts.py", "daily.py", "protocol.py", "warmup.py", "download.py")


def validate_plan(plan, candidate_ids):
    for key, value in FIXED.items():
        check(plan.get(key) == value, f"opportunity protocol differs: {key}")
    contrasts = plan.get("contrasts", [])
    check(isinstance(contrasts, list) and len(contrasts) == 2, "two predeclared contrasts required")
    check(len({c["id"] for c in contrasts}) == len(contrasts), "duplicate contrast identity")
    for contrast in contrasts:
        check(isinstance(contrast["reference"], str) and isinstance(contrast["candidate"], str)
              and contrast["reference"] != contrast["candidate"], "invalid or self contrast")
    check(candidate_ids, "no declared candidates")


def grid(price, tick, up):
    return (math.ceil(price / tick - 1e-9) if up else math.floor(price / tick + 1e-9)) * tick


def fill(raw, side, execution, entry=True):
    buy = (side == "long") == entry
    slip = execution["slippageBps"] / 10000
    return grid(raw * (1 + slip if buy else 1 - slip), execution["tickSize"], buy)


def reference_entry(raw, atr, side, execution):
    check(side in ("long", "short") and raw > 0 and atr > 0, "invalid reference input")
    sign = 1 if side == "long" else -1
    entry = fill(raw, side, execution)
    stop = grid(entry - sign * 2 * atr, execution["tickSize"], side == "short")
    check(entry > 0 and stop > 0 and sign * (entry - stop) > 0, "invalid reference stop")
    return entry, stop, abs(entry - stop)


def barrier_hit(minutes, side, stop, target, tick):
    """Mirror short OHLC into long price order; the timestamp/phase is retained."""
    values = minutes
    if side == "short":
        values = minutes.copy()
        values[:, 1:5] = np.column_stack((-minutes[:, 1], -minutes[:, 3],
                                         -minutes[:, 2], -minutes[:, 4]))
        stop, target = -stop, -target
    return first_hit(values, stop, target, tick)


def cash_outcome(entry_raw, entry, exit_raw, side, distance, execution, funding_paid):
    """Per-unit attribution. Slippage is already in fills; never deduct twice."""
    sign = 1 if side == "long" else -1
    exited = fill(exit_raw, side, execution, entry=False)
    fees = (entry + exited) * execution["feeBps"] / 10000
    slippage = sign * (entry - entry_raw + exit_raw - exited)
    gross = sign * (exited - entry)
    return {"rawExitPrice": exit_raw, "exitPrice": exited,
            "grossBeforeCostsR": (gross + slippage) / distance,
            "grossFillR": gross / distance, "feesR": fees / distance,
            "slippageAndRoundingR": slippage / distance, "fundingR": funding_paid / distance,
            "netR": (gross - fees - funding_paid) / distance}


def label_opportunity(opportunity, minutes, marks, funding, execution, start, end):
    """Observe both complete forward windows, regardless of account exits/gates."""
    signal, side = opportunity["entrySignal"], opportunity["side"]
    time = signal["time"] + 1
    check(start <= signal["time"] < end and time % PERIOD == 0, "opportunity signal clock")
    check(side in ("long", "short"), "opportunity side")
    origin = int(minutes[0, 0])
    index = (time - origin) // MINUTE
    check(0 <= index <= len(minutes), "entry outside source calendar")
    result = {**opportunity, "entryTime": time, "horizons": {}}
    if time >= end:
        result["entryStatus"] = "sample-tail-no-entry"
        for length in FIXED["horizonsBars"]:
            result["horizons"][str(length)] = {"status": "tail-excluded"}
        return result
    check(index < len(minutes) and minutes[index, 0] == time, "missing next-minute entry")
    raw = float(minutes[index, 1])
    entry, stop, distance = reference_entry(raw, signal["atr"], side, execution)
    sign = 1 if side == "long" else -1
    result.update({"entryStatus": "reference-only", "entryRawPrice": raw, "entryPrice": entry,
                   "initialStop": stop, "initialPriceR": distance})

    def funding_to(exit_minute):
        paid = 0.0
        for event in funding:
            minute = event["time"] // MINUTE * MINUTE
            if time < minute <= exit_minute:
                mark_index = (minute - origin) // MINUTE
                check(0 <= mark_index < len(marks) and marks[mark_index, 0] == minute,
                      "funding mark minute missing")
                paid += sign * float(marks[mark_index, 1]) * event["rate"]
        return paid

    for length in FIXED["horizonsBars"]:
        until = time + length * PERIOD
        if until > end:
            result["horizons"][str(length)] = {"status": "tail-excluded"}
            continue
        path = minutes[index:index + length * 30]
        check(len(path) == length * 30 and path[-1, 0] == until - MINUTE,
              "complete horizon missing source minutes")
        validate_minutes(path)
        mfe = max(0., float(path[:, 2].max()) - entry if sign == 1 else entry - float(path[:, 3].min()))
        mae = max(0., entry - float(path[:, 3].min()) if sign == 1 else float(path[:, 2].max()) - entry)
        labels = {"status": "complete", "endTime": until, "mfeR": mfe / distance,
                  "maeR": mae / distance, "targets": {}, "fixedHorizon": cash_outcome(
                      raw, entry, float(path[-1, 4]), side, distance, execution, funding_to(until - MINUTE))}
        for target_r in FIXED["targetsR"]:
            target = entry + sign * target_r * distance
            hit = barrier_hit(path, side, stop, target, execution["tickSize"])
            label = {**hit, "targetPrice": target}
            if hit["status"] != "horizon-censored":
                minute = path[(hit["time"] - time) // MINUTE]
                paid = funding_to(hit["time"])
                if hit["status"] == "ambiguous":
                    label["outcomeBounds"] = {name: cash_outcome(raw, entry, value, side, distance, execution, paid)
                                               for name, value in (("stopFirst", stop), ("targetFirst", target))}
                else:
                    exit_raw = float(minute[1]) if hit["phase"] == "open" else (target if hit["status"] == "target" else stop)
                    label["outcome"] = cash_outcome(raw, entry, exit_raw, side, distance, execution, paid)
            labels["targets"][str(target_r)] = label
        result["horizons"][str(length)] = labels
    return result


def distribution(values):
    if not values:
        return {"count": 0, "mean": None, "p10": None, "median": None, "p90": None}
    return {"count": len(values), "mean": float(np.mean(values)),
            "p10": float(np.quantile(values, .1)), "median": float(np.median(values)),
            "p90": float(np.quantile(values, .9))}


def summarize_events(events):
    """Rates use all COMPLETE events, including censored and ambiguous ones."""
    result = {"firstBreaks": len(events), "screenPassed": sum(e["screenPassed"] for e in events),
              "gates": {key: sum(e["checks"][key] for e in events)
                        for key in ("retracement", "key", "shape", "candle")},
              "keyGeometry": {}, "horizons": {}}
    for kind in ("pivot", "ema"):
        values = [e.get("keyGeometry", {}).get(kind) for e in events]
        present = [v for v in values if v is not None]
        result["keyGeometry"][kind] = {"present": len(present), "missing": len(events) - len(present),
            **{key: sum(v[key] for v in present) for key in ("reachable", "valid", "retested")},
            **{key: distribution([v[key] for v in present]) for key in ("depth", "toleranceDepth")}}
    for length in FIXED["horizonsBars"]:
        subsets = {}
        for name, accepted in (("all", None), ("screenPassed", True), ("screenRejected", False)):
            subset = [e for e in events if accepted is None or e["screenPassed"] == accepted]
            complete = [e["horizons"][str(length)] for e in subset if e["horizons"][str(length)]["status"] == "complete"]
            count = len(complete)
            stats = {"firstBreaks": len(subset), "complete": count, "tailExcluded": len(subset) - count,
                     "mfeR": distribution([v["mfeR"] for v in complete]),
                     "maeR": distribution([v["maeR"] for v in complete]), "targets": {},
                     "fixedHorizon": {key: distribution([v["fixedHorizon"][key] for v in complete])
                                      for key in ("grossBeforeCostsR", "grossFillR", "feesR", "slippageAndRoundingR", "fundingR", "netR")}}
            for target in FIXED["targetsR"]:
                counts = Counter(v["targets"][str(target)]["status"] for v in complete)
                stats["targets"][str(target)] = {"counts": dict(counts),
                    "definiteTargetRate": counts["target"] / count if count else None,
                    "targetRateUpperBound": (counts["target"] + counts["ambiguous"]) / count if count else None}
            subsets[name] = stats
        result["horizons"][str(length)] = subsets
    return result


def identity(event):
    return (event["entrySignal"]["trigger"]["setupId"], event["side"], event["entrySignal"]["time"])


def compare_events(reference, candidate):
    left, right = ({identity(e): e for e in rows} for rows in (reference, candidate))
    check(len(left) == len(reference) and len(right) == len(candidate), "duplicate opportunity identity")
    common = left.keys() & right.keys()
    for key in common:
        for field in ("time", "price", "atr", "boundary"):
            equal(left[key]["entrySignal"][field], right[key]["entrySignal"][field], "matched opportunity signal")
        check(left[key]["horizons"] == right[key]["horizons"], "paired opportunity label differs")
    transitions = Counter(("pass" if left[k]["screenPassed"] else "fail") + "->" +
                          ("pass" if right[k]["screenPassed"] else "fail") for k in common)
    return {"referenceFirstBreaks": len(left), "candidateFirstBreaks": len(right), "matched": len(common),
            "referenceOnly": len(left.keys() - right.keys()), "candidateOnly": len(right.keys() - left.keys()),
            "screenTransitionsReferenceToCandidate": dict(transitions),
            "addedAccepted": summarize_events([right[k] for k in common if right[k]["screenPassed"] and not left[k]["screenPassed"]]),
            "removedAccepted": summarize_events([left[k] for k in common if left[k]["screenPassed"] and not right[k]["screenPassed"]])}


def declared_contrast(contrast, labeled):
    missing = [key for key in (contrast["reference"], contrast["candidate"]) if key not in labeled]
    if missing:
        return {**contrast, "status": "not-run", "missingCandidates": missing}
    return {**contrast, "status": "evaluated", **compare_events(labeled[contrast["reference"]], labeled[contrast["candidate"]])}


def audit_shared_market_set(observed):
    """The frozen EMA policies vary final gates/costs, never detector discovery."""
    check(observed, "empty observer results")
    base = observed[0]
    expected = {identity(e): tuple(e["entrySignal"][k] for k in ("time", "price", "atr", "boundary"))
                for e in base["opportunities"]}
    for row in observed[1:]:
        actual = {identity(e): tuple(e["entrySignal"][k] for k in ("time", "price", "atr", "boundary"))
                  for e in row["opportunities"]}
        check(actual == expected, "frozen policies differ in market opportunity identities or prices")
    return {"status": "passed", "reference": base["id"], "candidates": [r["id"] for r in observed],
            "sharedFirstBreaks": len(expected)}


def validate_observer(batch):
    observer = batch.get("opportunityDiagnostics")
    check(isinstance(observer, dict) and observer.get("version") == 1 and observer.get("scope") == SCOPE,
          "native account-independent observer is required")
    rows = {row["id"]: row for row in batch["results"]}
    observed = observer["results"]
    check(len(observed) == len(rows) and {r["id"] for r in observed} == rows.keys(), "observer candidate identity mismatch")
    for row in observed:
        account = rows[row["id"]]
        check(row["warmupStart"] == account["warmupStart"], "observer warmup differs")
        check(all(type(n) is int and n >= 0 for n in row["counts"].values()), "invalid observer counter")
        check(row["counts"].get("setup:sp-first-break", 0) == len(row["opportunities"]),
              "observer first-break counter differs from its ledger")
        check(row["counts"].get("setup:sp-accepted", 0) == sum(e["screenPassed"] for e in row["opportunities"]),
              "observer accepted counter differs from parallel checks")
        seen = set()
        previous = -1
        for event in row["opportunities"]:
            key = identity(event)
            check(key not in seen and key[-1] > previous, "duplicate/unordered first break")
            seen.add(key); previous = key[-1]
            check(set(event["checks"]) == {"retracement", "key", "shape", "candle"}
                  and all(type(v) is bool for v in event["checks"].values())
                  and type(event["screenPassed"]) is bool
                  and event["screenPassed"] == all(event["checks"].values()), "observer gate conjunction differs")
            signal = event["entrySignal"]
            check(signal["trigger"]["gates"] == event["checks"] and signal["trigger"]["kind"] == "structured-pullback",
                  "observer snapshot/checks mismatch")
            policy = account["config"]["strategy"]["structuredPullback"]
            check(signal["trigger"]["confirmation"] == policy["confirmation"]
                  and signal["trigger"]["keyRole"] == policy["keyRole"], "observer policy identity mismatch")
            trigger = signal["trigger"]
            sign = 1 if event["side"] == "long" else -1
            amplitude = sign * (trigger["impulseExtreme"] - trigger["impulseStartPrice"])
            check(amplitude > 0, "nonpositive frozen impulse amplitude")
            for kind, value in event["keyGeometry"].items():
                check(all(type(value[key]) is bool for key in ("reachable", "valid", "retested"))
                      and all(math.isfinite(value[key]) for key in ("price", "depth", "toleranceDepth"))
                      and value["toleranceDepth"] > 0, "invalid key geometry")
                source = trigger[kind]
                equal(value["price"], source["price" if kind == "pivot" else "value"], "key geometry source price")
                depth = sign * (trigger["impulseExtreme"] - value["price"]) / amplitude
                tolerance = .25 * trigger["referenceAtr"] / amplitude
                equal(value["depth"], depth, "key normalized depth")
                equal(value["toleranceDepth"], tolerance, "key normalized A0 tolerance")
                check(value["reachable"] == (depth+tolerance >= .2 and depth-tolerance <= .5)
                      and value["valid"] == source["valid"]
                      and value["retested"] == (source.get("retestTime") is not None), "key geometry/recorded state differs")
    return observed


def run(args):
    check(not args.output.exists(), "choose a new output path")
    events_path = args.output.with_suffix(".events.jsonl.gz")
    check(not events_path.exists(), "event output already exists")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    plan = read(args.opportunity_plan)
    validate_plan(plan, {c["id"] for c in evidence["plan"]["candidates"]})
    sources = Sources(evidence["manifest"])
    hashes = {name: sha(path) for name, path in (("plan", args.plan), ("manifest", args.manifest),
                                               ("opportunityPlan", args.opportunity_plan))}
    dependencies = source_fingerprint(*DEPENDENCIES)
    result = {"version": 1, "status": "passed", "scope": SCOPE, "inputSha256": hashes,
              "generatorSha256": sha(__file__), "dependenciesSha256": dependencies,
              "protocol": plan, "windows": {}, "receipts": [],
              "limitations": ["Observer retains the candidate EMA/direction lifecycle. Expired/invalidated setups are counts, not labeled first breaks; this is not all market breakouts.",
                  "Screen checks exclude holding, cooldown, daily/account limits, quantity/min-notional and entry cost gate. Reference fills are not executable portfolio trades.",
                  "Both predeclared horizons are disclosed; overlapping events and reused development prices preclude independent-sample significance or out-of-sample claims.",
                  "Barrier labels use gross price-distance R, not fee-adjusted profit barriers. Same-minute range dual touches remain ambiguous; no path order is inferred.",
                  "Complete-event denominators include horizon-censored and ambiguous paths. Missing future tails are excluded separately per horizon, without truncating them to available data.",
                  "Fixed-horizon MFE/MAE and endpoint returns use the entire forward window, even after barriers hit; they do not inherit the strategy exit policy.",
                  "Costs use per-unit adverse price/tick fills, entry/exit fees and actual carried funding at minute mark open. Slippage is already in fills and is not deducted twice.",
                  "No independent exhaustive detector/EMA/shape/key reconstruction; native observer snapshots and causal price/ATR are checked. Only explicitly supplied audited plan windows are consumed; no future holdout is unlocked by this tool."]}
    encoded = []
    for window in evidence["plan"]["windows"]:
        batches, receipts = audit_window(evidence, window)
        result["receipts"].extend(receipts)
        groups, accounts, contrasts, shared = {}, [], [], []
        for batch in batches:
            observer = validate_observer(batch)
            check(all(r["config"]["strategy"]["filter"] == "ema" for r in batch["results"]),
                  "shared opportunity set audit is limited to the frozen EMA study")
            shared.append({"symbol": batch["symbol"], **audit_shared_market_set(observer)})
            begin = min(r["warmupStart"] for r in batch["results"])
            minutes, marks, funding = sources.load(batch["symbol"], begin, batch["startTime"], batch["endTime"])
            labeled = {}
            for observed in observer:
                account = next(r for r in batch["results"] if r["id"] == observed["id"])
                config = account["config"]
                check(config["version"] == 10 and config["strategy"]["tradeMinutes"] == 30
                      and config["strategy"]["stopAtr"] == 2, "reference price/R differs from declared account")
                bars = trading_candles(minutes[minutes[:, 0] >= observed["warmupStart"]])
                atr = wilder_atr(bars)
                events = []
                for event in observed["opportunities"]:
                    signal = event["entrySignal"]
                    index = (signal["time"] + 1 - int(bars[0, 0])) // PERIOD - 1
                    check(0 <= index < len(bars), "signal outside complete candles")
                    equal(signal["price"], float(bars[index, 4]), "observer signal close")
                    equal(signal["atr"], float(atr[index]), "observer signal ATR")
                    value = label_opportunity(event, minutes, marks, funding, config["execution"], batch["startTime"], batch["endTime"])
                    events.append(value)
                    encoded.append(json.dumps({"window": window["id"], "symbol": batch["symbol"], "candidate": observed["id"], **value}, allow_nan=False, separators=(",", ":")))
                labeled[observed["id"]] = events
                groups.setdefault(observed["id"], []).extend(events)
                accounts.append({"symbol": batch["symbol"], "candidate": observed["id"],
                                 "lifecycleCounts": observed["counts"], **summarize_events(events)})
            for contrast in plan["contrasts"]:
                contrasts.append({"symbol": batch["symbol"], **declared_contrast(contrast, labeled)})
            print("labeled", batch["symbol"], sum(map(len, labeled.values())), "first breaks", flush=True)
        result["windows"][window["id"]] = {"role": window["role"], "accounts": accounts,
            "candidates": {k: summarize_events(v) for k, v in groups.items()}, "contrasts": contrasts,
            "sharedMarketSet": shared}
    check(source_fingerprint(*DEPENDENCIES) == dependencies, "diagnostic sources changed during run")
    check(hashes == {name: sha(path) for name, path in (("plan", args.plan), ("manifest", args.manifest),
                                                     ("opportunityPlan", args.opportunity_plan))}, "inputs changed during run")
    atomic_bytes(events_path, gzip.compress(("\n".join(encoded) + ("\n" if encoded else "")).encode(), mtime=0), replace=False)
    result["events"] = {"path": str(events_path), "sha256": sha(events_path), "count": len(encoded)}
    result["sourceHashes"] = [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())]
    write_once(args.output, result)
    print({"output": str(args.output), "sha256": sha(args.output), "events": len(encoded)}, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "opportunity-plan", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    run(parser.parse_args())
