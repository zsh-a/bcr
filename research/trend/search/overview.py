"""Render all declared candidates and attribute the continuous account without resets."""
import argparse
import datetime as dt
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/trend"))
from artifacts import ensure_writable, read, sha, write_once
from evaluation import account_series
from protocol import DAY, sleeve_capital, timestamp


def calendar_parts(points, initial, fmt):
    """Boundary equity is the preceding close, including carried unrealized PnL."""
    result, previous = [], initial
    for point in points:
        date = dt.datetime.fromtimestamp(point["time"] / 1000, dt.timezone.utc)
        key = date.strftime(fmt)
        if not result or result[-1]["period"] != key:
            result.append({"period": key, "days": 0, "fromEquity": previous,
                           "startDate": date.strftime("%Y-%m-%d"), "peak": previous,
                           "dailyMaxDrawdownWithinPeriod": 0.0})
        row = result[-1]
        row["days"] += 1
        row["endDateInclusive"] = date.strftime("%Y-%m-%d")
        row["toEquity"] = point["equity"]
        row["peak"] = max(row["peak"], point["equity"])
        row["dailyMaxDrawdownWithinPeriod"] = min(
            row["dailyMaxDrawdownWithinPeriod"], point["equity"] / row["peak"] - 1)
        previous = point["equity"]
    for row in result:
        row.pop("peak")
        row["markedPnl"] = row["toEquity"] - row["fromEquity"]
        row["return"] = row["toEquity"] / row["fromEquity"] - 1
    assert math.isclose(sum(row["markedPnl"] for row in result), previous - initial, abs_tol=1e-6)
    assert math.isclose(math.prod(1 + row["return"] for row in result), previous / initial, abs_tol=1e-10)
    return result


def portfolio(summary, plan):
    batches = []
    for sleeve in summary["symbols"]:
        metrics = sleeve["metrics"]
        assert metrics["evaluation"]["version"] == 2
        daily = [{"time": point["to"] - 1, "equity": point["equity"]}
                 for point in metrics["evaluation"]["daily"]]
        batches.append({"symbol": sleeve["symbol"], "results": [
            {"id": summary["id"], "metrics": metrics, "daily": daily}]})
    _, points, initial, _ = account_series(plan, batches, summary["id"])
    assert math.isclose(points[-1]["equity"], summary["accountFinalEquity"], abs_tol=1e-6)
    return points, initial


