"""Audit structured setup snapshots and summarize observation-stage counts.

Counts describe the executed account path. They are not matched-counterfactual
entry accuracy, and the price algorithm is not independently replayed here.
"""
import argparse
from collections import Counter
from pathlib import Path

from artifacts import audit_window, load_evidence, sha, write_once


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit_snapshot(trade, policy=None):
    signal = trade["entrySignal"]
    trigger = signal["trigger"]
    require(trigger["kind"] == "structured-pullback", "wrong setup snapshot kind")
    start, confirmed, end = (trigger[k] for k in
                             ("impulseStartTime", "impulseConfirmedAt", "impulseEndTime"))
    pullback = trigger.get("pullbackStartedAt")
    require(pullback is not None and start < confirmed <= end < pullback <= signal["time"]
            < trade["entryTime"], "setup chronology violates next-executable entry")
    require(signal["boundary"] == trigger["impulseExtreme"], "entry boundary was not frozen")
    require(trigger["referenceAtr"] > 0 and trigger["strengthAtr"] >= 1.5
            and .6 <= trigger["efficiency"] <= 1 + 1e-10, "invalid impulse evidence")
    require(2 <= trigger["pullbackBars"] <= 24 and .2 - 1e-10 <= trigger["retracement"] <= .5 + 1e-10,
            "executed setup violates frozen pullback bounds")
    confirmation = trigger.get("confirmation", "before-breakout")
    require(confirmation in ("before-breakout", "signal-close"), "unknown confirmation policy")
    if policy is not None:
        require(trigger.get("confirmation") == policy["confirmation"]
                and trigger.get("keyRole") == policy["keyRole"], "snapshot policy differs from configuration")
        require(isinstance(trigger.get("gates"), dict), "v10 snapshot requires parallel gates")
    for turn in trigger["turns"]:
        require(pullback <= turn["time"] < turn["confirmedAt"]
                and (turn["confirmedAt"] <= signal["time"] if confirmation == "signal-close"
                     else turn["confirmedAt"] < signal["time"]),
                "unconfirmed or pre-pullback turn entered the pattern")
    if "gates" in trigger:
        require(set(trigger["gates"]) == {"retracement", "key", "shape", "candle"}
                and all(value is True for value in trigger["gates"].values()),
                "executed setup contains a failed gate")
    pivot = trigger.get("pivot")
    if pivot:
        require(pivot["pivotTime"] < pivot["confirmedAt"] <= start,
                "pivot was unavailable at the impulse origin")
        if pivot.get("retestTime") is not None:
            require(pullback <= pivot["retestTime"] < signal["time"], "pivot retest uses breakout candle")
    ema = trigger.get("ema")
    if ema:
        require(ema["observedAt"] <= signal["time"] and ema["validatedAt"] <= start,
                "EMA validation or current completed value was unavailable")
        if ema.get("retestTime") is not None:
            require(pullback <= ema["retestTime"] < signal["time"], "EMA retest uses breakout candle")


def summarize(batches):
    rows, grouped = [], {}
    for batch in batches:
        for row in batch["results"]:
            if row["config"]["strategy"]["entry"] != "structured-pullback":
                continue
            counts = row.get("researchDiagnostics")
            require(isinstance(counts, dict), "native setup diagnostics are required")
            require(counts["completedTrades"] == len(row["trades"]), "diagnostics differ from trade ledger")
            for label in ("eventCounts", "acceptedShapeCounts"):
                require(all(type(value) is int and value >= 0 for value in counts[label].values()),
                        "invalid observation counts")
            for trade in row["trades"]:
                audit_snapshot(trade, row["config"]["strategy"]["structuredPullback"]
                               if row["config"].get("version", 9) >= 10 else None)
            rows.append({"symbol": batch["symbol"], "candidate": row["id"], **counts})
            total = grouped.setdefault(row["id"], {"eventCounts": Counter(), "acceptedShapeCounts": Counter(),
                                                    "completedTrades": 0, "accounts": 0})
            for label in ("eventCounts", "acceptedShapeCounts"):
                total[label].update(counts[label])
            total["completedTrades"] += counts["completedTrades"]
            total["accounts"] += 1
    require(rows, "study contains no structured setup evidence")
    return {"accounts": rows, "candidates": grouped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    evidence = load_evidence(args.plan, args.manifest, args.input)
    result = {"version": 1, "status": "passed", "sources": {
        name: {"path": str(path), "sha256": sha(path)} for name, path in
        (("plan", args.plan), ("manifest", args.manifest), ("generator", Path(__file__)))},
        "scope": "Recorded event counts and causal snapshot constraints only; no independent price-pattern recomputation.",
        "limitations": ["Ablations may take different trades and change later positions or cooldown; counts are account-path observations.",
                        "Pattern labels can overlap. Sum of shape counts is not a number of unique signals.",
                        "Completed-trade win rate depends on exit policy and is not standalone breakout accuracy."],
        "windows": {}, "receipts": []}
    for window in evidence["plan"]["windows"]:
        batches, receipts = audit_window(evidence, window)
        result["windows"][window["id"]] = summarize(batches)
        result["receipts"].extend(receipts)
    write_once(args.output, result)
    print({"output": str(args.output), "status": "passed"})


if __name__ == "__main__":
    main()
