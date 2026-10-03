"""Read-only executed-trade audit for the frozen channel mechanism study.

Reuses historical source/receipt checks, not the native trading engine. This
does not generate counterfactual trades or independently reconstruct filters.
"""
import argparse
from collections import Counter
import hashlib
import math
from pathlib import Path

import numpy as np

from artifacts import audit_window, ensure_writable, load_evidence, sha, source_fingerprint, write_once
from breakout_study import breaks, prior_high, trading_candles, wilder_atr
from literature_audit import MINUTE, PERIOD, Sources as HistoricalSources, check, equal, prior_low
from protocol import ROOT

VERSION = "trend-details-audit-1"
DEPENDENCIES = ("details_audit.py", "literature_audit.py", "breakout_study.py", "artifacts.py",
                "daily.py", "download.py", "protocol.py", "warmup.py")


class Sources(HistoricalSources):
    """Retain per-window continuity checks and verify scoped slice lineage."""
    def __init__(self, manifest):
        super().__init__(manifest)
        self.records, self.lineage_checked = {}, set()
        def register(record):
            path = record["path"]
            if path in self.records:
                check(self.records[path]["csvSha256"] == record["csvSha256"], "conflicting source lineage hash")
                return
            self.records[path] = record
            for source in record.get("sources", []):
                register(source)
        for symbol in manifest["symbols"].values():
            for record in symbol["archives"]:
                register(record)

    def verify(self, path, expected):
        super().verify(path, expected)
        if path not in self.records or path in self.lineage_checked:
            return
        record = self.records[path]
        check(record["csvSha256"] == expected, "source lineage differs from partition hash")
        self.lineage_checked.add(path)
        for source in record.get("sources", []):
            check(source["path"] != path, "self-referencing source lineage")
            self.verify(source["path"], source["csvSha256"])
        scope = record.get("validation", {})
        if scope.get("policy") == "continuous-replay-interval-v1":
            check(len(record.get("sources", [])) == 1 and len(scope.get("intervals", [])) == 1,
                  "continuous replay slice requires one source and interval")
            start, end = (scope["intervals"][0][key] for key in ("start", "end"))
            check(type(start) is int and type(end) is int and start < end
                  and start % MINUTE == end % MINUTE == 0, "invalid replay slice scope")
            digest, next_time = hashlib.sha256(), start
            with Path(record["sources"][0]["path"]).open() as stream:
                for line in stream:
                    if line.startswith("open_time"):
                        continue
                    time = int(line.split(",", 1)[0])
                    if start <= time < end:
                        check(time == next_time, "replay slice source has a missing/unordered required minute")
                        digest.update((line.rstrip("\r\n") + "\n").encode())
                        next_time += MINUTE
            check(next_time == end and digest.hexdigest() == expected,
                  "replay slice is not the exact declared source interval")


