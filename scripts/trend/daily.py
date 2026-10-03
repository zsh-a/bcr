"""Canonical research daily equity, with an adapter for frozen legacy results."""
import math

from protocol import DAY


def daily_equity(row):
    """V2 consumes Rust daily observations and verifies their compatibility copy.

    Research windows cover complete UTC days. Historical unversioned results
    retain their original row.daily representation and validation policy.
    """
    compatibility = row["daily"]
    evaluation = row["metrics"].get("evaluation") or {}
    if "version" not in evaluation:
        return compatibility
    if evaluation["version"] != 2:
        raise ValueError("unsupported Rust evaluation version")
    observations = evaluation.get("daily")
    if not observations or len(observations) != len(compatibility):
        raise ValueError("Rust daily equity and compatibility copy differ in length")
    canonical, previous_end = [], None
    for point, copied in zip(observations, compatibility):
        start, end, equity = point["from"], point["to"], point["equity"]
        if (type(start) is not int or type(end) is not int or start % DAY
                or end - start != DAY or point.get("complete") is not True
                or (previous_end is not None and start != previous_end)):
            raise ValueError("Rust daily equity requires consecutive complete UTC days")
        if (copied["time"] != end - 1 or not math.isfinite(equity)
                or equity != copied["equity"]):
            raise ValueError("Rust daily equity differs from its compatibility copy")
        canonical.append({"time": end - 1, "equity": equity})
        previous_end = end
    return canonical
