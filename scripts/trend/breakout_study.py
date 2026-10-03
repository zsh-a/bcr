"""Frozen 30-minute breakout episodes, independently of account positions/risk.

This produces price-path labels, never a strategy equity curve. NumPy only
accelerates verified minute arrays; indicators follow the native recurrence.
"""
import argparse
import gzip
import json
import math
import os
from pathlib import Path
import tempfile

import numpy as np

from artifacts import audit_window, ensure_writable, load_evidence, read, sha, source_fingerprint, write_once
from download import validate_funding
from protocol import DAY, timestamp

MINUTE = 60000
DEFINITIONS = ("close-tick", "close-buffer", "two-close")
VERSION = "trend-breakout-events-1"


def validate_study(plan):
    s = plan["breakoutStudy"]
    expected = {"version": 1, "tradeMinutes": 30, "direction": "long",
                "breakoutBars": [20, 40], "definitions": list(DEFINITIONS),
                "bufferAtr": .25, "stopAtr": 2, "targetR": [1, 2],
                "horizonBars": 24, "falseBreakBars": 4, "warmupDays": 1}
    for key, value in expected.items():
        if s.get(key) != value or isinstance(s.get(key), bool):
            raise ValueError(f"unsupported frozen breakout rule: {key}")
    if s.get("bootstrap") != {"blockDays": 7, "samples": 2000, "seed": 20261003}:
        raise ValueError("unsupported frozen event bootstrap")
    if plan["costs"]["feeBps"] != 5 or plan["costs"]["slippageBps"] != 2:
        raise ValueError("event reference fills require the declared base costs")
    return s


def breaks(price, boundary, tick):
    tolerance = min(8 * np.finfo(float).eps * max(abs(price), abs(boundary), tick), tick * 1e-6)
    return price - boundary + tolerance >= tick


def reference_fill(raw, atr, tick, slippage_bps=2):
    entry = math.ceil(raw * (1 + slippage_bps / 10000) / tick - 1e-9) * tick
    stop = math.floor((entry - 2 * atr) / tick + 1e-9) * tick
    if not all(math.isfinite(x) for x in (entry, stop)) or stop <= 0 or entry <= stop:
        raise ValueError("invalid reference entry/stop")
    return entry, stop, entry - stop


def validate_minutes(values):
    if values.ndim != 2 or values.shape[1] != 7 or not len(values):
        raise ValueError("empty or malformed minute data")
    t, o, h, low, c, volume, close_time = values.T
    if (not np.isfinite(values).all() or np.any(t % MINUTE) or
            np.any(np.diff(t) != MINUTE) or np.any(close_time != t + MINUTE - 1) or
            np.any(t < 1_000_000_000_000) or np.any(t >= 100_000_000_000_000) or
            np.any(low <= 0) or np.any(o <= 0) or np.any(c <= 0) or np.any(volume < 0) or
            np.any(h < np.maximum(o, c)) or np.any(low > np.minimum(o, c))):
        raise ValueError("invalid, missing or unordered minute data")


