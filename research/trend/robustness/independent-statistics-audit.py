"""Independent raw-equity audit; this attachment is not the research evaluator.

Run from the repository root with Python and NumPy:
  python research/trend/robustness/independent-statistics-audit.py --self-test
  python research/trend/robustness/independent-statistics-audit.py --output /tmp/statistics-audit.json
Defaults read the frozen robustness plan, raw batches and mechanism evaluation.
No production statistics module is imported; existing outputs are never replaced.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import random

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
DAY = 86_400_000
PLAN_SHA = "fddd5800b6d38e9f5a6ba09441be3b245a4ff82a3fde56944b0969e21459d78d"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def timestamp(date):
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def daily_curve(row, start, end):
    canonical = row["metrics"]["evaluation"]
    require(canonical["version"] == 2, "canonical evaluation v2 required")
    days = canonical["daily"]
    expected = list(range(start, end, DAY))
    require(len(days) == len(expected) and len(row["daily"]) == len(expected), "missing calendar day")
    values = []
    for point, old, begin in zip(days, row["daily"], expected):
        require(point["from"] == begin and point["to"] == begin + DAY
                and point["complete"] is True and old["time"] == begin + DAY - 1,
                "incomplete, duplicated or displaced UTC day")
        require(finite(point["equity"]) and point["equity"] > 0
                and old["equity"] == point["equity"], "invalid or inconsistent daily equity")
        values.append(point["equity"])
    return np.asarray(values, dtype=np.float64)


def portfolio_returns(curves, initial):
    require(curves and all(len(c) == len(curves[0]) for c in curves), "sleeve calendar mismatch")
    # Fixed sleeve capital: aggregate dollars before calculating returns.
    equity = np.stack(curves).sum(axis=0)
    previous = np.concatenate(([initial], equity[:-1]))
    require(np.all(previous > 0) and np.all(np.isfinite(equity)), "undefined daily return")
    return equity, equity / previous - 1


def circular_draws(lengths, samples, block, seed):
    """Generate index matrices independently, with the declared RNG call order."""
    require(samples > 0 and block > 0 and all(n > 0 for n in lengths), "invalid block request")
    rng = random.Random(seed)
    indices = [np.empty((samples, n), dtype=np.int64) for n in lengths]
    for sample in range(samples):
        for n, matrix in zip(lengths, indices):
            for offset in range(0, n, block):
                start = rng.randrange(n)
                count = min(block, n - offset)
                matrix[sample, offset:offset + count] = (start + np.arange(count)) % n
    return indices


def sampled_means(windows, indices):
    # Vectorize all eight candidate/cost series using the same draw matrices.
    days = sum(len(window) for window in windows)
    return sum(window[index].sum(axis=1) for window, index in zip(windows, indices)) / days


def interval(values):
    ordered = np.sort(values)
    return [float(ordered[int(len(ordered) * .025)]),
            float(ordered[min(len(ordered) - 1, int(len(ordered) * .975))])]


class Comparison:
    def __init__(self):
        self.checked = 0
        self.numeric = 0
        self.max_error = 0.0
        self.differences = []

    def check(self, actual, expected, path):
        self.checked += 1
        if isinstance(expected, dict):
            require(isinstance(actual, dict) and set(actual) == set(expected), f"field mismatch: {path}")
            for key in expected:
                self.check(actual[key], expected[key], f"{path}.{key}")
        elif isinstance(expected, list):
            require(isinstance(actual, list) and len(actual) == len(expected), f"length mismatch: {path}")
            for index, (a, e) in enumerate(zip(actual, expected)):
                self.check(a, e, f"{path}[{index}]")
        elif finite(actual) and finite(expected):
            self.numeric += 1
            error = abs(actual - expected)
            self.max_error = max(self.max_error, error)
            # Currency reconciliation may accumulate machine rounding; all
            # dimensionless return/CI comparisons use a strict 1e-12 floor.
            tolerance = 1e-7 if path.endswith(("netPnl", "netExpectancy", "initialCapital")) else 1e-12
            equal = error <= tolerance + 1e-11 * abs(expected)
            if not equal:
                self.differences.append({"field": path, "recomputed": actual, "recorded": expected})
        elif actual != expected:
            self.differences.append({"field": path, "recomputed": actual, "recorded": expected})


def reconstruct(plan, batches, row_id, window):
    initial = plan["initialCapital"]
    allocation = initial / len(plan["symbols"])
    curves, trades, counts = [], [], {}
    start, end = timestamp(window["start"]), timestamp(window["end"])
    for symbol in plan["symbols"]:
        rows = [row for row in batches[symbol]["results"] if row["id"] == row_id]
        require(len(rows) == 1, f"candidate/cost row not unique: {symbol}/{row_id}")
        row = rows[0]
        require(row["config"]["execution"]["initialCapital"] == allocation, "capital allocation changed")
        curve = daily_curve(row, start, end)
        require(math.isclose(curve[-1], row["metrics"]["finalEquity"], abs_tol=1e-7), "final NAV differs")
        require(all(finite(t["netPnl"]) and finite(t["rMultiple"]) for t in row["trades"]), "invalid trade")
        sleeve_net = math.fsum(t["netPnl"] for t in row["trades"])
        require(math.isclose(curve[-1] - allocation, sleeve_net, rel_tol=1e-10, abs_tol=1e-7),
                "sleeve cash ledger does not reconcile")
        curves.append(curve)
        trades.extend(row["trades"])
        counts[symbol] = len(row["trades"])
    equity, daily = portfolio_returns(curves, initial)
    require(len(equity) == (end - start) // DAY, "portfolio calendar incomplete")
    peak = np.maximum.accumulate(np.concatenate(([initial], equity)))[1:]
    profit = math.fsum(t["netPnl"] for t in trades if t["netPnl"] > 0)
    loss = -math.fsum(t["netPnl"] for t in trades if t["netPnl"] < 0)
    ledger_net = math.fsum(t["netPnl"] for t in trades)
    compact = {"candidate": row_id, "days": len(daily), "initialCapital": initial,
               "return": float(equity[-1] / initial - 1),
               "dailyMaxDrawdown": float(np.min(equity / peak - 1)),
               "trades": len(trades), "tradesBySymbol": counts,
               "netPnl": float(equity[-1] - initial),
               "netExpectancy": ledger_net / len(trades) if trades else None,
               "meanNetR": math.fsum(t["rMultiple"] for t in trades) / len(trades) if trades else None,
               "profitFactor": profit / loss if loss else None,
               "meanDailyReturn": float(daily.mean())}
    proof = {"days": len(daily), "start": window["start"], "endExclusive": window["end"],
             "firstPreviousEquity": initial, "firstDailyEquity": float(equity[0]),
             "firstDailyReturn": float(daily[0]), "lastDailyEquity": float(equity[-1]),
             "calendarSha256": hashlib.sha256(np.arange(start, end, DAY, dtype="<i8").tobytes()).hexdigest(),
             "dailyReturnsFloat64LEsha256": hashlib.sha256(daily.astype("<f8").tobytes()).hexdigest()}
    return compact, daily, proof


def run(args):
    require(not args.output.exists(), "output already exists; choose a new path")
    plan = json.loads(args.plan.read_text())
    report = json.loads(args.evaluation.read_text())
    require(sha(args.plan) == PLAN_SHA, "expected frozen robustness plan")
    settings = plan["mechanismEvaluation"]
    require(settings == report["protocol"] and settings["samples"] == 2000
            and settings["seed"] == 20261003 and settings["blockDays"] == [7, 28], "protocol changed")
    require(plan["capitalMode"] == "total-account-equal-sleeves" and plan["initialCapital"] == 60000,
            "unexpected capital contract")
    require(report["conventions"]["pairedDifference"] == "comparator-minus-primary", "wrong contrast sign")
    identity = report["evaluationIdentity"]
    require(identity["planSha256"] == sha(args.plan)
            and identity["manifestSha256"] == sha(args.input / "manifest.json")
            and identity["selectionSha256"] == sha(args.input / "selection.json"), "evidence identity mismatch")
    candidates = [candidate["id"] for candidate in plan["candidates"]]
    costs = ["base", "stress"]
    keys = [(candidate, cost) for candidate in candidates for cost in costs]
    primary = settings["primary"]
    windows = {window["id"]: window for window in plan["windows"]}
    required = list(dict.fromkeys(name for group in settings["groups"] for name in group["windows"]))
    provenance = {(p["window"], p["symbol"]): p["receipt"] for p in report["provenance"]}
    check = Comparison()
    series, accounts, calendars, source_files = {}, {}, {}, []
    for name in required:
        window = windows[name]
        batches = {}
        for symbol in plan["symbols"]:
            path = args.input / name / f"{symbol}.json"
            digest = sha(path)
            require(digest == provenance[name, symbol]["resultSha256"], "raw batch hash differs from report")
            batch = json.loads(path.read_text())
            require(batch["window"] == name and batch["symbol"] == symbol
                    and batch["startTime"] == timestamp(window["start"])
                    and batch["endTime"] == timestamp(window["end"])
                    and batch["planSha256"] == PLAN_SHA and batch["engine"] == report["engine"],
                    "raw batch identity differs")
            batches[symbol] = batch
            source_files.append({"path": str(path.relative_to(ROOT)), "sha256": digest})
        accounts[name], calendars[name], daily_columns = {}, {}, []
        for candidate, cost in keys:
            row_id = candidate + ("-stress" if cost == "stress" else "")
            compact, daily, proof = reconstruct(plan, batches, row_id, window)
            accounts[name].setdefault(candidate, {})[cost] = compact
            calendars[name].setdefault(candidate, {})[cost] = proof
            daily_columns.append(daily)
        series[name] = np.stack(daily_columns, axis=1)
    require(len(report["groups"]) == len(settings["groups"]), "group count changed")
    groups = []
    for declared, recorded in zip(settings["groups"], report["groups"]):
        check.check(recorded["id"], declared["id"], "group.id")
        names = declared["windows"]
        values = [series[name] for name in names]
        lengths = [len(value) for value in values]
        total_days = sum(lengths)
        require(total_days == {"historical-gap-completion": 92, "recent-known": 638}[declared["id"]],
                "predeclared group length differs")
        check.check(total_days, recorded["days"], f"{declared['id']}.days")
        require(len(recorded["windows"]) == len(names), "window count changed")
        for name, actual in zip(names, recorded["windows"]):
            check.check(name, actual["id"], f"{declared['id']}.window.id")
            check.check(accounts[name], actual["accounts"], f"{declared['id']}.{name}.accounts")
        means = np.concatenate(values).mean(axis=0)
        sampled = {block: sampled_means(values, circular_draws(lengths, settings["samples"], block, settings["seed"]))
                   for block in settings["blockDays"]}
        contrasts = []
        require(len(recorded["comparisons"]) == len(plan["comparisons"]), "contrast count changed")
        for comparison, actual in zip(plan["comparisons"], recorded["comparisons"]):
            require(all(comparison[key] == actual[key] for key in ("id", "candidate", "reference")),
                    "contrast identity differs")
            blocks = []
            for block in settings["blockDays"]:
                result = {"blockDays": block, "samples": settings["samples"], "seed": settings["seed"],
                          "days": total_days, "absolute": {}, "paired": {}}
                for label, candidate in (("primary", primary), ("comparator", comparison["candidate"])):
                    result["absolute"][label] = {}
                    for cost in costs:
                        index = keys.index((candidate, cost))
                        result["absolute"][label][cost] = {"meanDailyReturn": float(means[index]),
                            "meanDailyReturn95CI": interval(sampled[block][:, index])}
                for cost in costs:
                    left, right = keys.index((comparison["candidate"], cost)), keys.index((primary, cost))
                    result["paired"][cost] = {"meanDailyReturn": float(means[left] - means[right]),
                        "meanDailyReturn95CI": interval(sampled[block][:, left] - sampled[block][:, right])}
                blocks.append(result)
            check.check(blocks, actual["bootstrap"], f"{declared['id']}.{comparison['id']}.bootstrap")
            contrasts.append({**comparison, "bootstrap": blocks})
        groups.append({"id": declared["id"], "days": total_days, "windowDays": dict(zip(names, lengths)),
                       "pointMeans": {candidate: {cost: float(means[keys.index((candidate, cost))]) for cost in costs}
                                      for candidate in candidates}, "comparisons": contrasts})
    result = {"version": "independent-statistics-audit-1", "status": "passed" if not check.differences else "failed",
              "scope": "Six declared mechanism windows; raw canonical daily equity and trade-ledger reconciliation. No new replay, price reads, selection, or production statistics imports.",
              "method": "NumPy portfolio-dollar aggregation and return reconstruction; independent random.Random circular index matrices, sample/window/block order; same draws for all eight series; window lengths preserved; percentile ranks 50/1950; comparator minus primary.",
              "limitations": "Checks numerical reproduction, not independence, multiplicity correction, market validity, execution correctness or future profitability. All negative observations are retained.",
              "identity": {"planSha256": sha(args.plan), "manifestSha256": identity["manifestSha256"],
                           "selectionSha256": identity["selectionSha256"], "evaluationSha256": sha(args.evaluation),
                           "scriptSha256": sha(__file__), "numpyVersion": np.__version__},
              "checks": {"rawBatches": len(source_files), "candidateCostWindowAccounts": len(required) * len(keys),
                         "canonicalSleeveCalendars": len(required) * len(keys) * len(plan["symbols"]),
                         "portfolioDailyObservations": sum(len(series[name]) for name in required) * len(keys),
                         "absoluteIntervalComparisons": len(groups) * len(plan["comparisons"]) * 2 * 4,
                         "pairedIntervalComparisons": len(groups) * len(plan["comparisons"]) * 2 * 2,
                         "fieldsCompared": check.checked, "numericFieldsCompared": check.numeric,
                         "maxAbsoluteNumericDifference": check.max_error},
              "differences": check.differences, "groups": groups, "windowAccounts": accounts,
              "calendarAndFirstDayEvidence": calendars, "rawInputs": source_files}
    require(sha(args.plan) == PLAN_SHA and sha(args.evaluation) == result["identity"]["evaluationSha256"],
            "input changed during audit")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"status": result["status"], "checks": result["checks"], "differences": check.differences}))
    require(result["status"] == "passed", "statistics mismatch; inspect audit output")


def self_test():
    # A capital-weighted account differs from the average sleeve return on day 2.
    equity, rates = portfolio_returns([np.array([120., 120.]), np.array([100., 90.])], 200.)
    np.testing.assert_allclose(rates, [.1, -10 / 220], rtol=0, atol=1e-15)
    # Every independent window starts from its original capital, not prior NAV.
    _, reset = portfolio_returns([np.array([110.])], 100.)
    np.testing.assert_allclose(reset, [.1], rtol=0, atol=1e-15)
    # Oversized circular blocks still take exactly each window's original length.
    windows = [np.array([[1., 3.], [5., 7.]]), np.array([[10., 12.], [20., 22.], [30., 32.]])]
    draws = circular_draws([2, 3], 20, 28, 20261003)
    actual = sampled_means(windows, draws)
    np.testing.assert_allclose(actual, np.tile([13.2, 15.2], (20, 1)), rtol=0, atol=1e-14)
    np.testing.assert_allclose(actual[:, 1] - actual[:, 0], np.full(20, 2.), rtol=0, atol=1e-14)
    require(interval(np.arange(2000)) == [50., 1950.], "percentile ranks changed")
    row = {"metrics": {"evaluation": {"version": 2, "daily": [
        {"from": 0, "to": DAY, "complete": True, "equity": 101.}]}},
        "daily": [{"time": DAY - 1, "equity": 101.}]}
    np.testing.assert_equal(daily_curve(row, 0, DAY), [101.])
    for start, end in ((0, 2 * DAY), (DAY, 2 * DAY)):
        try:
            daily_curve(row, start, end)
        except ValueError:
            pass
        else:
            raise AssertionError("missing/displaced day was accepted")
    print("self-test passed: first day, aggregate equity, window resets, circular budgets, paired sign, percentile ranks, missing/displaced calendar")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=ROOT / "research/trend/robustness-plan.json")
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/trend-robustness-v8")
    parser.add_argument("--evaluation", type=Path, default=ROOT / "research/trend/robustness/mechanism-evaluation.json")
    parser.add_argument("--output", type=Path, default=ROOT / "research/trend/robustness/independent-statistics-audit.json")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    self_test() if arguments.self_test else run(arguments)
