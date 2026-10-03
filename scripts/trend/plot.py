"""Plot an audited study bundle using its declared windows and account metadata."""
import argparse
import datetime as dt
import math
from pathlib import Path
import tempfile
import textwrap

from artifacts import atomic_bytes, ensure_writable, read, sha
from evaluation import account_series
from protocol import DAY, is_development, sleeve_capital, timestamp, window_candidates


def load_curves(bundle, path, all_candidates=False):
    if bundle.get("version") != 2 or bundle.get("curvesSha256") != sha(path):
        raise ValueError("curves do not match the audited report bundle")
    rows = read(path)
    selected, baseline = bundle["selection"]["id"], bundle.get("baseline")
    ids = {selected} | ({baseline} if baseline is not None else set())
    expected = {(window["id"], candidate) for window in bundle["plan"]["windows"] for candidate in ids}
    indexed = {}
    for row in rows:
        key = row["window"], row["candidate"]
        if key in indexed or key not in expected:
            raise ValueError("duplicate or unexpected study curve")
        if not row["points"] or any(not math.isfinite(point["nav"]) for point in row["points"]):
            raise ValueError("curve values must be finite and nonempty")
        indexed[key] = row["points"]
    if set(indexed) != expected:
        raise ValueError("study curves are incomplete")
    for window in bundle["plan"]["windows"]:
        calendar = list(range(timestamp(window["start"]) + DAY - 1, timestamp(window["end"]), DAY))
        for candidate in ids:
            if [point["time"] for point in indexed[window["id"], candidate]] != calendar:
                raise ValueError("curve calendar differs from the declared window")
    if all_candidates:
        # Every declared variant, in declaration order. Reuse canonical sleeve
        # observations from the audited bundle; never select curves by return.
        for window in bundle["plan"]["windows"]:
            scoped = {candidate.id for candidate in window_candidates(bundle["plan"], window, bundle["selection"])}
            for candidate in bundle["plan"]["candidates"]:
                if candidate["id"] not in scoped:
                    continue
                key = window["id"], candidate["id"]
                if key in indexed:
                    continue
                summary = next(row for row in bundle["summaries"][window["id"]]
                               if row["id"] == candidate["id"])
                batches = []
                for sleeve in summary["symbols"]:
                    metrics = sleeve["metrics"]
                    if metrics.get("evaluation", {}).get("version") != 2:
                        raise ValueError("all-candidate charts require canonical Rust daily observations")
                    daily = [{"time": point["to"] - 1, "equity": point["equity"]}
                             for point in metrics["evaluation"]["daily"]]
                    batches.append({"symbol": sleeve["symbol"], "results": [
                        {"id": candidate["id"], "metrics": metrics, "daily": daily}]})
                _, portfolio, initial, _ = account_series(bundle["plan"], batches, candidate["id"])
                calendar = list(range(timestamp(window["start"]) + DAY - 1, timestamp(window["end"]), DAY))
                if ([point["time"] for point in portfolio] != calendar
                        or not math.isclose(portfolio[-1]["equity"], summary["accountFinalEquity"], abs_tol=1e-6)):
                    raise ValueError("candidate curve does not reconcile with the audited result")
                indexed[key] = [{"time": point["time"], "nav": point["equity"] / initial} for point in portfolio]
    return indexed