def trading_candles(minutes, period=30):
    """Only complete UTC candles. Input partitions have already been joined."""
    validate_minutes(minutes)
    offset = (-int(minutes[0, 0]) // MINUTE) % period
    size = ((len(minutes) - offset) // period) * period
    if size <= 0:
        raise ValueError("no complete trading candles")
    bars = minutes[offset:offset + size].reshape(-1, period, 7)
    return np.column_stack((bars[:, 0, 0], bars[:, 0, 1], bars[:, :, 2].max(axis=1),
                            bars[:, :, 3].min(axis=1), bars[:, -1, 4], bars[:, :, 5].sum(axis=1)))


def wilder_atr(bars):
    atr, total, previous, result = 0.0, 0.0, None, []
    for i, bar in enumerate(bars):
        tr = bar[2] - bar[3]
        if previous is not None:
            tr = max(tr, abs(bar[2]-previous), abs(bar[3]-previous))
        previous = bar[4]
        if i < 14:
            total += tr
            atr = total / (i + 1)
        else:
            atr = (atr * 13 + tr) / 14
        result.append(atr)
    return np.asarray(result)


def prior_high(bars, lookback):
    result = np.full(len(bars), np.nan)
    if len(bars) > lookback:
        result[lookback:] = np.lib.stride_tricks.sliding_window_view(bars[:, 2], lookback)[:-1].max(axis=1)
    return result


def detect_episodes(bars, atr, upper, tick, start, end):
    """Warmup feeds indicators only; each study window starts unarmed."""
    episodes, raw = [], 0
    active = None
    available = start
    for i, bar in enumerate(bars):
        close_time = int(bar[0]) + 30 * MINUTE - 1
        if close_time < start or close_time >= end or not math.isfinite(upper[i]) or i < 13:
            continue
        qualifies = breaks(float(bar[4]), float(upper[i]), tick)
        raw += int(qualifies)
        if active is not None:
            if bar[4] <= active:
                active = None
            # Rearming can never also trigger a new episode on this candle.
            continue
        if not qualifies:
            continue
        active = float(upper[i])
        subset = close_time + 1 >= available
        if subset:
            # Same subset for all policies, reserving possible delayed confirmation.
            available = close_time + 1 + 25 * 30 * MINUTE
        episodes.append({"index": i, "baseTime": close_time, "boundary": active,
                         "baseAtr": float(atr[i]), "sharedNonoverlap": subset})
    return episodes, raw


def first_hit(minutes, stop, target, tick):
    """The known minute open precedes its unordered high/low extremes."""
    o, high, low = minutes[:, 1], minutes[:, 2], minutes[:, 3]
    def reached(price, boundary, direction):
        tolerance = np.minimum(8*np.finfo(float).eps*np.maximum(np.maximum(np.abs(price),abs(boundary)),tick),tick*1e-6)
        return direction*(price-boundary)+tolerance >= 0
    open_stop, open_target = reached(o,stop,-1), reached(o,target,1)
    range_stop, range_target = reached(low,stop,-1), reached(high,target,1)
    hit = open_stop | open_target | range_stop | range_target
    locations = np.flatnonzero(hit)
    if not len(locations):
        return {"status": "horizon-censored", "time": None}
    i = int(locations[0])
    if open_stop[i]:
        status, phase = "stop", "open"
    elif open_target[i]:
        status, phase = "target", "open"
    elif range_stop[i] and range_target[i]:
        status, phase = "ambiguous", "range"
    else:
        status, phase = ("stop" if range_stop[i] else "target"), "range"
    return {"status": status, "time": int(minutes[i, 0]), "phase": phase}


def label_event(signal_index, boundary, bars, atr, minutes, tick, end):
    signal_time = int(bars[signal_index, 0]) + 30 * MINUTE - 1
    entry_time = signal_time + 1
    horizon_end = entry_time + 24 * 30 * MINUTE
    record = {"signalTime": signal_time, "atr": float(atr[signal_index]),
              "entryTime": entry_time, "horizonEnd": horizon_end, "tailExcluded": horizon_end > end}
    if record["tailExcluded"]:
        return record
    begin = (entry_time - int(minutes[0, 0])) // MINUTE
    future = minutes[begin:begin + 720]
    if len(future) != 720 or future[0, 0] != entry_time or future[-1, 0] != horizon_end - MINUTE:
        raise ValueError("complete forward event window is missing minute data")
    entry, stop, risk = reference_fill(float(future[0, 1]), float(atr[signal_index]), tick)
    closes = bars[signal_index + 1:signal_index + 5, 4]
    if len(closes) != 4:
        raise ValueError("complete event lacks four subsequent closes")
    record.update({"entryPrice": entry, "initialStop": stop, "priceR": risk,
                   "falseBreak": bool(np.any(closes <= boundary)),
                   "mfeR": max(0.0, float(future[:, 2].max())-entry)/risk,
                   "maeR": max(0.0, entry-float(future[:, 3].min()))/risk,
                   "targets": {str(r): first_hit(future, stop, entry + r * risk, tick) for r in (1, 2)}})
    return record


def study_symbol(symbol, window, bars, atr, minutes, tick, lookbacks=(20, 40)):
    start, end = timestamp(window["start"]), timestamp(window["end"])
    records, raw = [], {}
    for n in lookbacks:
        upper = prior_high(bars, n)
        episodes, raw[n] = detect_episodes(bars, atr, upper, tick, start, end)
        for episode in episodes:
            i, boundary = episode["index"], episode["boundary"]
            episode_id = f"{symbol}:{window['id']}:{n}:{episode['baseTime']}"
            policies = {}
            for definition in DEFINITIONS:
                signal = i
                rejection = None
                if definition == "close-buffer":
                    threshold = max(tick, .25 * float(atr[i]))
                    tolerance = min(8*np.finfo(float).eps*max(abs(float(bars[i, 4])), abs(boundary), tick), tick*1e-6)
                    if bars[i, 4] - boundary + tolerance < threshold:
                        rejection = "buffer-not-met"
                elif definition == "two-close":
                    signal = i + 1
                    if signal >= len(bars) or bars[signal, 0] + 30 * MINUTE > end:
                        rejection = "confirmation-tail"
                    elif not breaks(float(bars[signal, 4]), boundary, tick):
                        rejection = "second-close-not-met"
                policies[definition] = {"accepted": rejection is None, "rejection": rejection}
                if rejection is None:
                    policies[definition].update(label_event(signal, boundary, bars, atr, minutes, tick, end))
            records.append({"baseEpisodeId": episode_id, "symbol": symbol, "window": window["id"],
                            "lookback": n, **{k:v for k,v in episode.items() if k != "index"}, "policies": policies})
    return records, raw


def bootstrap_weights(days, bootstrap):
    """Resample calendar blocks jointly across coins and definitions."""
    rng = np.random.default_rng(bootstrap["seed"])
    weights = np.zeros((bootstrap["samples"], days), dtype=np.int16)
    block = bootstrap["blockDays"]
    for row in weights:
        starts = rng.integers(0, days, size=math.ceil(days/block))
        indices = ((starts[:, None] + np.arange(block)) % days).ravel()[:days]
        row[:] = np.bincount(indices, minlength=days)
    return weights


def summarize(records, definition, start, end, weights=None):
    accepted = [r for r in records if r["policies"][definition]["accepted"]]
    complete = [r for r in accepted if not r["policies"][definition]["tailExcluded"]]
    observations = [r["policies"][definition] for r in complete]
    result = {"baseEpisodes": len(records), "accepted": len(accepted), "completeHorizon": len(complete),
              "tailExcluded": len(accepted)-len(complete),
              "confirmationTail": sum(r["policies"][definition]["rejection"] == "confirmation-tail" for r in records),
              "coverage": len(accepted)/len(records) if records else None,
              "falseBreakCount": sum(o["falseBreak"] for o in observations),
              "falseBreakRate": sum(o["falseBreak"] for o in observations)/len(complete) if complete else None,
              "mfeR": {"mean": float(np.mean([o["mfeR"] for o in observations])) if complete else None,
                       "median": float(np.median([o["mfeR"] for o in observations])) if complete else None},
              "maeR": {"mean": float(np.mean([o["maeR"] for o in observations])) if complete else None,
                       "median": float(np.median([o["maeR"] for o in observations])) if complete else None},
              "targets": {}}
    for target in ("1", "2"):
        counts = {name: sum(o["targets"][target]["status"] == name for o in observations)
                  for name in ("target", "stop", "ambiguous", "horizon-censored")}
        result["targets"][target] = {**counts,
            "withinHorizonLower": counts["target"]/len(complete) if complete else None,
            "withinHorizonUpper": (counts["target"]+counts["ambiguous"])/len(complete) if complete else None}
    skipped = [r for r in records if not r["policies"][definition]["accepted"] and
               r["policies"][definition]["rejection"] != "confirmation-tail"]
    skipped_complete = [r["policies"]["close-tick"] for r in skipped if not r["policies"]["close-tick"]["tailExcluded"]]
    result["skippedBase2R"] = {"episodes": len(skipped), "completeBaseHorizon": len(skipped_complete),
        **{name: sum(o["targets"]["2"]["status"] == name for o in skipped_complete)
           for name in ("target", "stop", "ambiguous", "horizon-censored")}}
    if weights is not None:
        days = (end-start)//DAY
        daily = np.zeros((8, days))
        for r in records:
            day = (r["baseTime"]-start)//DAY
            o = r["policies"][definition]
            daily[0, day] += 1
            if not o["accepted"]:
                continue
            daily[1, day] += 1
            if o["tailExcluded"]:
                continue
            daily[2, day] += 1
            daily[3, day] += int(o["falseBreak"])
            for target, index in [("1", 4), ("2", 6)]:
                status = o["targets"][target]["status"]
                daily[index, day] += int(status == "target")
                daily[index+1, day] += int(status in ("target", "ambiguous"))
        draws = weights @ daily.T
        result["calendarBlockIntervals95"] = {}
        for name, numerator, denominator in [("coverage",1,0),("falseBreakRate",3,2),
                ("target1Lower",4,2),("target1Upper",5,2),("target2Lower",6,2),("target2Upper",7,2)]:
            selected = draws[:, denominator] > 0
            values = draws[selected, numerator]/draws[selected, denominator]
            result["calendarBlockIntervals95"][name] = {
                "interval": np.quantile(values, [.025,.975]).tolist() if len(values) else None,
                "definedReplicates": int(selected.sum()), "undefinedReplicates": int((~selected).sum())}
    return result


class MinuteSources:
    def __init__(self, manifest):
        self.manifest = manifest
        self.verified = {}

    def verify(self, path, expected):
        if path not in self.verified:
            actual = sha(path)
            if actual != expected:
                raise ValueError(f"source checksum mismatch: {path}")
            self.verified[path] = actual
        elif self.verified[path] != expected:
            raise ValueError("manifest assigns conflicting hashes to one source")

    def window(self, symbol, start, end):
        source = self.manifest["symbols"][symbol]
        checksums = {r["path"]:r["csvSha256"] for r in source["archives"]}
        self.verify(source["funding"],source["fundingSha256"])
        validate_funding(read(source["funding"]), start+DAY, end)
        rows = []
        for part in source["partitions"]:
            month_start = timestamp(part["month"]+"-01")
            year, month = map(int,part["month"].split("-"))
            month_end = timestamp(f"{year + (month == 12):04d}-{1 if month == 12 else month+1:02d}-01")
            if month_end <= start or month_start >= end:
                continue
            pair=[]
            for key in ("candles","marks"):
                path=part[key]
                self.verify(path,checksums[path])
                with open(path) as stream:
                    skip = int(stream.readline().startswith("open_time"))
                values=np.loadtxt(path,delimiter=",",usecols=range(7),skiprows=skip,ndmin=2)
                validate_minutes(values)
                values=values[(values[:,0]>=start)&(values[:,0]<end)]
                pair.append(values)
            if not np.array_equal(pair[0][:,0],pair[1][:,0]):
                raise ValueError("mark and traded-minute timestamps differ")
            rows.append(pair[0])
        values=np.concatenate(rows) if rows else np.empty((0,7))
        validate_minutes(values)
        if len(values)!=(end-start)//MINUTE or values[0,0]!=start or values[-1,0]!=end-MINUTE:
            raise ValueError("minute sources do not cover the requested warmup/window")
        return values


def match_native(batches, bars_by_symbol, atr_by_symbol, start, end):
    count=0
    for batch in batches:
        symbol=batch["symbol"]
        bars,atr=bars_by_symbol[symbol],atr_by_symbol[symbol]
        bounds={n:prior_high(bars,n) for n in (20,40)}
        for row in batch["results"]:
            strategy=row["config"]["strategy"]
            if (row["warmupStart"] != start-DAY or strategy["tradeMinutes"] != 30 or
                    strategy["entry"] != "breakout" or strategy["direction"] != "long" or strategy["stopAtr"] != 2):
                raise ValueError("native warmup/timeframe differs from event indicators")
            n=row["config"]["strategy"]["breakoutBars"]
            if n not in bounds:
                raise ValueError("unexpected native breakout window")
            for trade in row["trades"]:
                snap=trade["entrySignal"]
                delta=snap["time"]+1-int(bars[0,0])
                if delta%(30*MINUTE):
                    raise ValueError("native signal is not a completed 30-minute candle")
                i=delta//(30*MINUTE)-1
                if not 0<=i<len(bars) or not start<=snap["time"]<end:
                    raise ValueError("native signal outside event calendar")
                for expected,actual in [(bounds[n][i],snap["boundary"]),(atr[i],snap["atr"]),(bars[i,4],snap["price"])]:
                    if not math.isfinite(expected) or not math.isclose(expected,actual,rel_tol=1e-11,abs_tol=1e-9):
                        raise ValueError(f"native snapshot mismatch: {symbol}/{row['id']}/{trade['id']}")
                if snap["lookbackBars"]!=n or trade["entryTime"]!=snap["time"]+1:
                    raise ValueError("native lookback/next-open snapshot mismatch")
                if i+1>=len(bars):
                    raise ValueError("native entry has no complete next trading candle for raw-open audit")
                execution=row["config"]["execution"]
                entry,stop,_=reference_fill(float(bars[i+1,1]),float(atr[i]),execution["tickSize"],execution["slippageBps"])
                if trade["side"]!="long" or any(not math.isclose(a,b,rel_tol=1e-11,abs_tol=1e-9)
                                               for a,b in [(entry,trade["entryPrice"]),(stop,trade["initialStop"])]):
                    raise ValueError("native adverse entry/initial-stop rounding differs from reference")
                count+=1
    return count


def run(plan_path,manifest_path,native_path,output):
    plan=read(plan_path)
    study=validate_study(plan)
    evidence=load_evidence(plan_path,manifest_path,native_path)
    sources=MinuteSources(evidence["manifest"])
    ensure_writable(output,directory=True)
    output.mkdir(parents=True,exist_ok=True)
    result_path,event_path=output/"results.json",output/"events.jsonl.gz"
    if result_path.exists() or event_path.exists():
        raise ValueError("event output already exists; preserve it and use a new directory")
    generator=source_fingerprint("breakout_study.py","artifacts.py","daily.py","download.py","protocol.py","warmup.py")
    results={"version":VERSION,"planSha256":sha(plan_path),"manifestSha256":sha(manifest_path),
             "generatorSha256":generator,"numpyVersion":np.__version__,"rules":study,
             "limitations":["All windows were previously observed; no untouched out-of-sample claim.",
                "Price-path event labels ignore account positions, risk gates, capital, fees and funding; they are not strategy returns.",
                "Within-horizon success bounds count ambiguity separately; horizon-censored outcomes remain in the complete-horizon denominator and are not called losses.",
                "Calendar block intervals are descriptive, preserve same-day cross-coin grouping, and do not correct multiple testing.",
                "No Wilson/binomial independence inference. Shared nonoverlap subset is selected only from episode times, not future outcomes.",
                "Only close-tick shares native trigger semantics; buffer/two-close are event-study hypotheses, not native execution rules."],
             "nativeSnapshotsChecked":0,"nativeInputs":[],"windows":{}}
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(dir=output,prefix=".events-",delete=False) as stream:
            temporary=Path(stream.name)
            with gzip.GzipFile(filename="",fileobj=stream,mode="wb",mtime=0) as compressed:
                for window in plan["windows"]:
                    start,end=timestamp(window["start"]),timestamp(window["end"])
                    batches,provenance=audit_window(evidence,window)
                    results["nativeInputs"].extend(provenance)
                    all_records=[]
                    raw_counts={n:{} for n in study["breakoutBars"]}
                    bars_by_symbol,atr_by_symbol={},{}
                    for symbol,precision in plan["symbols"].items():
                        print(f"events {window['id']}/{symbol}: verify sources and classify",flush=True)
                        minutes=sources.window(symbol,start-DAY,end)
                        bars=trading_candles(minutes)
                        atr=wilder_atr(bars)
                        records,raw=study_symbol(symbol,window,bars,atr,minutes,precision["tickSize"],study["breakoutBars"])
                        for record in records:
                            compressed.write((json.dumps(record,separators=(",",":"),allow_nan=False)+"\n").encode())
                        all_records.extend(records)
                        for n,count in raw.items():raw_counts[n][symbol]=count
                        bars_by_symbol[symbol],atr_by_symbol[symbol]=bars,atr
                    results["nativeSnapshotsChecked"]+=match_native(batches,bars_by_symbol,atr_by_symbol,start,end)
                    weights=bootstrap_weights((end-start)//DAY,study["bootstrap"])
                    grouped={}
                    for n in study["breakoutBars"]:
                        selected=[r for r in all_records if r["lookback"]==n]
                        grouped[str(n)]={"rawQualifyingCloses":sum(raw_counts[n].values()),"rawBySymbol":raw_counts[n],"samples":{}}
                        for subset in ("all-episodes","shared-nonoverlap"):
                            sample=selected if subset=="all-episodes" else [r for r in selected if r["sharedNonoverlap"]]
                            grouped[str(n)]["samples"][subset]={d:{
                                "pooled":summarize(sample,d,start,end,weights),
                                "symbols":{s:summarize([r for r in sample if r["symbol"]==s],d,start,end) for s in plan["symbols"]}}
                                for d in DEFINITIONS}
                    results["windows"][window["id"]]={"startTime":start,"endTime":end,"lookbacks":grouped}
            stream.flush()
            os.fsync(stream.fileno())
        if sha(plan_path)!=results["planSha256"] or sha(manifest_path)!=results["manifestSha256"]:
            raise ValueError("plan or manifest changed during event study")
        if source_fingerprint("breakout_study.py","artifacts.py","daily.py","download.py","protocol.py","warmup.py")!=generator:
            raise ValueError("event generator changed during analysis")
        results["verifiedSources"]=[{"path":path,"sha256":digest} for path,digest in sorted(sources.verified.items())]
        results["events"]={"path":event_path.name,"sha256":sha(temporary)}
        os.link(temporary,event_path)
        write_once(result_path,results)
        print(json.dumps({"results":str(result_path),"sha256":sha(result_path),"nativeSnapshotsChecked":results["nativeSnapshotsChecked"]}),flush=True)
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("plan","manifest","input","output"):
        parser.add_argument("--"+name,type=Path,required=True)
    args=parser.parse_args()
    run(args.plan,args.manifest,args.input,args.output)


if __name__=="__main__":
    main()
