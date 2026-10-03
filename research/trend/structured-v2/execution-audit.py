"""Independent v10 recorded-trade protection/account audit; not another signal engine.

Adapted from the frozen structured v1 audit (SHA
778db8b1865cbd2bbe1f3b6d682b1a272d35b17b827444a52e6713c251d96944);
only stage bindings and explicit confirmation-clock checks change.

Run --self-test without market data. After the development replay completes:
  python research/trend/structured-v2/execution-audit.py
Use --output with a new path for subsequent audits; existing evidence is never
replaced. Only frozen development source prices and recorded trades are read.
"""
import argparse
from collections import Counter
import copy
import importlib.util
import math
from pathlib import Path
import sys

import numpy as np

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import audit_window, load_evidence, sha, source_fingerprint, write_once
from breakout_study import breaks, trading_candles, wilder_atr
from details_audit import Sources, check, equal
from setup_diagnostics import audit_snapshot

MINUTE, DAY, PERIOD = 60_000, 86_400_000, 30 * 60_000
PLAN = ROOT / "research/trend/structured-v2/development-input/plan.json"
MANIFEST = ROOT / "research/trend/structured-v2/development-input/manifest.json"
PLAN_SHA = "e3db8c415084f558e3244bfdfc4c29f65edb82026af6b248fd12260a6fc9301c"
MANIFEST_SHA = "18ebe88782d9b9f487ddd1bf88b0fe751ba9d9f8bd0f6bd663989cada3281786"
RISK_SOURCE = ROOT / "research/trend/details/risk-trigger-audit.py"
RISK_SHA = "fa9fbd89226711486f79e4b48d936aa9f7b2596bd6364056ac9bd082a15f1dbd"
DEPENDENCIES = ("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py",
                "daily.py", "download.py", "protocol.py", "warmup.py", "setup_diagnostics.py")


def floor(price, tick):
    return math.floor(price / tick + 1e-9) * tick


def ceil(price, tick):
    return math.ceil(price / tick - 1e-9) * tick