def first_mechanical_exit(minutes, bars, boundary, trade):
    """Hard stop versus completed-candle channel, mirrored for short positions.

    A previously queued channel wins a same-open stop gap; a stop touched in
    the prior minute wins before that minute can confirm a channel crossing.
    Equality at a channel boundary is not an exit.
    """
    long = trade["side"] == "long"
    origin = int(minutes[0, 0])
    entry, exit_time = trade["entryTime"], trade["exitTime"]
    first, last = (entry - origin) // MINUTE, (exit_time - origin) // MINUTE
    path = minutes[first:last + 1]
    touched = np.flatnonzero(path[:, 3] <= trade["initialStop"] if long
                             else path[:, 2] >= trade["initialStop"])
    stop = None
    if len(touched):
        minute = path[int(touched[0])]
        raw = (min if long else max)(float(minute[1]), trade["initialStop"])
        time = int(minute[0]) if raw == minute[1] else int(minute[0]) + MINUTE - 1
        stop = (time, "initial", raw)
    due = bars[:, 0] + PERIOD
    crossing = bars[:, 4] < boundary if long else bars[:, 4] > boundary
    crossed = np.flatnonzero((bars[:, 0] >= entry) & (due <= exit_time) & crossing)
    channel = None
    if len(crossed):
        time = int(due[int(crossed[0])])
        channel = (time, "channel-exit", float(minutes[(time - origin) // MINUTE, 1]))
    candidates = [value for value in [channel, stop] if value is not None]
    return min(candidates, key=lambda value: value[0]) if candidates else None


def compare_baseline(current, historical):
    """Both studies use v8 and the same engine: no strategy normalization."""
    for key in ("config", "warmupStart", "trades", "daily", "metrics"):
        check(current[key] == historical[key], f"old N320 baseline differs: {key}")


def audit_row(row, batch, minutes, marks, funding):
    strategy, execution, risk = (row["config"][key] for key in ("strategy", "execution", "risk"))
    check(row["config"]["version"] == 8 and strategy["tradeMinutes"] == 30
          and strategy["entry"] == "breakout" and strategy["direction"] in ("long", "both")
          and strategy["filter"] in ("none", "background") and strategy["management"] == "channel"
          and strategy["stopAtr"] in (2, 3) and strategy["breakEvenAtr"] == 0
          and strategy.get("breakoutReentry", "every-close") == "every-close"
          and risk["flattenMinute"] is None,
          "audit scope requires the declared v8 30m fixed-stop/channel contrasts")
    bars = trading_candles(minutes[minutes[:, 0] >= row["warmupStart"]])
    atr = wilder_atr(bars)
    entry_boundary = {"long": prior_high(bars, strategy["breakoutBars"]),
                      "short": prior_low(bars, strategy["breakoutBars"])}
    exit_boundary = {"long": prior_low(bars, strategy["channelExitBars"]),
                     "short": prior_high(bars, strategy["channelExitBars"])}
    tick, fee, slip = execution["tickSize"], execution["feeBps"] / 10000, execution["slippageBps"] / 10000
    floor = lambda price: math.floor(price / tick + 1e-9) * tick
    ceil = lambda price: math.ceil(price / tick - 1e-9) * tick
    fill = lambda price, buy: ceil(price * (1 + slip)) if buy else floor(price * (1 - slip))
    origin = int(minutes[0, 0])
    funding_times = np.asarray([f["time"] // MINUTE * MINUTE for f in funding], dtype=np.int64)
    funding_rates = np.asarray([f["rate"] for f in funding])
    funding_marks = marks[(funding_times - origin) // MINUTE, 1]
    cash, previous_exit, counts = execution["initialCapital"], -1, Counter()
    for trade in row["trades"]:
        side = trade["side"]
        check(side in ("long", "short") and (strategy["direction"] == "both" or side == "long"),
              "trade violates configured direction")
        sign, long = (1 if side == "long" else -1), side == "long"
        signal = trade["entrySignal"]
        entry_time, exit_time = trade["entryTime"], trade["exitTime"]
        check(entry_time == signal["time"] + 1 and entry_time % PERIOD == 0
              and previous_exit < entry_time <= exit_time < batch["endTime"],
              "next-open/position chronology")
        index = (signal["time"] + 1 - int(bars[0, 0])) // PERIOD - 1
        check(0 <= index < len(bars) and bars[index, 0] >= batch["startTime"]
              and signal["lookbackBars"] == strategy["breakoutBars"] and signal.get("trigger") is None,
              "signal clock/type/lookback")
        for actual, expected, name in [(signal["price"], bars[index, 4], "signal close"),
                                       (signal["atr"], atr[index], "signal ATR"),
                                       (signal["boundary"], entry_boundary[side][index], "previous N boundary")]:
            equal(actual, float(expected), name)
        check(breaks(sign * signal["price"], sign * signal["boundary"], tick), "one-tick breakout")
        if strategy["maxCostAtr"] > 0:
            expected_cost = (2 * signal["price"] * (fee + slip) + 2 * tick) / signal["atr"]
            check(expected_cost <= strategy["maxCostAtr"], "executed entry violates cost gate")
            counts["costGateTrades"] += 1
        entry_raw = float(minutes[(entry_time - origin) // MINUTE, 1])
        entry = fill(entry_raw, long)
        stop = (floor if long else ceil)(entry - sign * strategy["stopAtr"] * float(atr[index]))
        check(stop > 0 and sign * (entry - stop) > 0, "invalid initial stop")
        equal(trade["entryPrice"], entry, "next-open adverse entry")
        equal(trade["initialStop"], stop, "frozen signal ATR initial stop")
        quantity = trade["quantity"]
        stop_fill = fill(stop, not long)
        unit_risk = sign * (entry - stop_fill) + (entry + stop_fill) * fee
        limit = min(cash * risk["riskPct"] / unit_risk,
                    cash * risk["maxExposurePct"] / (entry * (1 + fee)))
        units = limit / execution["quantityStep"]
        expected_quantity = math.floor(units + min(8 * np.finfo(float).eps * abs(units), 1e-6)) * execution["quantityStep"]
        equal(quantity, expected_quantity, "recorded cash risk/exposure quantity")
        check(quantity > 0 and quantity * entry >= execution["minNotional"], "minimum notional")
        found = first_mechanical_exit(minutes, bars, exit_boundary[side], trade)
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
        exit_price = fill(raw_exit, not long)
        equal(trade["exitPrice"], exit_price, "adverse exit fill")
        # Funding is charged before exits/new entries: entry-minute events do
        # not apply; events in an exit minute do apply to a carried position.
        carried = (funding_times > entry_time) & (funding_times <= exit_time // MINUTE * MINUTE)
        funding_paid = sum(sign * quantity * funding_marks[carried] * funding_rates[carried])
        gross = sign * (exit_price - entry) * quantity
        fees = (entry + exit_price) * quantity * fee
        net = gross - fees - funding_paid
        initial_risk = abs(entry - stop) * quantity
        for actual, expected, name in [
            (trade["funding"], funding_paid, "carried-position funding at mark open"),
            (trade["fees"], fees, "fees"), (trade["grossPnl"], gross, "gross PnL"),
            (trade["netPnl"], net, "net PnL"), (trade["risk"], initial_risk, "initial R"),
            (trade["rMultiple"], net / initial_risk, "net R"),
            (trade["slippageAndRounding"], sign * ((entry - entry_raw) + (raw_exit - exit_price)) * quantity,
             "slippage attribution"),
        ]:
            equal(actual, expected, name)
        cash += net
        previous_exit = exit_time
        counts.update({"trades": 1, "side:" + side: 1, "exit:" + reason: 1})
    equal(cash, row["metrics"]["finalEquity"], "final cash")
    equal(cash, row["daily"][-1]["equity"], "last daily equity")
    return counts


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
    dependencies = source_fingerprint(*DEPENDENCIES)
    old_windows = {window["id"]: window for window in old["plan"]["windows"]}
    check(set(old_windows) <= {window["id"] for window in plan["windows"]}, "missing historical regression window")
    sources, counts, inputs, old_inputs, rows = Sources(evidence["manifest"]), Counter(), [], [], []
    for window in plan["windows"]:
        batches, provenance = audit_window(evidence, window)
        inputs.extend(provenance)
        old_by_symbol = {}
        if window["id"] in old_windows:
            old_window = old_windows[window["id"]]
            check((window["start"], window["end"]) == (old_window["start"], old_window["end"]), "baseline window dates")
            old_batches, old_provenance = audit_window(old, old_window)
            old_inputs.extend(old_provenance)
            old_by_symbol = {batch["symbol"]: batch for batch in old_batches}
        else:
            check(window.get("candidateScope") == "selected-and-baseline", "new window must use frozen selected/baseline scope")
        for batch in batches:
            symbol = batch["symbol"]
            print(f"audit {window['id']}/{symbol}: sources and all recorded trades", flush=True)
            minutes, marks, funding = sources.load(symbol, min(row["warmupStart"] for row in batch["results"]),
                                                   batch["startTime"], batch["endTime"])
            historical = {row["id"]: row for row in old_by_symbol.get(symbol, {}).get("results", [])}
            for row in batch["results"]:
                try:
                    checked = audit_row(row, batch, minutes, marks, funding)
                    if historical and row["id"] in (plan["baseline"], plan["baseline"] + "-stress"):
                        suffix = "-stress" if row["id"].endswith("-stress") else ""
                        compare_baseline(row, historical[args.baseline_candidate + suffix])
                        counts["exactBaselineRows"] += 1
                except ValueError as error:
                    raise ValueError(f"{window['id']}/{symbol}/{row['id']}: {error}") from error
                counts.update(checked)
                counts["rows"] += 1
                rows.append({"window": window["id"], "symbol": symbol, "candidate": row["id"], **checked})
            counts["batches"] += 1
    check(evidence["engine"] == old["engine"], "baseline engine identity differs")
    check(sha(args.plan) == evidence["planSha256"] and sha(args.manifest) == evidence["manifestSha256"],
          "plan/manifest changed during audit")
    check(sha(args.binary) == evidence["selection"]["binarySha256"], "binary changed during audit")
    check(source_fingerprint(*DEPENDENCIES) == dependencies, "audit dependencies changed during audit")
    result = {
        "version": VERSION, "status": "passed", "planSha256": evidence["planSha256"],
        "manifestSha256": evidence["manifestSha256"], "runSha256": sha(args.input / "run.json"),
        "binarySha256": sha(args.binary), "engine": evidence["engine"],
        "auditScriptSha256": sha(__file__), "auditDependenciesSha256": dependencies,
        "numpyVersion": np.__version__, "numericTolerance": {"relative": 1e-10, "absolute": 1e-7},
        "counts": dict(counts), "rows": rows, "sourceFilesRehashed": len(sources.verified),
        "sourceHashes": [{"path": path, "sha256": value} for path, value in sorted(sources.verified.items())],
        "nativeInputs": inputs, "baselineInputs": old_inputs,
        "baselineRegression": "Exact v8 config, per-candidate warmup, every trade field, complete daily equity and metrics against prior N320/exit20. All six shared base windows and five shared stress windows; no historical comparison for the two new transfer windows.",
        "scope": "Every recorded long/short trade: hashed traded/mark sources and recursive parent CSV lineage; continuous replay slices exactly match their declared source interval; complete minute calendars for each actual candidate warmup/window; candidate-specific UTC 30m aggregation and Wilder ATR14; prior-N high/low close breakout excluding current candle; next-open adverse fill; frozen 2/3ATR initial stop and price risk; pre-entry cash quantity including stop-fill/fee risk and exposure cap; first hard stop versus independent exit-window channel; signed carried-position funding at mark open; fees, slippage attribution, gross/net/R and final cash. Executed cost-gate entries additionally checked at their signal close.",
        "limits": [
            "This is a recorded-trade audit, not an independent account replay. Background filter, cooldown/daily-loss triggers, rejected signals and counterfactual missed entries are not reconstructed. A daily-loss exit is checked for fill and absence of an earlier mechanical exit, not its risk trigger.",
            "Canonical daily calendars and receipt/config/selection identities use shared helpers. Daily marked equity paths, non-baseline metrics, MFE/MAE and exposure metrics are not independently reconstructed; baseline fields are compared exactly with old evidence.",
            "Source/indicator helpers are shared with prior Python audits, not Rust. Both directions share one account chronology; no simultaneous long/short position is assumed.",
            "Cost scenarios are full reruns and duplicate historical coverage. Audit counts are not independent statistical sample sizes, selection evidence or proof of future profitability.",
        ],
    }
    write_once(args.output, result)
    print({"output": str(args.output), "status": "passed", "counts": dict(counts)}, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "manifest", "input", "baseline-input", "binary", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--baseline-candidate", default="m30-n320-x20")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
