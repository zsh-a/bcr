"""Recorded execution and daily-loss audit for the four frozen robustness rules.

This report attachment reuses prior read-only checks, never runs an account or
generates missing entries. All inputs and imported audit sources are hashed.
"""
import argparse
from collections import Counter
import importlib.util
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import audit_window, ensure_writable, load_evidence, sha, source_fingerprint, write_once
from details_audit import DEPENDENCIES, Sources, audit_row, check, compare_baseline, MINUTE

RISK_SOURCE = ROOT / "research/trend/details/risk-trigger-audit.py"
spec = importlib.util.spec_from_file_location("frozen_details_risk_audit", RISK_SOURCE)
risk_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(risk_audit)


def run(args):
    ensure_writable(args.output)
    check(not args.output.exists(), "audit output already exists")
    check(args.input.resolve() not in args.output.resolve().parents, "output must be separate from raw evidence")
    risk_audit.self_test()
    evidence = load_evidence(args.plan, args.manifest, args.input)
    plan = evidence["plan"]
    primary = plan["fixedCandidate"]
    check(plan["selectionMode"] == "fixed" and primary == "m30-n320-x160", "unexpected fixed primary")
    old_plan = ROOT / plan["sourceStudy"]["plan"]
    check(sha(old_plan) == plan["sourceStudy"]["sha256"], "source plan identity")
    old = load_evidence(old_plan, args.baseline_input / "manifest.json", args.baseline_input)
    check(evidence["selection"]["binarySha256"] == old["selection"]["binarySha256"] == sha(args.binary),
          "native engine binary differs across studies")
    before = {"scriptSha256": sha(__file__), "riskAuditSha256": sha(RISK_SOURCE),
              "dependenciesSha256": source_fingerprint(*DEPENDENCIES),
              "selectionSha256": sha(args.input / "selection.json")}
    old_windows = {window["id"]: window for window in old["plan"]["windows"]}
    definitions = {candidate["id"]: candidate for candidate in plan["candidates"]}
    check(set(definitions) == {primary, primary + "-no-day-guard", "m30-n160-x80", "m30-n640-x320"},
          "audit expects exactly the four frozen contrasts")
    sources, counts, risk_counts = Sources(evidence["manifest"]), Counter(), Counter()
    rows, triggers, inputs, old_inputs, raw_hashes = [], [], [], [], []
    for window in plan["windows"]:
        batches, provenance = audit_window(evidence, window)
        inputs.extend(provenance)
        historical = {}
        if window["id"] in old_windows:
            old_window = old_windows[window["id"]]
            check((window["start"], window["end"]) == (old_window["start"], old_window["end"]), "prior window dates")
            previous, receipts = audit_window(old, old_window)
            old_inputs.extend(receipts)
            historical = {batch["symbol"]: {row["id"]: row for row in batch["results"]} for batch in previous}
        for batch in batches:
            symbol = batch["symbol"]
            print(f"audit {window['id']}/{symbol}: execution, every daily equity, daily-loss triggers", flush=True)
            raw_path = args.input / window["id"] / (symbol + ".json")
            raw_hashes.append({"window": window["id"], "symbol": symbol,
                               "path": str(raw_path.resolve().relative_to(ROOT)), "sha256": sha(raw_path)})
            minutes, marks, funding = sources.load(symbol, min(row["warmupStart"] for row in batch["results"]),
                                                   batch["startTime"], batch["endTime"])
            first = (batch["startTime"] - int(marks[0, 0])) // MINUTE
            active_marks = marks[first:]
            for row in batch["results"]:
                candidate_id = row["id"].removesuffix("-stress")
                definition = definitions[candidate_id]
                expected_risk = dict(plan["risk"])
                expected_risk.update(definition.get("riskOverrides", {}))
                try:
                    check(row["config"]["risk"] == expected_risk, "effective native risk differs from frozen override")
                    check("riskOverrides" not in row["config"]["strategy"], "risk metadata leaked into native strategy")
                    disabled = candidate_id == primary + "-no-day-guard"
                    check(expected_risk["dailyLossPct"] == (0 if disabled else .03), "unexpected daily-loss contrast")
                    if disabled:
                        check(all(trade["reason"] != "daily-loss" for trade in row["trades"]),
                              "disabled daily guard emitted a daily-loss exit")
                    checked = audit_row(row, batch, minutes, marks, funding)
                    found, stats = risk_audit.reconstruct(row, batch, active_marks, funding)
                    if disabled:
                        check(not found and stats["dailyLossExits"] == 0, "disabled daily-loss trigger")
                        counts["dailyGuardDisabledRows"] += 1
                    if symbol in historical and row["id"] in (primary, primary + "-stress"):
                        compare_baseline(row, historical[symbol][row["id"]])
                        counts["exactPriorPrimaryRows"] += 1
                except (ValueError, KeyError) as error:
                    raise ValueError(f"{window['id']}/{symbol}/{row['id']}: {error}") from error
                counts.update(checked)
                counts["rows"] += 1
                counts["nativeRiskConfigurations"] += 1
                counts["dailyEquitiesReconstructed"] += len(row["daily"])
                risk_counts.update(stats)
                rows.append({"window": window["id"], "symbol": symbol, "candidate": row["id"],
                             "dailyLossPct": expected_risk["dailyLossPct"], "execution": dict(checked), "risk": dict(stats)})
                triggers.extend({"window": window["id"], "symbol": symbol, "candidate": row["id"], **value}
                                for value in found)
            counts["batches"] += 1
    check(counts["batches"] == 66 and counts["rows"] == 504 and counts["dailyGuardDisabledRows"] == 126,
          "incomplete planned audit coverage")
    check(counts["exactPriorPrimaryRows"] == 90, "incomplete old primary regression")
    check(evidence["engine"] == old["engine"], "engine name differs across studies")
    check(sha(args.plan) == evidence["planSha256"] and sha(args.manifest) == evidence["manifestSha256"], "evidence changed")
    check(sha(args.binary) == evidence["selection"]["binarySha256"], "binary changed during audit")
    check(before == {"scriptSha256": sha(__file__), "riskAuditSha256": sha(RISK_SOURCE),
                     "dependenciesSha256": source_fingerprint(*DEPENDENCIES),
                     "selectionSha256": sha(args.input / "selection.json")}, "audit sources or selection changed")
    check(all(sha(ROOT / value["path"]) == value["sha256"] for value in raw_hashes), "raw outputs changed during audit")
    result = {
        "version": "trend-robustness-execution-audit-1", "status": "passed",
        "planSha256": evidence["planSha256"], "manifestSha256": evidence["manifestSha256"],
        "runSha256": sha(args.input / "run.json"), "selectionSha256": before["selectionSha256"],
        "binarySha256": sha(args.binary), "engine": evidence["engine"],
        "auditScriptSha256": before["scriptSha256"], "auditDependenciesSha256": before["dependenciesSha256"],
        "frozenRiskAudit": {"path": str(RISK_SOURCE.relative_to(ROOT)), "sha256": before["riskAuditSha256"]},
        "baselinePlanSha256": old["planSha256"], "baselineManifestSha256": old["manifestSha256"],
        "numpyVersion": np.__version__, "numericTolerance": {"relative": 1e-10, "absolute": 1e-7},
        "counts": dict(counts), "riskCounts": dict(risk_counts), "rows": rows, "dailyLossTriggers": triggers,
        "rawHashes": raw_hashes, "nativeInputs": inputs, "baselineInputs": old_inputs,
        "sourceFilesRehashed": len(sources.verified),
        "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
        "baselineRegression": "90 rows strictly equal to the previous details study: development base for six symbols, plus base/stress for six symbols in seven other shared windows. Compared config, warmupStart, all trade fields, every daily equity, and all metrics. No normalization or tolerance applied.",
        "scope": "All 66 batches and 504 native account rows: per-candidate effective risk and recorded request identities; recursive official source CSV hashes and exact replay-slice lineage; complete actual minute calendars; candidate-specific completed 30m aggregation/ATR and previous-N breakout; next-open fill, fixed initial stop, cash-based quantity, earliest mechanical stop/channel, fees, funding, slippage, net/R and final cash. Reconstruct minute mark equity from recorded trade cash flows to verify every canonical daily equity, each first held-position daily-loss trigger and next-minute exit. All 126 disabled-guard rows must have zero daily-loss exits. This audit creates no counterfactual entries or new strategy account.",
        "limits": [
            "Recorded entries and exits are audit inputs. Rejected/missing signals, daily-blocked entry eligibility, cooldown triggers and counterfactual outcomes are not independently replayed.",
            "Daily-loss evidence reconstructs minute equity from recorded positions, including opening day equity before funding and minute-close equity after fills. It does not establish that all flat-account blocks were respected; only held-position triggers are independently tested.",
            "Minute equity supports risk checks and daily reconciliation, but non-baseline MFE/MAE, exposure and every evaluation statistic are not independently recomputed. The 90 prior-primary metric objects are compared strictly in full.",
            "Aggregate minutes/trades include repeated candidates and cost scenarios. They are audit work counts, not independent market observations.",
            "Floating cash reconstruction uses stated numeric reconciliation tolerance; risk trigger inequalities have no discretionary tolerance. Final-minute intents without an available next minute may settle only as end-range.",
            "Hash integrity, successful historical execution checks and regression equivalence do not establish future profitability, risk-matched alpha or live execution feasibility."
        ]
    }
    write_once(args.output, result)
    print({"output": str(args.output), "status": "passed", "counts": dict(counts), "riskCounts": dict(risk_counts)}, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "baseline-input", "binary", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
