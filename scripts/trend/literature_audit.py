"""Read-only price/ledger audit for the four declared v8 channel contrasts.

This verifies recorded trades; it does not simulate a second account, decide
which rejected signals should trade, or select a research candidate.
"""
import argparse
from collections import Counter
import math
from pathlib import Path

import numpy as np

from artifacts import audit_window, ensure_writable, load_evidence, read, sha, source_fingerprint, write_once
from breakout_study import MinuteSources, breaks, prior_high, trading_candles, validate_minutes, wilder_atr
from download import validate_funding
from protocol import ROOT, timestamp

MINUTE = 60_000
PERIOD = 30 * MINUTE
VERSION = "trend-literature-audit-1"


def check(condition, label):
    if not condition:
        raise ValueError(label)


def equal(actual, expected, label):
    check(math.isfinite(actual) and math.isfinite(expected)
          and math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-7),
          f"{label}: {actual} != {expected}")


def prior_low(bars, lookback):
    result = np.full(len(bars), np.nan)
    if len(bars) > lookback:
        result[lookback:] = np.lib.stride_tricks.sliding_window_view(
            bars[:, 3], lookback)[:-1].min(axis=1)
    return result


def episode_starts(bars, upper, tick, start, end):
    """Raw long episodes ignore availability and warmup; return frozen firsts.

    Re-arming uses the FIRST boundary, not a later rolling channel. A reset
    candle cannot trigger, even if it breaks today's lower rolling channel.
    """
    active, starts, counts = None, {}, Counter()
    for i, bar in enumerate(bars):
        time = int(bar[0]) + PERIOD - 1
        if bar[0] < start or time >= end or i < 13 or not math.isfinite(upper[i]):
            continue
        qualifies = breaks(float(bar[4]), float(upper[i]), tick)
        counts["rawQualifyingCloses"] += int(qualifies)
        if active is not None:
            if bar[4] <= active:
                active = None
                counts["resets"] += 1
            continue
        if qualifies:
            active = float(upper[i])
            starts[time] = active
    counts["episodes"] = len(starts)
    return starts, dict(counts)


class Sources(MinuteSources):
    """Share hash checks, but separate price warmup from active funding dates."""
    def load(self, symbol, price_start, active_start, end):
        source = self.manifest["symbols"][symbol]
        checksums = {r["path"]: r["csvSha256"] for r in source["archives"]}
        self.verify(source["funding"], source["fundingSha256"])
        funding = read(source["funding"])
        validate_funding(funding, active_start, end)
        joined = [[], []]
        for part in source["partitions"]:
            year, month = map(int, part["month"].split("-"))
            first = timestamp(part["month"] + "-01")
            last = timestamp(f"{year + (month == 12):04d}-{1 if month == 12 else month + 1:02d}-01")
            if last <= price_start or first >= end:
                continue
            for index, key in enumerate(("candles", "marks")):
                path = part[key]
                self.verify(path, checksums[path])
                with open(path) as stream:
                    skip = int(stream.readline().startswith("open_time"))
                rows = np.loadtxt(path, delimiter=",", usecols=range(7), skiprows=skip, ndmin=2)
                validate_minutes(rows)
                joined[index].append(rows[(rows[:, 0] >= price_start) & (rows[:, 0] < end)])
        values = [np.concatenate(parts) if parts else np.empty((0, 7)) for parts in joined]
        for rows in values:
            validate_minutes(rows)
            check(len(rows) == (end - price_start) // MINUTE and rows[0, 0] == price_start
                  and rows[-1, 0] == end - MINUTE, "incomplete requested minute window")
        check(np.array_equal(values[0][:, 0], values[1][:, 0]), "mark/traded calendars differ")
        return *values, [f for f in funding if active_start <= f["time"] < end]