def draw(bundle, curves, output, all_candidates=False):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib.ticker import MaxNLocator, StrMethodFormatter

    ensure_writable(output, directory=True)
    existing = output / "results.json"
    if existing.exists():
        published = read(existing)
        if (published.get("evaluationIdentity") != bundle.get("evaluationIdentity")
                or published.get("curvesSha256") != bundle.get("curvesSha256")):
            raise ValueError("plot output belongs to another evaluation; choose a new directory")
    plan = bundle["plan"]
    windows = plan["windows"]
    chosen, baseline = bundle["selection"]["id"], bundle.get("baseline")
    primary_label = "Predeclared primary" if plan.get("selectionMode") == "fixed" else "Frozen selection"
    labels = [(chosen, primary_label, "#097e76", "-")]
    if baseline and baseline != chosen:
        labels.insert(0, (baseline, "Baseline", "#697991", "--"))
    elif baseline == chosen:
        labels[0] = (chosen, f"Baseline = {primary_label.lower()}", "#097e76", "-")
    if all_candidates:
        palette = ["#697991", "#097e76", "#b7772c", "#7353a6", "#b94f65", "#357bad", "#66902d", "#8b523d"]
        labels = [(candidate["id"], candidate["id"], palette[index % len(palette)], "-")
                  for index, candidate in enumerate(plan["candidates"])]
    columns, rows = min(2, len(windows)), math.ceil(len(windows) / 2)
    single_window = len(windows) == 1
    installed_fonts = {font.name for font in font_manager.fontManager.ttflist}
    fonts = ["DejaVu Sans"] + [name for name in ("Source Han Sans CN", "Noto Sans CJK SC")
                                if name in installed_fonts]
    with plt.rc_context({"font.family": fonts, "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.edgecolor": "#c3ccd4", "axes.labelcolor": "#445365",
                         "axes.titleweight": "bold", "grid.color": "#dce3e8",
                         "text.color": "#243246", "svg.fonttype": "none"}):
        size = (12, 7) if single_window else (14 if columns == 2 else 8, 3.4 * rows + 1.7)
        fig, axes = plt.subplots(rows, columns, figsize=size, squeeze=False)
        fig.subplots_adjust(left=.08, right=.97, top=.74 if single_window else .82,
                            bottom=.14, hspace=.48, wspace=.24)
        title = "all predeclared candidates" if all_candidates else f"{primary_label.lower()} and declared baseline"
        fig.suptitle(f"Trend research | {title}", x=.08, y=.975, ha="left", fontsize=16, fontweight="bold")
        fig.text(.08, .915 if single_window else .935,
                 f"{bundle['engine']}  /  " + ", ".join(plan["symbols"]), fontsize=10)
        descriptions = [label if all_candidates else f"{label}: {candidate}"
                        for candidate, label, _, _ in labels]
        description = "\n".join("  |  ".join(descriptions[i:i + 4])
                                for i in range(0, len(descriptions), 4))
        if single_window and not all_candidates:
            description = "\n".join(textwrap.fill(item, width=115, break_long_words=False,
                                                 break_on_hyphens=False) for item in descriptions)
        fig.text(.08, .875 if single_window else .905, description, fontsize=9, va="top")
        for axis, window in zip(axes.flat, windows):
            start = dt.datetime.fromtimestamp(timestamp(window["start"]) / 1000, dt.timezone.utc)
            for candidate, label, color, style in labels:
                if (window["id"], candidate) not in curves:
                    continue
                points = curves[window["id"], candidate]
                dates = [dt.datetime.fromtimestamp(point["time"] / 1000, dt.timezone.utc) for point in points]
                trades = next(row["trades"] for row in bundle["summaries"][window["id"]] if row["id"] == candidate)
                axis.plot([start, *dates], [1, *[point["nav"] for point in points]], color=color,
                          linestyle=style, linewidth=1.65, label=f"{label}: {points[-1]['nav'] - 1:+.2%} / {trades:,} trades")
            role = window.get("role", "development" if is_development(window) else "historical; role unspecified")
            if window.get("candidateScope") == "selected-and-baseline":
                role += "; frozen selection + baseline only"
            axis.set_title(f"{window.get('label', window['id'])}\n{role}", loc="left", fontsize=10, pad=9)
            axis.axhline(1, color="#9ca9b5", linewidth=.7, linestyle=":")
            axis.set_ylabel("Account NAV")
            duration = (timestamp(window["end"]) - timestamp(window["start"])) // DAY
            axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=3, maxticks=5))
            axis.xaxis.set_major_formatter(mdates.DateFormatter("%b %d" if duration <= 120 else "%Y-%m"))
            axis.yaxis.set_major_locator(MaxNLocator(nbins=5))
            axis.yaxis.set_major_formatter(StrMethodFormatter("{x:.3f}"))
            axis.grid(axis="y", linewidth=.65)
            axis.tick_params(labelsize=9)
            lines = len(axis.lines) - 1  # Exclude the NAV 1.00 reference line.
            axis.legend(loc="best", frameon=False, fontsize=7 if lines > 4 else 8,
                        ncol=2 if lines > 4 else 1)
            axis.margins(x=.015, y=.12)
        for axis in list(axes.flat)[len(windows):]:
            axis.set_visible(False)
        capital, count = sleeve_capital(plan), len(plan["symbols"])
        fig.text(.08, .072, "Each window restarts at NAV 1.00. Independent windows do not form a continuous live track record.", fontsize=9)
        fig.text(.08, .043, f"Net of fees, modeled slippage and funding. Initial USDT {capital * count:,.2f}; {count} fixed sleeves of USDT {capital:,.2f}.", fontsize=9)
        with tempfile.TemporaryDirectory() as temporary:
            svg, png = Path(temporary) / "equity.svg", Path(temporary) / "equity.png"
            fig.savefig(svg, metadata={"Date": None})
            fig.savefig(png, dpi=160)
            atomic_bytes(output / "equity.svg", svg.read_bytes())
            atomic_bytes(output / "equity.png", png.read_bytes())
        plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--curves", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--all-candidates", action="store_true", help="Plot every declared base-cost candidate")
    args = parser.parse_args()
    ensure_writable(args.output, directory=True)
    bundle = read(args.results)
    draw(bundle, load_curves(bundle, args.curves, args.all_candidates), args.output, args.all_candidates)
    print(args.output / "equity.svg")


if __name__ == "__main__":
    main()
