"""Check recorded holdout trades, channel timing and minute account equity.

Uses audited source data and independent accounting functions. It does not
reselect rules or reconstruct all rejected entry opportunities.
"""
import argparse
from collections import Counter
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import audit_window, load_evidence, sha, source_fingerprint, write_once
from daily import daily_equity
from details_audit import Sources, audit_row, check

RISK_SOURCE = ROOT / "research/trend/details/risk-trigger-audit.py"
RISK_SHA = "fa9fbd89226711486f79e4b48d936aa9f7b2596bd6364056ac9bd082a15f1dbd"
DEPENDENCIES = ("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py",
                "daily.py", "download.py", "protocol.py", "warmup.py")
MINUTE, DAY = 60_000, 86_400_000


def run(args):
    check(not args.output.exists(), "choose a new audit output path")
    check(sha(RISK_SOURCE) == RISK_SHA, "frozen risk auditor changed")
    spec = importlib.util.spec_from_file_location("_recorded_holdout_risk", RISK_SOURCE)
    risk_auditor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(risk_auditor)
    evidence = load_evidence(args.plan, args.input / "manifest.json", args.input)
    plan = evidence["plan"]
    check(plan["selectionMode"] == "inherited", "holdout must inherit an external frozen choice")
    check(len(plan["candidates"]) == 2 and len(plan["symbols"]) == 6, "unexpected frozen scope")
    dependencies = source_fingerprint(*DEPENDENCIES)
    sources = Sources(evidence["manifest"])
    counts, accounts, triggers, provenance = Counter(), [], [], []
    for window in plan["windows"]:
        batches, receipts = audit_window(evidence, window)
        provenance.extend(receipts)
        for batch in batches:
            begin = min(row["warmupStart"] for row in batch["results"])
            minutes, marks, funding = sources.load(batch["symbol"], begin, batch["startTime"], batch["endTime"])
            active_marks = marks[(batch["startTime"] - begin) // MINUTE:]
            check(len(batch["results"]) == 4, "both candidates must include both costs")
            for row in batch["results"]:
                check(row["config"]["strategy"]["filter"] == "none", "unexpected holdout filter")
                check(len(daily_equity(row)) == (batch["endTime"] - batch["startTime"]) // DAY,
                      "incomplete canonical daily calendar")
                ledger = audit_row(row, batch, minutes, marks, funding)
                found, equity = risk_auditor.reconstruct(row, batch, active_marks, funding)
                if row["config"]["risk"]["dailyLossPct"] == 0:
                    check(not found and not any(trade["reason"] == "daily-loss" for trade in row["trades"]),
                          "disabled daily guard generated an exit")
                accounts.append({"window": window["id"], "symbol": batch["symbol"], "candidate": row["id"],
                                 "ledgerCounts": dict(ledger), "equityCounts": dict(equity), "status": "passed"})
                triggers.extend({"window": window["id"], "symbol": batch["symbol"], "candidate": row["id"], **item}
                                for item in found)
                counts.update(ledger)
                counts.update(equity)
                counts["accounts"] += 1
            counts["batches"] += 1
            print("audited", window["id"], batch["symbol"], flush=True)
    check(counts["accounts"] == len(plan["windows"]) * len(plan["symbols"]) * 4, "missing account results")
    check(source_fingerprint(*DEPENDENCIES) == dependencies, "audit dependency changed during verification")
    check(sha(args.plan) == evidence["planSha256"], "plan changed during verification")
    result = {
        "version": "trend-heldout-account-audit-1", "status": "passed",
        "planSha256": evidence["planSha256"], "manifestSha256": evidence["manifestSha256"],
        "runSha256": sha(args.input / "run.json"), "selectionSha256": sha(args.input / "selection.json"),
        "scriptSha256": sha(__file__), "dependenciesSha256": dependencies,
        "riskAuditor": {"path": str(RISK_SOURCE.relative_to(ROOT)), "sha256": RISK_SHA},
        "counts": dict(counts), "accounts": accounts, "dailyLossTriggers": triggers, "provenance": provenance,
        "sourceHashes": [{"path": path, "sha256": digest} for path, digest in sorted(sources.verified.items())],
        "scope": "Every recorded long holdout trade: source calendars, prior-N one-tick close breakout, signal Wilder ATR, next-minute entry, quantity/risk/precision, initial stop, earliest hard stop versus prior-M channel exit, adverse fills, fees, carried-position funding, net PnL and R. Independently reconstruct each minute marked equity, canonical daily close and first daily-loss trigger followed by next-open exit.",
        "limits": ["Recorded trade entries remain inputs; unused entry opportunities, cooldown and daily-entry locks are not independently replayed.",
                   "Minute OHLC execution does not establish order-book liquidity, queue position, actual latency or live fill prices.",
                   "The audit checks execution/accounting, not statistical independence of held-out assets or future profitability."]}
    write_once(args.output, result)
    print(dict(counts), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=ROOT / "research/trend/holdout-plan.json")
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/trend-holdout-v8")
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/holdout/account-audit.json")
    run(parser.parse_args())