def draw(bundle, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.colors import TwoSlopeNorm

    plan = bundle["plan"]
    ids = [row["id"] for row in plan["candidates"]]
    windows = plan["windows"]
    values = {name: {row["id"]: row for row in rows} for name, rows in bundle["summaries"].items()}
    labels = ["Dev 487d", "2024 Jan-Jul", "Continuous 760d", "2021", "2022 H1", "2022 Aug"]
    costs = [("Base: 5 bps fee + 2 bps slip per side", ""), ("Stress: 10 + 4 bps per side", "-stress")]
    fig, axes = plt.subplots(1, 2, figsize=(17, 14), sharey=True)
    norm = TwoSlopeNorm(vmin=-65, vcenter=0, vmax=65)
    for axis, (title, suffix) in zip(axes, costs):
        matrix = [[values[window["id"]].get(candidate + suffix, {}).get("equalSleeveReturn", float("nan")) * 100
                   for window in windows] for candidate in ids]
        im = axis.imshow(np.array(matrix), cmap="RdYlGn", norm=norm, aspect="auto")
        axis.set_xticks(range(len(labels)), labels, rotation=30, ha="right")
        axis.set_yticks(range(len(ids)), [name + (" *" if name == bundle["selection"]["id"] else "") for name in ids])
        axis.set_title(title, loc="left", pad=14, fontsize=12)
        for y, row in enumerate(matrix):
            for x, value in enumerate(row):
                label = "n/a" if math.isnan(value) else f"{value:+.1f}"
                axis.text(x, y, label, ha="center", va="center", fontsize=8,
                          color="white" if not math.isnan(value) and abs(value) > 42 else "#17212b")
        for boundary in (19.5, 23.5, 27.5):
            axis.axhline(boundary, color="white", linewidth=3)
        axis.tick_params(axis="both", length=0, labelsize=9)
        for spine in axis.spines.values():
            spine.set_visible(False)
    fig.suptitle("All 32 declared strategies | net account returns (%)", x=.22, y=.975, ha="left", fontsize=17)
    fig.text(.22, .948, "Declaration order; * = frozen development selection. Known history; each window has its own account.", fontsize=10)
    fig.text(.22, .925, "Families: channel breakout (20), impulse-pullback (4), KDJ reversal (4), price action (4).", fontsize=10)
    fig.subplots_adjust(left=.22, right=.98, top=.90, bottom=.11, wspace=.12)
    colorbar = fig.colorbar(im, ax=axes, orientation="horizontal", fraction=.018, pad=.07, aspect=60)
    colorbar.set_label("Net return after fees, modeled slippage and historical funding", fontsize=10)
    for suffix in ("png", "svg"):
        path = output / f"candidate-map.{suffix}"
        if path.exists():
            raise ValueError(f"refusing to replace {path}")
        fig.savefig(path, dpi=160, metadata={"Date": None} if suffix == "svg" else {})
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    ensure_writable(args.output, directory=True)
    bundle = read(args.results)
    plan = bundle["plan"]
    assert len(plan["candidates"]) == 32
    selected, baseline = bundle["selection"]["id"], bundle["baseline"]
    window = next(row for row in plan["windows"] if row["id"] == "validation-continuous")
    expected_times = list(range(timestamp(window["start"]) + DAY - 1, timestamp(window["end"]), DAY))
    summaries = {row["id"]: row for row in bundle["summaries"][window["id"]]}
    sources = {"results": {"path": str(args.results), "sha256": sha(args.results)},
               "generator": {"path": str(Path(__file__).relative_to(ROOT)), "sha256": sha(__file__)}}
    result = {"version": 1, "evaluationIdentity": bundle["evaluationIdentity"], "sources": sources,
              "window": window, "selected": selected, "baseline": baseline,
              "conventions": "Calendar attribution of the same continuous 760-day marked account. Each subperiod starts at the preceding close; no annual or monthly re-entry, liquidation, rebalance or reset. Subperiod daily drawdowns start at the boundary equity and are not the full-path drawdown. All dates UTC. Trading finalization at the overall window end is retained.",
              "accounts": {}}
    for candidate in (baseline, selected):
        for suffix in ("", "-stress"):
            identifier = candidate + suffix
            points, initial = portfolio(summaries[identifier], plan)
            assert [row["time"] for row in points] == expected_times
            months = calendar_parts(points, initial, "%Y-%m")
            for row in months:
                assert math.isclose(row["return"], summaries[identifier]["monthlyReturns"][row["period"]], abs_tol=1e-10)
            result["accounts"][identifier] = {
                "initialEquity": initial, "finalEquity": points[-1]["equity"],
                "return": points[-1]["equity"] / initial - 1,
                "dailyMaxDrawdown": summaries[identifier]["dailyPortfolioDrawdown"],
                "yearly": calendar_parts(points, initial, "%Y"), "monthly": months}
    write_once(args.output / "continuous-attribution.json", result)
    configs, records = {}, []
    for symbol in plan["symbols"]:
        path = args.input / window["id"] / f"{symbol}.json"
        row = next(row for row in read(path)["results"] if row["id"] == selected)
        configs[symbol] = row["config"]
        records.append({"path": str(path), "sha256": sha(path)})
    write_once(args.output / "selected-configs.json", {
        "version": 1, "purpose": "Exact research configuration selected on development; historical acceptance not established, not deployed.",
        "selected": selected, "selection": bundle["selection"], "evaluationIdentity": bundle["evaluationIdentity"],
        "sources": sources, "rawInputs": records, "sleeveInitialCapital": sleeve_capital(plan),
        "capitalMode": plan["capitalMode"], "configs": configs})
    draw(bundle, args.output)
    print("Continuous calendar attribution, selected configuration and all-candidate maps written.")


if __name__ == "__main__":
    main()
