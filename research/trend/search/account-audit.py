"""Audit recorded search accounts; not a second signal or exit strategy engine.

Prepare/test: python research/trend/search/account-audit.py --self-test
After the full replay: python research/trend/search/account-audit.py
Use --output with a new path for reproduction; existing evidence is immutable.
"""
import argparse
from collections import Counter
import copy
import importlib.util
import math
from pathlib import Path
import sys

# Loading a frozen Python attachment must not create __pycache__ beside it.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))

import numpy as np
from artifacts import audit_window, load_evidence, read, sha, source_fingerprint, write_once
from breakout_study import trading_candles, wilder_atr
from daily import daily_equity
from details_audit import Sources, check, equal, compare_baseline

MINUTE, DAY = 60_000, 86_400_000
PLAN = ROOT / "research/trend/search-plan.json"
PLAN_SHA = "f6db2c3a71c08fbed0a7a6c2b6f7f1538fbf40d29180aafab216e766f2b62594"
RISK_SOURCE = ROOT / "research/trend/details/risk-trigger-audit.py"
RISK_SHA = "fa9fbd89226711486f79e4b48d936aa9f7b2596bd6364056ac9bd082a15f1dbd"
BASELINE = "m30-n320-x160"
OLD_WINDOWS = {"development": "development", "validation-2024-early": "known-2024",
               "historical-2021": "transfer-2021", "historical-stress": "historical-stress",
               "completion-2022-aug": "completion-2022-aug"}
DEPENDENCIES = ("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py",
                "daily.py", "download.py", "protocol.py", "warmup.py")