def signal_snapshot(trade, bars, atr, tick):
    """Check the recorded setup's causal geometry, not discovery/eligibility."""
    signal, sign = trade["entrySignal"], 1 if trade["side"] == "long" else -1
    trigger = signal["trigger"]
    check(trigger["kind"] == "structured-pullback" and "lookbackBars" not in signal, "entry trigger type")
    def index(time):
        offset = time + 1 - int(bars[0, 0])
        check(offset % PERIOD == 0 and 0 < offset <= len(bars) * PERIOD, "snapshot requires a complete candle close")
        return offset // PERIOD - 1
    origin, confirmed, ended, pullback, last = [index(t) for t in
        (trigger["impulseStartTime"], trigger["impulseConfirmedAt"], trigger["impulseEndTime"],
         trigger["pullbackStartedAt"], signal["time"])]
    check(confirmed == origin + 3 and confirmed <= ended <= confirmed + 8
          and pullback == ended + 1 and 2 <= last - pullback + 1 <= 24, "impulse/pullback clocks")
    check(trigger["setupId"] == trigger["impulseConfirmedAt"], "setup identity")
    start_price = float(bars[origin, 4])
    delta = float(bars[confirmed, 4] - start_price)
    path = float(np.abs(np.diff(bars[origin:confirmed + 1, 4])).sum())
    check(sign * delta > 0 and abs(delta) >= 1.5 * atr[origin]
          and path > 0 and abs(delta) / path >= .6, "recorded three-bar impulse thresholds")
    extreme = float(bars[origin + 1:ended + 1, 2].max() if sign == 1 else bars[origin + 1:ended + 1, 3].min())
    adverse = float(bars[pullback:last + 1, 3].min() if sign == 1 else bars[pullback:last + 1, 2].max())
    depth = (extreme - adverse) / (extreme - start_price)
    check(.2 <= depth <= .5, "recorded pullback depth")
    check(all(sign * (bars[i, 4] - bars[i - 1, 4]) >= 0 for i in range(confirmed + 1, ended + 1))
          and sign * (bars[pullback, 4] - bars[pullback - 1, 4]) < 0, "first reversing close freezes the preceding impulse")
    check(not any(breaks(sign * float(bars[i, 4]), sign * extreme, tick) for i in range(pullback, last))
          and breaks(sign * signal["price"], sign * extreme, tick), "first whole-impulse one-tick rebreak")
    for actual, expected, label in [
        (trigger["impulseStartPrice"], start_price, "pre-impulse close"),
        (trigger["referenceAtr"], float(atr[origin]), "pre-impulse A0"),
        (trigger["strengthAtr"], abs(delta) / atr[origin], "three-bar strength/A0"),
        (trigger["efficiency"], abs(delta) / path, "three-bar path efficiency"),
        (trigger["impulseExtreme"], extreme, "frozen impulse extreme excluding first pullback wick"),
        (signal["boundary"], extreme, "actual whole-impulse breakout boundary"),
        (trigger["retracement"], depth, "pullback retracement"),
        (signal["price"], float(bars[last, 4]), "signal close"),
        (signal["atr"], float(atr[last]), "signal-time ATR14"),
    ]:
        equal(actual, expected, label)
    check(trigger["pullbackBars"] == last - pullback + 1, "pullback bars are not a leg count")
    turns = trigger.get("turns", [])
    for turn in turns:
        i, confirmation = index(turn["time"]), index(turn["confirmedAt"])
        allow_signal_close = trigger.get("confirmation", "before-breakout") == "signal-close"
        check(pullback + 2 <= i and confirmation == i + 2
              and (confirmation <= last if allow_signal_close else confirmation < last),
              "turn needs two complete right bars by the configured confirmation clock")
        high = bool(np.all(bars[i, 2] > bars[i - 2:i, 2]) and np.all(bars[i, 2] >= bars[i + 1:i + 3, 2]))
        low = bool(np.all(bars[i, 3] < bars[i - 2:i, 3]) and np.all(bars[i, 3] <= bars[i + 1:i + 3, 3]))
        check(high != low and turn["kind"] == ("high" if high else "low"), "recorded turn geometry and outside-bar ambiguity")
        equal(turn["price"], float(bars[i, 2 if high else 3]), "turn price")
    for before, after in zip(turns, turns[1:]):
        check(before["time"] < after["time"] and before["kind"] != after["kind"], "recorded alternating turn chronology")
    for name in ("pivot", "ema"):
        key = trigger.get(name)
        if not key:
            continue
        check(key.get("confirmedAt", key.get("validatedAt")) <= trigger["impulseStartTime"], "key level confirmed before impulse origin")
        if "retestTime" in key:
            check(trigger["pullbackStartedAt"] <= key["retestTime"] < signal["time"], "key retest precedes the breakout candle")
        if name == "ema":
            check(key["observedAt"] <= signal["time"], "EMA snapshot cannot use future context")
    return adverse, Counter({"signalGeometry": 1, "confirmedTurns": len(turns)})