def first_mechanical_exit(minutes, bars, lower, trade):
    """Earliest recorded-position hard stop/channel; risk exits audited apart.

    A pending channel executes before the next minute's range. The old hard
    stop is checked before that minute can confirm a new channel intent.
    """
    origin = int(minutes[0, 0])
    entry, exit_time = trade["entryTime"], trade["exitTime"]
    first = (entry - origin) // MINUTE
    last = (exit_time - origin) // MINUTE
    touched = np.flatnonzero(minutes[first:last + 1, 3] <= trade["initialStop"])
    stop = None
    if len(touched):
        row = minutes[first + int(touched[0])]
        raw = min(float(row[1]), trade["initialStop"])
        time = int(row[0]) if raw == row[1] else int(row[0]) + MINUTE - 1
        stop = (time, "initial", raw)
    # A position opened at a boundary participates in that ensuing full K.
    due = bars[:, 0] + PERIOD
    crossed = np.flatnonzero((bars[:, 0] >= entry) & (due <= exit_time)
                            & (bars[:, 4] < lower))
    channel = None
    if len(crossed):
        time = int(due[int(crossed[0])])
        channel = (time, "channel-exit", float(minutes[(time - origin) // MINUTE, 1]))
    # A channel already queued at the prior close wins a same-open stop gap.
    candidates = [value for value in [channel, stop] if value is not None]
    return min(candidates, key=lambda value: value[0]) if candidates else None


def compare_baseline(current, historical):
    for key in ("trades", "daily", "metrics"):
        check(current[key] == historical[key], f"old baseline differs: {key}")
    left, right = current["config"], historical["config"]
    check(left["execution"] == right["execution"] and left["risk"] == right["risk"],
          "baseline account/cost configuration differs")
    strategy = dict(left["strategy"])
    check(strategy.pop("channelExitBars") == right["strategy"]["breakoutBars"] // 2
          and strategy.pop("breakoutReentry") == "every-close", "baseline policy differs")
    check(strategy == right["strategy"] and current["warmupStart"] == historical["warmupStart"],
          "baseline strategy/warmup differs")


def audit_row(row, batch, minutes, marks, funding):
    config = row["config"]
    strategy, execution, risk = config["strategy"], config["execution"], config["risk"]
    check(strategy["tradeMinutes"] == 30 and strategy["entry"] == "breakout"
          and strategy["direction"] == "long" and strategy["filter"] == "none"
          and strategy["management"] == "channel" and strategy["stopAtr"] == 2
          and strategy["breakEvenAtr"] == 0 and risk["flattenMinute"] is None,
          "audit scope requires the declared long 30m channel contrasts")
    prices = minutes[minutes[:, 0] >= row["warmupStart"]]
    bars = trading_candles(prices)
    atr = wilder_atr(bars)
    upper = prior_high(bars, strategy["breakoutBars"])
    lower = prior_low(bars, strategy["channelExitBars"])
    tick, fee, slip = execution["tickSize"], execution["feeBps"] / 10000, execution["slippageBps"] / 10000
    floor = lambda price: math.floor(price / tick + 1e-9) * tick
    ceil = lambda price: math.ceil(price / tick - 1e-9) * tick
    fill = lambda price, buy: ceil(price * (1 + slip)) if buy else floor(price * (1 - slip))
    starts, episodes = episode_starts(bars, upper, tick, batch["startTime"], batch["endTime"])
    origin = int(minutes[0, 0])
    funding_times = np.asarray([f["time"] // MINUTE * MINUTE for f in funding])
    funding_rates = np.asarray([f["rate"] for f in funding])
    funding_marks = marks[((funding_times - origin) // MINUTE).astype(int), 1]
    cash, previous_exit, counts = execution["initialCapital"], -1, Counter()
    for trade in row["trades"]:
        signal = trade["entrySignal"]
        entry_time, exit_time = trade["entryTime"], trade["exitTime"]
        check(trade["side"] == "long" and entry_time == signal["time"] + 1
              and entry_time % PERIOD == 0 and previous_exit < entry_time,
              "trade side/next-open/position chronology")
        index = (signal["time"] + 1 - int(bars[0, 0])) // PERIOD - 1
        check(0 <= index < len(bars) and bars[index, 0] >= batch["startTime"]
              and signal["lookbackBars"] == strategy["breakoutBars"] and signal.get("trigger") is None,
              "signal clock/type/lookback")
        for actual, expected, name in [(signal["price"], bars[index, 4], "signal close"),
                                       (signal["atr"], atr[index], "signal ATR"),
                                       (signal["boundary"], upper[index], "previous N highs")]:
            equal(actual, float(expected), name)
        check(breaks(signal["price"], signal["boundary"], tick), "one-tick breakout")
        if strategy["breakoutReentry"] == "episode":
            check(signal["time"] in starts, "entry is not first raw breakout of its episode")
            equal(signal["boundary"], starts[signal["time"]], "frozen episode boundary")
            counts["episodeTrades"] += 1
        entry_raw = float(minutes[(entry_time - origin) // MINUTE, 1])
        entry = fill(entry_raw, True)
        stop = floor(entry - 2 * float(atr[index]))
        equal(trade["entryPrice"], entry, "next-open adverse entry")
        equal(trade["initialStop"], stop, "frozen signal ATR initial stop")
        quantity = trade["quantity"]
        stop_fill = fill(stop, False)
        limit = min(cash * risk["riskPct"] / ((entry - stop_fill) + (entry + stop_fill) * fee),
                    cash * risk["maxExposurePct"] / (entry * (1 + fee)))
        units = limit / execution["quantityStep"]
        expected_quantity = math.floor(units + min(8 * np.finfo(float).eps * abs(units), 1e-6)) * execution["quantityStep"]
        equal(quantity, expected_quantity, "recorded cash risk/exposure quantity")
        check(quantity > 0 and quantity * entry >= execution["minNotional"], "minimum notional")
        found = first_mechanical_exit(minutes, bars, lower, trade)
        reason = trade["reason"]
        if reason in ("initial", "channel-exit"):
            check(found is not None and found[:2] == (exit_time, reason),
                  f"first stop/channel mismatch: {found} vs {(exit_time, reason)}")
            raw_exit = found[2]
        elif reason == "daily-loss":
            check(exit_time % MINUTE == 0 and (found is None or found[0] >= exit_time),
                  "risk exit follows an earlier mechanical exit")
            raw_exit = float(minutes[(exit_time - origin) // MINUTE, 1])
        elif reason == "end-range":
            check(exit_time == batch["endTime"] - 1 and found is None, "terminal exit ignores mechanical exit")
            raw_exit = float(minutes[-1, 4])
        else:
            raise ValueError(f"unexpected channel exit reason: {reason}")
        exit_price = fill(raw_exit, False)
        equal(trade["exitPrice"], exit_price, "adverse exit fill")
        carried = (funding_times > entry_time) & (funding_times <= exit_time // MINUTE * MINUTE)
        funding_paid = sum(quantity * funding_marks[carried] * funding_rates[carried])
        for actual, expected, name in [
            (trade["funding"], funding_paid, "carried-position funding at mark open"),
            (trade["fees"], (entry + exit_price) * quantity * fee, "fees"),
            (trade["grossPnl"], (exit_price - entry) * quantity, "gross PnL"),
            (trade["netPnl"], trade["grossPnl"] - trade["fees"] - funding_paid, "net PnL"),
            (trade["risk"], (entry - stop) * quantity, "initial R"),
            (trade["rMultiple"], trade["netPnl"] / trade["risk"], "net R"),
            (trade["slippageAndRounding"], ((entry - entry_raw) + (raw_exit - exit_price)) * quantity, "slippage attribution"),
        ]:
            equal(actual, expected, name)
        cash += trade["netPnl"]
        previous_exit = exit_time
        counts["trades"] += 1
        counts["exit:" + reason] += 1
    equal(cash, row["metrics"]["finalEquity"], "final cash")
    equal(cash, row["daily"][-1]["equity"], "last daily equity")
    if strategy["breakoutReentry"] == "episode":
        episodes["firstsWhileHolding"] = sum(any(t["entryTime"] <= time < t["exitTime"]
                                                   for t in row["trades"]) for time in starts)
        episodes["executedFirsts"] = len(row["trades"])
        episodes["notExecutedFirsts"] = len(starts) - len(row["trades"])
    return counts, episodes if strategy["breakoutReentry"] == "episode" else None


def run(args):
    ensure_writable(args.output)
    check(not args.output.exists(), "audit output exists; use a new output file")
    for directory in [args.input, args.baseline_input]:
        check(directory.resolve() not in args.output.resolve().parents, "audit output must be separate from raw inputs")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    plan = evidence["plan"]
    baseline_plan = ROOT / plan["sourceStudy"]["plan"]
    check(sha(baseline_plan) == plan["sourceStudy"]["sha256"], "source-study identity")
    old = load_evidence(baseline_plan, args.baseline_input / "manifest.json", args.baseline_input)
    check(sha(args.binary) == evidence["selection"]["binarySha256"], "native binary differs from replay")
    sources, counts, episode_rows, inputs, old_inputs = Sources(evidence["manifest"]), Counter(), [], [], []
    for window in plan["windows"]:
        old_window = next(w for w in old["plan"]["windows"] if w["id"] == window["id"])
        check((window["start"], window["end"]) == (old_window["start"], old_window["end"]), "baseline window dates")
        batches, provenance = audit_window(evidence, window)
        old_batches, old_provenance = audit_window(old, old_window)
        inputs.extend(provenance)
        old_inputs.extend(old_provenance)
        old_by_symbol = {batch["symbol"]: batch for batch in old_batches}
        for batch in batches:
            symbol = batch["symbol"]
            print(f"audit {window['id']}/{symbol}: hash sources and verify recorded trades", flush=True)
            minutes, marks, funding = sources.load(symbol, min(r["warmupStart"] for r in batch["results"]),
                                                   batch["startTime"], batch["endTime"])
            old_rows = {row["id"]: row for row in old_by_symbol[symbol]["results"]}
            for row in batch["results"]:
                checked, episodes = audit_row(row, batch, minutes, marks, funding)
                counts.update(checked)
                counts["rows"] += 1
                if episodes is not None:
                    episode_rows.append({"window": window["id"], "symbol": symbol, "candidate": row["id"], **episodes})
                if row["id"] in [plan["baseline"], plan["baseline"] + "-stress"]:
                    suffix = "-stress" if row["id"].endswith("-stress") else ""
                    compare_baseline(row, old_rows[args.baseline_candidate + suffix])
                    counts["exactBaselineRows"] += 1
            counts["batches"] += 1
    check(sha(args.binary) == evidence["selection"]["binarySha256"], "binary changed during audit")
    result = {
        "version": VERSION, "status": "passed", "planSha256": sha(args.plan),
        "manifestSha256": sha(args.manifest), "runSha256": sha(args.input / "run.json"),
        "binarySha256": sha(args.binary), "engine": evidence["engine"],
        "auditScriptSha256": sha(__file__),
        "auditDependenciesSha256": source_fingerprint("literature_audit.py", "breakout_study.py", "artifacts.py", "daily.py", "download.py", "protocol.py", "warmup.py"),
        "numpyVersion": np.__version__, "numericTolerance": {"relative": 1e-10, "absolute": 1e-7},
        "counts": dict(counts), "sourceFilesRehashed": len(sources.verified),
        "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
        "nativeInputs": inputs, "baselineInputs": old_inputs, "episodeRows": episode_rows,
        "baselineRegression": "Exact trades (all fields), daily equity and metrics; only configuration/schema/engine identity differs. Both normal and stressed baseline rows are checked.",
        "scope": "Every recorded long trade: source hashes and complete calendars; per-candidate UTC 30m candles and Wilder ATR; prior-N close breakout excluding current candle; episode-first time/frozen boundary; next-open tick fill; fixed 2ATR stop; earliest hard stop versus independent channel-exit window; recorded cash risk/exposure quantity; historical carried-position funding at mark open; fees/slippage/gross/net/R/final cash.",
        "limits": [
            "This verifies recorded trades and all raw episode firsts, not a second account replay. Daily-loss triggers and other no-trade/rejection decisions are not independently reconstructed.",
            "Native CLI omits setup events. Every episode trade is proven to be a first raw breakout, but unavailable/filter event reasons are not directly compared. Not-executed firsts include all causes; holding counts are descriptive.",
            "Daily calendars and receipt/config/selection identities use shared audit helpers. Indicator and source-validation helpers are shared with the independent event study, not Rust.",
            "Rows include cost reruns; their trade counts are not independent statistical sample sizes. No rule selection or counterfactual trades occur here.",
        ],
    }
    write_once(args.output, result)
    print({"output": str(args.output), "status": "passed", "counts": dict(counts)}, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "baseline-input", "binary", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--baseline-candidate", default="m30-n40-channel")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
