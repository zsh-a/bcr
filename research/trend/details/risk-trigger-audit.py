"""Independent recorded-account daily-loss trigger audit; not a strategy engine.

Run from the repository root. Uses frozen recorded entries/exits and verifies
minute cash/mark equity; it does not generate signals or replay rejected orders.
"""
import argparse
from collections import Counter
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import audit_window, load_evidence, sha, source_fingerprint, write_once
from details_audit import Sources, check, equal, MINUTE

DAY = 86_400_000


def reconstruct(row, batch, marks, funding):
    """Cash flows occur before mark.close. UTC day opens precede funding.

    end-range settlement occurs after the final minute risk observation, so it
    is kept outside that observation's cash flows and reconciled separately.
    """
    start, end = batch["startTime"], batch["endTime"]
    check(start % DAY == 0 and len(marks) == (end - start) // MINUTE, "account calendar")
    count = len(marks)
    cash_delta = np.zeros(count)
    open_unrealized, close_unrealized = np.zeros(count), np.zeros(count)
    holding = np.zeros(count, dtype=np.int64)
    execution, risk = row["config"]["execution"], row["config"]["risk"]
    fee = execution["feeBps"] / 10000
    funding_times = np.asarray([f["time"] // MINUTE * MINUTE for f in funding], dtype=np.int64)
    funding_rates = np.asarray([f["rate"] for f in funding])
    funding_indices = (funding_times - start) // MINUTE
    terminal = 0.0
    previous_exit = start - 1
    for index, trade in enumerate(row["trades"]):
        entry, exit_time = trade["entryTime"], trade["exitTime"]
        check(previous_exit < entry <= exit_time < end, "recorded account position overlap")
        previous_exit = exit_time
        first, last = (entry - start) // MINUTE, (exit_time - start) // MINUTE
        sign, qty = (1 if trade["side"] == "long" else -1), trade["quantity"]
        cash_delta[first] -= trade["entryPrice"] * qty * fee
        carried = (funding_times > entry) & (funding_times <= exit_time // MINUTE * MINUTE)
        ids = funding_indices[carried]
        amounts = sign * qty * marks[ids, 1] * funding_rates[carried]
        equal(float(amounts.sum()), trade["funding"], "funding sign/timing")
        np.add.at(cash_delta, ids, -amounts)
        settlement = sign * (trade["exitPrice"] - trade["entryPrice"]) * qty - trade["exitPrice"] * qty * fee
        is_terminal = trade["reason"] == "end-range"
        if is_terminal:
            check(exit_time == end - 1, "terminal clock")
            terminal += settlement
        else:
            cash_delta[last] += settlement
        # An entry at this open was not held for begin_day; an exit later in
        # this minute was held at its open. Closed positions have no close mark.
        open_unrealized[first + 1:last + 1] = sign * qty * (marks[first + 1:last + 1, 1] - trade["entryPrice"])
        until = last + int(is_terminal)
        close_unrealized[first:until] = sign * qty * (marks[first:until, 4] - trade["entryPrice"])
        holding[first:until] = index + 1
    close_cash = execution["initialCapital"] + np.cumsum(cash_delta)
    open_cash = np.concatenate(([execution["initialCapital"]], close_cash[:-1]))
    day_index = np.arange(count) // 1440 * 1440
    day_open_equity = open_cash + open_unrealized
    day_equity = day_open_equity[day_index]
    equity = close_cash + close_unrealized
    threshold = day_equity * (1 - risk["dailyLossPct"])
    crossed = (risk["dailyLossPct"] > 0) & (equity <= threshold) & (holding != 0)
    first_cross = {}
    for minute in np.flatnonzero(crossed):
        first_cross.setdefault(int(holding[minute]) - 1, int(minute))
    found, stats = [], Counter()
    for index, trade in enumerate(row["trades"]):
        minute = first_cross.get(index)
        if minute is None:
            check(trade["reason"] != "daily-loss", "daily-loss exit has no qualifying prior close")
            continue
        trigger_time, due = start + (minute + 1) * MINUTE - 1, start + (minute + 1) * MINUTE
        if due == end:
            check(trade["reason"] == "end-range", "terminal risk intent has no next minute")
            stats["terminalIntentsWithoutNextMinute"] += 1
            continue
        check(trade["reason"] == "daily-loss" and trade["exitTime"] == due,
              f"first daily-loss trigger must exit next minute: trade {trade['id']}, trigger {trigger_time}, exit {trade['exitTime']}/{trade['reason']}")
        day = int(day_index[minute])
        found.append({"tradeId": trade["id"], "side": trade["side"], "entryTime": trade["entryTime"],
                      "triggerTime": trigger_time, "exitTime": trade["exitTime"],
                      "dayStartTime": start + day * MINUTE, "dayStartCashBeforeFunding": float(open_cash[day]),
                      "dayStartUnrealizedAtMarkOpen": float(open_unrealized[day]),
                      "dayStartEquity": float(day_equity[minute]), "lossThreshold": float(threshold[minute]),
                      "triggerEquityAtMarkClose": float(equity[minute]),
                      "dayReturnAtTrigger": float(equity[minute] / day_equity[minute] - 1),
                      "netPnl": trade["netPnl"], "funding": trade["funding"]})
        stats["dailyLossExits"] += 1
        stats["profitableDailyLossExits"] += int(trade["netPnl"] > 0)
    equal(float(close_cash[-1] + terminal), row["metrics"]["finalEquity"], "reconstructed final cash")
    # All earlier UTC daily marks must also reconcile; final output includes
    # the separate end-range execution and is checked against final cash.
    for point in row["daily"]:
        minute = (point["time"] - start) // MINUTE
        expected = close_cash[-1] + terminal if minute == count - 1 else equity[minute]
        equal(float(expected), point["equity"], "reconstructed daily equity")
    stats["recordedTrades"] = len(row["trades"])
    stats["minutes"] = count
    return found, stats


def self_test():
    # Enter long at 100 late on day one. By midnight mark.open=120, so day
    # equity=12000. A fall to116 leaves +1600 trade profit but breaches 3% of
    # day equity (11640), and must exit at the following minute open.
    start = 1_735_689_600_000
    marks = np.asarray([[start + i * MINUTE, 100, 121, 99, 100, 1, start + (i + 1) * MINUTE - 1]
                        for i in range(1443)], dtype=float)
    marks[1439, 4] = 120
    marks[1440:, 1] = 120
    marks[1440:, 4] = 116
    trade = {"id": 1, "side": "long", "entryTime": start + 1439 * MINUTE,
             "exitTime": start + 1441 * MINUTE, "entryPrice": 100, "exitPrice": 116,
             "quantity": 100, "funding": 0, "netPnl": 1600, "reason": "daily-loss"}
    row = {"config": {"execution": {"initialCapital": 10000, "feeBps": 0}, "risk": {"dailyLossPct": .03}},
           "trades": [trade], "daily": [{"time": start + DAY - 1, "equity": 12000},
                                          {"time": start + 1443 * MINUTE - 1, "equity": 11600}],
           "metrics": {"finalEquity": 11600}}
    batch = {"startTime": start, "endTime": start + 1443 * MINUTE}
    found, _ = reconstruct(row, batch, marks, [])
    check(len(found) == 1 and found[0]["dayStartUnrealizedAtMarkOpen"] == 2000
          and found[0]["netPnl"] > 0, "positive floating profit across UTC midnight example")
    trade["exitTime"] += MINUTE
    try:
        reconstruct(row, batch, marks, [])
    except ValueError as error:
        check("next minute" in str(error), "late-exit counterexample failed for wrong reason")
    else:
        raise ValueError("late risk exit was accepted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "output"):
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("synthetic profitable cross-midnight trigger and delayed-exit rejection passed")
        return
    check(all(getattr(args, name) for name in ("plan", "manifest", "input", "output")), "missing audit paths")
    check(not args.output.exists(), "audit output exists")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    sources, counts, records, inputs = Sources(evidence["manifest"]), Counter(), [], []
    dependencies = source_fingerprint("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py", "daily.py", "download.py", "protocol.py", "warmup.py")
    for window in evidence["plan"]["windows"]:
        batches, provenance = audit_window(evidence, window)
        inputs.extend(provenance)
        for batch in batches:
            print(f"risk audit {window['id']}/{batch['symbol']}", flush=True)
            _, marks, funding = sources.load(batch["symbol"], batch["startTime"], batch["startTime"], batch["endTime"])
            for row in batch["results"]:
                try:
                    found, stats = reconstruct(row, batch, marks, funding)
                except ValueError as error:
                    raise ValueError(f"{window['id']}/{batch['symbol']}/{row['id']}: {error}") from error
                records.extend({"window": window["id"], "symbol": batch["symbol"], "candidate": row["id"], **item} for item in found)
                counts.update(stats)
                counts["rows"] += 1
            counts["batches"] += 1
    result = {"version": "trend-details-risk-trigger-audit-1", "status": "passed", "planSha256": evidence["planSha256"],
              "manifestSha256": evidence["manifestSha256"], "runSha256": sha(args.input / "run.json"),
              "scriptSha256": sha(__file__), "dependenciesSha256": dependencies, "engine": evidence["engine"],
              "counts": dict(counts), "triggers": records, "nativeInputs": inputs,
              "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
              "scope": "All recorded accounts: reconstruct every minute cash/mark equity from executed trades, entry fees, signed carried-position funding and exit settlements. UTC day equity uses mark.open before funding/orders; risk observation uses mark.close after orders/stops. Each held position's first loss-threshold crossing must execute daily-loss on the next minute. Reconcile every canonical daily equity and final cash.",
              "limits": ["Recorded entries and exits are inputs, not a second strategy replay. This does not validate rejected/no-trade signals, cooldown or daily-blocked entry eligibility.",
                         "No change to parameters, selection, native output, or the prior execution audit. Trigger threshold uses the native configured dailyLossPct and full sleeve marked equity, not trade PnL or portfolio-wide equity.",
                         "Vector cash accumulation has IEEE rounding differences; reconciliations use relative1e-10/absolute1e-7. Trigger inequalities use no discretionary tolerance. Only final-minute risk intents with no following minute are exempt from a daily-loss fill."]}
    check(source_fingerprint("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py", "daily.py", "download.py", "protocol.py", "warmup.py") == dependencies, "audit dependencies changed")
    write_once(args.output, result)
    print({"output": str(args.output), "counts": dict(counts)}, flush=True)


if __name__ == "__main__":
    main()