def mechanical_exit(trade, minutes, bars, atr, tick, trail_atr, end):
    """Independent first stop/next-open exit over this recorded holding period.

Each interval first checks its already-active stop. Only survived minutes feed
the running excursion; a completed 30m ATR can tighten the next interval.
"""
    sign = 1 if trade["side"] == "long" else -1
    entry, stop = trade["entryPrice"], trade["initialStop"]
    reason, mfe, mae, updates = "initial", 0.0, 0.0, 0
    first = (trade["entryTime"] - int(minutes[0, 0])) // MINUTE
    last = (trade["exitTime"] - int(minutes[0, 0])) // MINUTE
    pending = False
    cursor = first
    while cursor <= last:
        if pending:
            return (int(minutes[cursor, 0]), "protection-crossed", float(minutes[cursor, 1]), mfe, mae, updates)
        # Input and entries are UTC aligned; last can be a partial final segment.
        stop_at = min(last + 1, cursor + 30 - int(minutes[cursor, 0]) // MINUTE % 30)
        segment = minutes[cursor:stop_at]
        hit = np.flatnonzero(segment[:, 3] <= stop if sign == 1 else segment[:, 2] >= stop)
        survived = segment[:int(hit[0])] if len(hit) else segment
        if len(survived):
            favourable = float(survived[:, 2].max() - entry if sign == 1 else entry - survived[:, 3].min())
            adverse = float(entry - survived[:, 3].min() if sign == 1 else survived[:, 2].max() - entry)
            mfe, mae = max(mfe, favourable), max(mae, adverse)
        if len(hit):
            minute = segment[int(hit[0])]
            raw = float(min(minute[1], stop) if sign == 1 else max(minute[1], stop))
            mae = max(mae, sign * (entry - raw))
            time = int(minute[0]) + (0 if raw == minute[1] else MINUTE - 1)
            return time, reason, raw, mfe, mae, updates
        close_time = int(segment[-1, 0]) + MINUTE
        if close_time % PERIOD == 0:
            bar_index = (close_time - int(bars[0, 0])) // PERIOD - 1
            target = entry + sign * (mfe - trail_atr * float(atr[bar_index]))
            target = floor(target, tick) if sign == 1 else ceil(target, tick)
            if sign * (target - stop) > tick * .5:
                stop, reason = target, "trailing"
                updates += 1
                pending = sign * (stop - float(segment[-1, 4])) >= 0
        cursor = stop_at
    check(trade["exitTime"] == end - 1, "recorded exit preceded the independent first mechanical exit")
    return end - 1, "end-range", float(minutes[last, 4]), mfe, mae, updates


def audit_row(row, batch, minutes, marks, funding, bars, atr):
    strategy, execution, risk = (row["config"][key] for key in ("strategy", "execution", "risk"))
    check(row["config"]["version"] == 10 and strategy["entry"] == "structured-pullback"
          and strategy["management"] == "chandelier" and strategy["tradeMinutes"] == 30
          and strategy["stopAtr"] == 2 and strategy["trailingAtr"] == 3 and strategy["breakEvenAtr"] == 0
          and risk["dailyLossPct"] == 0 and risk["flattenMinute"] is None, "audit scope is the frozen development protocol")
    tick, fee, slip = execution["tickSize"], execution["feeBps"] / 10000, execution["slippageBps"] / 10000
    def fill(raw, buy):
        return ceil(raw * (1 + slip), tick) if buy else floor(raw * (1 - slip), tick)
    origin = int(minutes[0, 0])
    funding_times = np.asarray([f["time"] // MINUTE * MINUTE for f in funding], dtype=np.int64)
    funding_rates = np.asarray([f["rate"] for f in funding])
    funding_marks = marks[(funding_times - origin) // MINUTE, 1]
    cash, previous_exit, counts = execution["initialCapital"], batch["startTime"] - 1, Counter()
    for trade in row["trades"]:
        side = trade["side"]
        check(side in ("long", "short"), "trade side")
        sign = 1 if side == "long" else -1
        signal = trade["entrySignal"]
        audit_snapshot(trade, strategy["structuredPullback"])
        check(trade["entryTime"] == signal["time"] + 1 and trade["entryTime"] % PERIOD == 0
              and previous_exit < trade["entryTime"] <= trade["exitTime"] < batch["endTime"], "next-minute entry/position chronology")
        anchor, snapshot_counts = signal_snapshot(trade, bars, atr, tick)
        counts.update(snapshot_counts)
        entry_raw = float(minutes[(trade["entryTime"] - origin) // MINUTE, 1])
        check(sign * (entry_raw - anchor) > 0, "opening price invalidates the pullback anchor")
        entry = fill(entry_raw, sign == 1)
        stop = floor(entry - 2 * signal["atr"], tick) if sign == 1 else ceil(entry + 2 * signal["atr"], tick)
        equal(trade["entryPrice"], entry, "adverse next-minute entry")
        equal(trade["initialStop"], stop, "signal ATR initial stop grid")
        distance = abs(entry - stop)
        stop_fill = fill(stop, sign == -1)
        unit_risk = sign * (entry - stop_fill) + (entry + stop_fill) * fee
        limit = min(cash * risk["riskPct"] / unit_risk, cash * risk["maxExposurePct"] / (entry * (1 + fee)))
        units = limit / execution["quantityStep"]
        quantity = math.floor(units + min(8 * np.finfo(float).eps * abs(units), 1e-6)) * execution["quantityStep"]
        equal(trade["quantity"], quantity, "quantity from pre-entry cash, costs and frozen risk")
        check(quantity > 0 and stop > 0 and quantity * entry >= execution["minNotional"], "minimum valid execution")
        time, reason, exit_raw, mfe, mae, updates = mechanical_exit(trade, minutes, bars, atr, tick, 3, batch["endTime"])
        check((time, reason) == (trade["exitTime"], trade["reason"]),
              f"first Chandelier/stop exit mismatch for trade {trade['id']}: {(time, reason)} vs {(trade['exitTime'], trade['reason'])}")
        exit_price = fill(exit_raw, sign == -1)
        carried = (funding_times > trade["entryTime"]) & (funding_times <= trade["exitTime"] // MINUTE * MINUTE)
        paid = float((sign * quantity * funding_marks[carried] * funding_rates[carried]).sum())
        gross = sign * (exit_price - entry) * quantity
        fees = (entry + exit_price) * quantity * fee
        net = gross - fees - paid
        for actual, expected, name in [
            (trade["exitPrice"], exit_price, "adverse exit fill"), (trade["fees"], fees, "fees"),
            (trade["funding"], paid, "funding at carried-minute mark open"), (trade["grossPnl"], gross, "gross PnL"),
            (trade["netPnl"], net, "net PnL"), (trade["risk"], distance * quantity, "frozen initial risk"),
            (trade["rMultiple"], net / (distance * quantity), "net initial R"),
            (trade["slippageAndRounding"], sign * (entry - entry_raw + exit_raw - exit_price) * quantity, "slippage attribution"),
            (trade["mfeR"], mfe / distance, "survived-path MFE"), (trade["maeR"], mae / distance, "survived-path MAE"),
        ]:
            equal(actual, expected, name)
        cash += net
        previous_exit = trade["exitTime"]
        counts.update({"trades": 1, "side:" + side: 1, "exit:" + reason: 1, "protectionUpdates": updates})
    equal(cash, row["metrics"]["finalEquity"], "final account cash")
    return counts


def self_test():
    base = 1_735_689_600_000
    # A final wick creates a line beyond close; the old line protects that
    # candle, and the new order exits next open before its unordered range.
    for side in ("long", "short"):
        values = [[base + i * MINUTE, 100, 101, 99.5, 100, 1, base + (i + 1) * MINUTE - 1] for i in range(31)]
        values[29][2:5] = [105, 99.5, 101]
        values[30][1:5] = [100.5, 120, 90, 100.5]
        minutes = np.asarray(values, dtype=float)
        if side == "short":
            old = minutes.copy()
            minutes[:, 1:5] = np.column_stack((200-old[:, 1], 200-old[:, 3], 200-old[:, 2], 200-old[:, 4]))
        bars = trading_candles(minutes)
        trade = {"side": side, "entryTime": base, "exitTime": base + PERIOD,
                 "entryPrice": 100, "initialStop": 98 if side == "long" else 102}
        found = mechanical_exit(trade, minutes, bars, np.asarray([1.]), .1, 3, base + 2 * PERIOD)
        check(found[:2] == (base + PERIOD, "protection-crossed") and found[3:] == (5., .5, 1), "next-open crossing, mirrored and without same-bar lookahead")
        # ATR expansion on the second close would loosen a freshly computed
        # line. The existing tighter line persists and fills the next gap.
        values = [[base + i * MINUTE, 104, 104.5, 103, 104, 1, base + (i + 1) * MINUTE - 1] for i in range(61)]
        values[0][1:5] = [100, 105, 99.5, 104]
        values[60][1:5] = [100, 110, 95, 100]
        minutes = np.asarray(values, dtype=float)
        if side == "short":
            old = minutes.copy()
            minutes[:, 1:5] = np.column_stack((200-old[:, 1], 200-old[:, 3], 200-old[:, 2], 200-old[:, 4]))
        bars = trading_candles(minutes)
        trade["exitTime"] = base + 2 * PERIOD
        found = mechanical_exit(trade, minutes, bars, np.asarray([1., 2.]), .1, 3, base + 3 * PERIOD)
        check(found[:3] == (base + 2 * PERIOD, "trailing", 100.) and found[-1] == 1,
              "ATR growth must not loosen protection; the next gap executes at its open")
    # The first reversing bar has a huge high. It cannot alter the already
    # frozen pre-pullback whole-impulse breakout level.
    closes = [100, 102, 104, 106, 107, 105, 108.1]
    bars = np.asarray([[base+i*PERIOD, close, close+1, close-1, close, 1] for i, close in enumerate(closes)])
    bars[5, 2], bars[6, 3] = 120, 105
    end = lambda i: base + (i + 1) * PERIOD - 1
    trigger = {"kind": "structured-pullback", "setupId": end(3), "impulseStartTime": end(0),
               "impulseConfirmedAt": end(3), "impulseEndTime": end(4), "pullbackStartedAt": end(5),
               "impulseStartPrice": 100, "impulseExtreme": 108, "referenceAtr": 2,
               "strengthAtr": 3, "efficiency": 1, "pullbackBars": 2, "retracement": .5, "turns": []}
    trade = {"side": "long", "entrySignal": {"time": end(6), "price": 108.1, "boundary": 108, "atr": 2, "trigger": trigger}}
    signal_snapshot(trade, bars, np.full(7, 2.), .1)
    wrong = copy.deepcopy(trade); wrong["entrySignal"]["trigger"]["impulseExtreme"] = 120
    try:
        signal_snapshot(wrong, bars, np.full(7, 2.), .1)
    except ValueError:
        pass
    else:
        raise ValueError("polluted first-pullback-wick snapshot was accepted")
    # The new policy uses the completed signal candle only as the second
    # right-side confirmation of a PRIOR low; it never turns that signal
    # candle itself into a pivot or admits an unclosed right-side candle.
    closes = [100, 102, 104, 106, 107, 105, 104.6, 104.1, 105, 108.1]
    bars = np.asarray([[base+i*PERIOD, close, close+1, close-1, close, 1]
                       for i, close in enumerate(closes)])
    bars[5:, 3] = [104.2, 104.5, 104, 104.5, 104.8]
    trigger = copy.deepcopy(trigger)
    trigger.update({"confirmation": "signal-close", "keyRole": "pullback-retest",
                    "pullbackBars": 5, "turns": [{"kind": "low", "time": end(7),
                        "confirmedAt": end(9), "price": 104}]})
    trade["entrySignal"] = {"time": end(9), "price": 108.1, "boundary": 108, "atr": 2, "trigger": trigger}
    signal_snapshot(trade, bars, np.full(10, 2.), .1)
    trigger["confirmation"] = "before-breakout"
    try:
        signal_snapshot(trade, bars, np.full(10, 2.), .1)
    except ValueError:
        pass
    else:
        raise ValueError("old confirmation policy incorrectly admitted a signal-close turn")


def run(args):
    check(not args.output.exists(), "choose a new audit output path")
    check(sha(PLAN) == PLAN_SHA and sha(MANIFEST) == MANIFEST_SHA and sha(RISK_SOURCE) == RISK_SHA, "frozen audit input mismatch")
    spec = importlib.util.spec_from_file_location("_structured_risk_audit", RISK_SOURCE)
    risk_auditor = importlib.util.module_from_spec(spec); spec.loader.exec_module(risk_auditor)
    evidence = load_evidence(PLAN, MANIFEST, args.input)
    plan = evidence["plan"]
    check(len(plan["windows"]) == 1 and len(plan["symbols"]) == 3 and len(plan["candidates"]) == 5, "frozen development scope")
    dependencies = source_fingerprint(*DEPENDENCIES)
    sources = Sources(evidence["manifest"])
    counts, accounts, provenance = Counter(), [], []
    for window in plan["windows"]:
        batches, receipts = audit_window(evidence, window)
        provenance.extend(receipts)
        for batch in batches:
            begin = min(row["warmupStart"] for row in batch["results"])
            check(batch["startTime"] - begin == 4 * DAY and batch["endTime"] - batch["startTime"] == 487 * DAY, "four-day warmup and 487 active days")
            minutes, marks, funding = sources.load(batch["symbol"], begin, batch["startTime"], batch["endTime"])
            bars, active_marks = trading_candles(minutes), marks[(batch["startTime"] - begin) // MINUTE:]
            atr = wilder_atr(bars)
            for row in batch["results"]:
                check(row["warmupStart"] == begin, "candidate ATR initialization differs")
                ledger = audit_row(row, batch, minutes, marks, funding, bars, atr)
                triggered, equity = risk_auditor.reconstruct(row, batch, active_marks, funding)
                check(not triggered, "disabled daily guard triggered")
                counts.update(ledger); counts.update(equity); counts["accounts"] += 1
                accounts.append({"symbol": batch["symbol"], "candidate": row["id"], "ledger": dict(ledger), "equity": dict(equity), "status": "passed"})
            print("audited", batch["symbol"], len(batch["results"]), "accounts", flush=True)
    check(counts["accounts"] == 15 and source_fingerprint(*DEPENDENCIES) == dependencies, "account count or audit source changed")
    check(sha(PLAN) == PLAN_SHA and sha(MANIFEST) == MANIFEST_SHA, "frozen inputs changed")
    result = {"version": "structured-recorded-execution-audit-2", "status": "passed", "planSha256": PLAN_SHA,
              "manifestSha256": MANIFEST_SHA, "runSha256": sha(args.input / "run.json"),
              "selectionSha256": sha(args.input / "selection.json"), "scriptSha256": sha(__file__),
              "dependenciesSha256": dependencies, "riskAuditorSha256": RISK_SHA,
              "counts": dict(counts), "accounts": accounts, "provenance": provenance,
              "sourceHashes": [{"path": path, "sha256": digest} for path, digest in sorted(sources.verified.items())],
              "scope": "Every recorded development trade: independent complete-candle ATR, three-bar impulse A0/efficiency, frozen pre-pullback extreme and first whole-impulse rebreak, recorded confirmed-turn geometry/causality with each configured before-breakout or signal-close policy, next-minute fills, cost-aware quantity, initial risk, first minute stop versus close-updated monotone dynamic-ATR Chandelier/next-open protection crossing, fees/funding/slippage/R/MFE/MAE. Reconstruct each minute cash/mark equity and canonical daily close from recorded positions. Verify v10 snapshot policies and all recorded entry gates.",
              "limits": ["Entries remain recorded inputs. Observer opportunity labels are audited separately. No exhaustive setup discovery, first eligible impulse choice, missing/rejected entries, full EMA filter or cooldown/disabled-state replay.",
                         "Recorded pivot-turn geometry and key-snapshot chronology are checked, but complete shape-label classification and historical validated-EMA/key-level selection are not independently reconstructed.",
                         "The audit shares frozen numerical/source/account utilities; it is not a second strategy engine or an independent source of market data. No target validation or future holdout prices/results are read.",
                         "MFE/MAE follow the production survived-minute path and exclude unordered favorable extremes on the stop-hit minute; they are not unbiased forward-event opportunity statistics.",
                         "Minute OHLC with fixed bps/tick fills does not establish real liquidity, latency, partial fills, liquidation behavior or future profitability."]}
    write_once(args.output, result)
    print("passed", dict(counts), "sha256", sha(args.output), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/trend-structured-v10")
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/structured-v2/execution-audit.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("synthetic mirrored next-open protection and frozen-impulse tests passed")
    else:
        run(args)