def load_risk_auditor():
    check(sha(RISK_SOURCE) == RISK_SHA, "frozen risk reconstruction source differs")
    spec = importlib.util.spec_from_file_location("_frozen_recorded_risk_audit", RISK_SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def price_functions(execution):
    tick = execution["tickSize"]
    floor = lambda value: math.floor(value / tick + 1e-9) * tick
    ceil = lambda value: math.ceil(value / tick - 1e-9) * tick
    slip = execution["slippageBps"] / 10000
    fill = lambda raw, buy: ceil(raw * (1 + slip)) if buy else floor(raw * (1 - slip))
    return floor, ceil, fill


def exit_reference(trade, minute, entry_raw, end, tick):
    """Market/initial exits have independent raw prices; dynamic stops do not.

    Native trade rows omit the active dynamic protection line. For a within-
    minute dynamic exit, the recorded slippage attribution implies a raw line;
    only its compatibility with this minute and the fill grid is audited.
    """
    reason, time = trade["reason"], trade["exitTime"]
    opened, high, low, close = map(float, minute[1:5])
    sign = 1 if trade["side"] == "long" else -1
    clock = int(minute[0])
    check(time in (clock, clock + MINUTE - 1), "exit is neither minute open nor intraminute timestamp")
    if reason == "end-range":
        check(time == end - 1, "terminal exit clock")
        return close, "independent-terminal-close"
    if reason in ("daily-loss", "daily-close", "channel-exit", "protection-crossed"):
        check(time == clock, "market intent must execute at minute open")
        return opened, "independent-market-open"
    check(reason in ("initial", "breakeven", "trailing"), "unknown recorded stop reason")
    if reason == "initial":
        stop = trade["initialStop"]
        check(low <= stop if sign == 1 else high >= stop, "initial stop was not reached")
        raw = min(opened, stop) if sign == 1 else max(opened, stop)
        check(time == (clock if raw == opened else clock + MINUTE - 1), "initial stop gap/intraminute clock")
        return raw, "independent-initial-stop"
    if time == clock:
        return opened, "independent-dynamic-gap-open"
    raw = (trade["exitPrice"] + sign * trade["slippageAndRounding"] / trade["quantity"]
           - (trade["entryPrice"] - entry_raw))
    tolerance = min(8 * np.finfo(float).eps * max(abs(raw), abs(opened), tick), tick * 1e-6)
    check(low - tolerance <= raw <= high + tolerance, "implied dynamic stop is outside the actual minute range")
    check(sign * (opened - raw) > -tolerance, "within-minute dynamic stop should instead have gapped at open")
    check(sign * (raw - trade["initialStop"]) >= -tolerance, "implied stop loosened beyond initial protection")
    equal(raw, round(raw / tick) * tick, "implied dynamic stop price grid")
    return raw, "attribution-implied-dynamic-stop"


def audit_ledger(row, batch, minutes, marks, funding, indicators):
    config = row["config"]
    strategy, execution, risk = (config[key] for key in ("strategy", "execution", "risk"))
    check(config["version"] == 8 and strategy["tradeMinutes"] == 30
          and strategy["entry"] in ("breakout", "pullback", "kdj", "price-action"), "unexpected strategy scope")
    period = strategy["tradeMinutes"] * MINUTE
    key = (row["warmupStart"], strategy["tradeMinutes"])
    if key not in indicators:
        offset = (row["warmupStart"] - int(minutes[0, 0])) // MINUTE
        bars = trading_candles(minutes[offset:], strategy["tradeMinutes"])
        indicators[key] = bars, wilder_atr(bars)
    bars, atr = indicators[key]
    floor, ceil, fill = price_functions(execution)
    fee = execution["feeBps"] / 10000
    origin, start, end = int(minutes[0, 0]), batch["startTime"], batch["endTime"]
    funding_times = np.asarray([value["time"] // MINUTE * MINUTE for value in funding], dtype=np.int64)
    rates = np.asarray([value["rate"] for value in funding])
    funding_marks = marks[(funding_times - origin) // MINUTE, 1]
    cash, previous_exit, ids, counts = execution["initialCapital"], start - 1, set(), Counter()
    fees, paid_funding = 0.0, 0.0
    for trade in row["trades"]:
        side, entry_time, exit_time = trade["side"], trade["entryTime"], trade["exitTime"]
        check(side in ("long", "short") and strategy["direction"] in (side, "both"), "trade direction differs")
        check(trade["id"] not in ids, "duplicate trade identity")
        ids.add(trade["id"])
        sign, long = (1 if side == "long" else -1), side == "long"
        signal = trade["entrySignal"]
        check(start <= entry_time <= exit_time < end and previous_exit < entry_time
              and entry_time == signal["time"] + 1 and entry_time % period == 0, "entry chronology or next-minute fill")
        index = (entry_time - int(bars[0, 0])) // period - 1
        check(index >= 13 and bars[index, 0] >= start, "signal lacks completed initialized ATR candle")
        equal(signal["price"], float(bars[index, 4]), "completed signal close")
        equal(signal["atr"], float(atr[index]), "independently seeded signal ATR14")
        first, last = (entry_time - origin) // MINUTE, (exit_time - origin) // MINUTE
        raw_entry = float(minutes[first, 1])
        entry = fill(raw_entry, long)
        initial_stop = (floor if long else ceil)(entry - sign * strategy["stopAtr"] * float(atr[index]))
        check(initial_stop > 0, "nonpositive initial stop")
        equal(trade["entryPrice"], entry, "adverse next-open entry")
        equal(trade["initialStop"], initial_stop, "frozen initial ATR stop")
        stop_fill = fill(initial_stop, not long)
        unit_risk = sign * (entry - stop_fill) + (entry + stop_fill) * fee
        limit = min(cash * risk["riskPct"] / unit_risk,
                    cash * risk["maxExposurePct"] / (entry * (1 + fee)))
        units = limit / execution["quantityStep"]
        quantity = math.floor(units + min(8 * np.finfo(float).eps * abs(units), 1e-6)) * execution["quantityStep"]
        equal(trade["quantity"], quantity, "cash/fee/stop risk and exposure quantity")
        check(quantity > 0 and quantity * entry >= execution["minNotional"], "invalid minimum order")
        # Every protection mode retains or tightens the initial hard stop.
        previous = minutes[first:last]
        check(not np.any(previous[:, 3] <= initial_stop if long else previous[:, 2] >= initial_stop),
              "recorded position survived an earlier initial hard-stop touch")
        raw_exit, evidence_kind = exit_reference(trade, minutes[last], raw_entry, end, execution["tickSize"])
        exit_price = fill(raw_exit, not long)
        equal(trade["exitPrice"], exit_price, "adverse exit fill")
        carried = (funding_times > entry_time) & (funding_times <= exit_time // MINUTE * MINUTE)
        funding_paid = float((sign * quantity * funding_marks[carried] * rates[carried]).sum())
        gross = sign * (exit_price - entry) * quantity
        trade_fees = (entry + exit_price) * quantity * fee
        net = gross - trade_fees - funding_paid
        initial_risk = abs(entry - initial_stop) * quantity
        slip = sign * ((entry - raw_entry) + (raw_exit - exit_price)) * quantity
        for actual, expected, label in ((trade["funding"], funding_paid, "signed carried-position funding"),
                (trade["fees"], trade_fees, "entry and exit fees"), (trade["grossPnl"], gross, "fill-based gross PnL"),
                (trade["netPnl"], net, "net PnL without duplicate slippage deduction"),
                (trade["risk"], initial_risk, "frozen initial price risk"),
                (trade["rMultiple"], net / initial_risk, "net initial R"),
                (trade["slippageAndRounding"], slip, "slippage attribution")):
            equal(actual, expected, label)
        cash += net
        fees += trade_fees
        paid_funding += funding_paid
        previous_exit = exit_time
        counts.update({"trades": 1, "side:" + side: 1, "exit:" + trade["reason"]: 1,
                       "exitEvidence:" + evidence_kind: 1, "carriedFundingEvents": int(carried.sum())})
    equal(cash, row["metrics"]["finalEquity"], "sequential closed-trade cash")
    if "fees" in row["metrics"]:
        equal(fees, row["metrics"]["fees"], "total account fees")
        equal(paid_funding, row["metrics"]["funding"], "total account funding")
        check(counts["carriedFundingEvents"] == row["metrics"]["fundingEvents"], "account funding event count")
    return counts


def self_test():
    # Reuse hand-priced synthetic ledgers, not native strategy output.
    from test_details_audit import ledger
    for side in ("long", "short"):
        for stop in (2, 3):
            row, batch, minutes, marks, funding = ledger(side, stop)
            counts = audit_ledger(row, batch, minutes, marks, funding, {})
            check(counts["trades"] == 1 and counts["carriedFundingEvents"] == 2, "signed funding fixture")
    source = ledger("short", 3)
    for field, value in (("entryPrice", 97), ("initialStop", 101), ("quantity", 6),
                         ("funding", 5), ("fees", 0), ("netPnl", 30), ("rMultiple", 1)):
        changed = copy.deepcopy(source)
        changed[0]["trades"][0][field] = value
        try:
            audit_ledger(*changed, {})
        except ValueError:
            pass
        else:
            raise ValueError("mutated ledger accepted: " + field)
    minute = np.asarray([1_735_689_600_000, 110, 112, 105, 109, 1, 1_735_689_659_999], dtype=float)
    trade = {"side": "long", "reason": "trailing", "exitTime": int(minute[6]), "entryPrice": 100.1,
             "exitPrice": 106.9, "quantity": 1, "slippageAndRounding": .2, "initialStop": 96}
    raw, kind = exit_reference(trade, minute, 100, int(minute[6]) + 1, .1)
    equal(raw, 107, "implied dynamic stop fixture")
    check(kind == "attribution-implied-dynamic-stop", "dynamic evidence must be labelled as implied")
    bad = {**trade, "slippageAndRounding": 20}
    try:
        exit_reference(bad, minute, 100, int(minute[6]) + 1, .1)
    except ValueError:
        pass
    else:
        raise ValueError("dynamic stop outside observed range accepted")
    load_risk_auditor().self_test()
    print("self-tests passed: mirrored costs/stop2/stop3/funding, corrupt ledgers, dynamic-stop evidence limits, positive cross-day daily-loss and delayed-exit rejection")


def run(args):
    check(not args.output.exists(), "audit output exists; choose a new destination")
    check(sha(PLAN) == PLAN_SHA, "frozen search plan differs")
    risk_auditor = load_risk_auditor()
    evidence = load_evidence(PLAN, args.input / "manifest.json", args.input)
    old = load_evidence(ROOT / "research/trend/robustness-plan.json", args.baseline_input / "manifest.json", args.baseline_input)
    check(evidence["selection"]["binarySha256"] == sha(args.binary), "current binary differs from recorded replay")
    check(evidence["selection"]["replayVersion"] == "trend-native-replay-4", "search needs audited native shards")
    dependencies = source_fingerprint(*DEPENDENCIES)
    sources, counts, records, row_records, inputs, old_inputs = Sources(evidence["manifest"]), Counter(), [], [], [], []
    for window in evidence["plan"]["windows"]:
        batches, provenance = audit_window(evidence, window)
        inputs.extend(provenance)
        old_batches = {}
        if window["id"] in OLD_WINDOWS:
            old_window = next(value for value in old["plan"]["windows"] if value["id"] == OLD_WINDOWS[window["id"]])
            historical, historical_provenance = audit_window(old, old_window)
            old_batches = {batch["symbol"]: batch for batch in historical}
            old_inputs.extend(historical_provenance)
        for batch in batches:
            print("account audit", window["id"], batch["symbol"], len(batch["results"]), "rows", flush=True)
            begin = min(row["warmupStart"] for row in batch["results"])
            minutes, marks, funding = sources.load(batch["symbol"], begin, batch["startTime"], batch["endTime"])
            active_marks = marks[(batch["startTime"] - begin) // MINUTE:]
            indicators = {}
            for row in batch["results"]:
                try:
                    check(len(daily_equity(row)) == (batch["endTime"] - batch["startTime"]) // DAY,
                          "canonical complete daily calendar")
                    ledger_counts = audit_ledger(row, batch, minutes, marks, funding, indicators)
                    found, risk_counts = risk_auditor.reconstruct(row, batch, active_marks, funding)
                    baseline_compared = False
                    if old_batches and row["id"] in (BASELINE, BASELINE + "-stress"):
                        previous = next(value for value in old_batches[batch["symbol"]]["results"] if value["id"] == row["id"])
                        compare_baseline(row, previous)
                        baseline_compared = True
                        counts["historicalBaselineRowsExact"] += 1
                except ValueError as error:
                    raise ValueError(f"{window['id']}/{batch['symbol']}/{row['id']}: {error}") from error
                records.extend({"window": window["id"], "symbol": batch["symbol"], "candidate": row["id"], **item} for item in found)
                row_records.append({"window": window["id"], "symbol": batch["symbol"], "candidate": row["id"],
                                    "entry": row["config"]["strategy"]["entry"], "risk": row["config"]["risk"],
                                    "costs": {key: row["config"]["execution"][key] for key in ("feeBps", "slippageBps")},
                                    "ledgerCounts": dict(ledger_counts), "riskCounts": dict(risk_counts),
                                    "baselineCompared": baseline_compared, "status": "passed"})
                counts.update(ledger_counts)
                counts.update(risk_counts)
                counts["rows"] += 1
                counts["entryRows:" + row["config"]["strategy"]["entry"]] += 1
            counts["batches"] += 1
            del minutes, marks, active_marks, indicators
    check(counts["batches"] == 36 and counts["rows"] == 2112 and counts["historicalBaselineRowsExact"] == 54,
          "missing search or historical comparison rows")
    check(source_fingerprint(*DEPENDENCIES) == dependencies and sha(PLAN) == PLAN_SHA, "audit inputs changed")
    result = {"version": "trend-search-account-audit-1", "status": "passed", "planSha256": PLAN_SHA,
              "manifestSha256": evidence["manifestSha256"], "runSha256": sha(args.input / "run.json"),
              "binarySha256": sha(args.binary), "engine": evidence["engine"], "scriptSha256": sha(__file__),
              "dependenciesSha256": dependencies, "riskReconstructionSource": {"path": str(RISK_SOURCE.relative_to(ROOT)), "sha256": RISK_SHA},
              "counts": dict(counts), "accounts": row_records, "dailyLossTriggers": records,
              "nativeInputs": inputs, "historicalBaselineInputs": old_inputs,
              "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
              "scope": "All 2112 recorded candidate/cost/symbol/window accounts. Verify full native shard provenance/configurations; completed signal close/ATR and next-minute adverse entry; initial stop/quantity from actual pre-entry cash, risk, fee, precision and notional; cost/funding/initial-R identities; earlier initial hard-stop protection. Independently reconstruct minute marked equity, each canonical daily close and the first held-position daily-loss trigger/next-open settlement. Exact baseline config/warmup/trades/daily/metrics comparison on five unchanged historical windows (54 rows).",
              "limits": ["Recorded entries/exits remain audit inputs. Signal eligibility, episode/pattern state, filters, rejected orders, cooldown and daily-blocked entry rejection are not independently replayed.",
                         "Intraminute breakeven/trailing stops omit their active line from native trade records. Their raw touch price is inferred from recorded slippage attribution, then checked against the actual minute, protective bound and adverse fill grid. This does not independently prove the dynamic stop formula or first dynamic touch; counts explicitly label attribution-implied exits.",
                         "Channel/protection-crossed open prices are independently checked, but their generating close condition is not reconstructed. No counterfactual execution engine or optimizer is added.",
                         "Daily guard is per configured sleeve marked equity, anchored at UTC mark.open before funding/orders; it is not trade PnL or a portfolio-wide guard. Final-minute risk intents have no next executable minute.",
                         "Float accounting reconciles at relative1e-10/absolute1e-7; risk inequalities use the frozen reconstruct function without discretionary tolerance. This audit does not establish profitability or independent out-of-sample evidence."]}
    write_once(args.output, result)
    print({"output": str(args.output), "counts": dict(counts), "sha256": sha(args.output)}, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/trend-search-v8")
    parser.add_argument("--baseline-input", type=Path, default=ROOT / "tmp/trend-robustness-v8")
    parser.add_argument("--binary", type=Path, default=ROOT / "crates/quant/target/release/trend")
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/search/account-audit.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test() if args.self_test else run(args)
