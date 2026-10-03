"""Frozen-plan validation and deterministic strategy/capital expansion."""
import datetime as dt
from dataclasses import dataclass, replace
import math
import re
from pathlib import Path
from typing import Literal

from warmup import is_development, warmup_days

DAY = 86400000
ROOT = Path(__file__).resolve().parents[2]
REPLAY_VERSION = "trend-native-replay-3"


@dataclass(frozen=True)
class Candidate:
    id: str
    strategy: dict
    cost_scenario: Literal["base", "stress"] = "base"

    @classmethod
    def from_definition(cls, definition):
        return cls(definition["id"], {k: v for k, v in definition.items() if k != "id"})


def timestamp(date):
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def sleeve_capital(plan):
    mode = plan.get("capitalMode", "independent-equal-sleeves")
    if mode not in ["independent-equal-sleeves", "total-account-equal-sleeves"]:
        raise ValueError("unknown capital allocation mode")
    if not plan["symbols"] or plan["initialCapital"] <= 0:
        raise ValueError("positive capital and at least one sleeve are required")
    return plan["initialCapital"] / len(plan["symbols"]) if mode == "total-account-equal-sleeves" else plan["initialCapital"]


def config(plan, symbol, candidate: Candidate):
    version = plan.get("configVersion", 4)
    if version not in [4, 5]:
        raise ValueError("research configVersion must be 4 or 5")
    if version == 4 and "maxCostAtr" in candidate.strategy:
        raise ValueError("independent maxCostAtr requires configVersion 5")
    if candidate.cost_scenario not in ["base", "stress"]:
        raise ValueError("unknown candidate cost scenario")
    stress = candidate.cost_scenario == "stress"
    return {"version": version, "strategy": {"entry": "breakout", "direction": "both", "breakoutBars": 20,
            **({"maxCostAtr": 0} if version == 5 else {}),
            **candidate.strategy},
            "execution": {**plan["symbols"][symbol], "initialCapital": sleeve_capital(plan),
                "feeBps": plan["costs"]["stressFeeBps" if stress else "feeBps"],
                "slippageBps": plan["costs"]["stressSlippageBps" if stress else "slippageBps"]},
            "risk": plan["risk"]}


def window_candidates(plan, window, selection=None):
    candidates = [Candidate.from_definition(c) for c in plan["candidates"]]
    if len({c.id for c in candidates}) != len(candidates):
        raise ValueError("candidate ids must be unique")
    if is_development(window):
        return candidates
    if selection is None:
        raise ValueError("non-development windows require a frozen selection")
    selected = next(c for c in candidates if c.id == selection["id"])
    candidates += [replace(selected, id=selected.id + "-stress", cost_scenario="stress")]
    baseline = plan.get("baseline")
    if baseline and baseline != selected.id:
        baseline_config = next(c for c in candidates if c.id == baseline)
        candidates += [replace(baseline_config, id=baseline + "-stress", cost_scenario="stress")]
    candidates += [Candidate(selected.id + "-" + sensitivity["id"],
                            {**selected.strategy, **{k: v for k, v in sensitivity.items() if k != "id"}})
                   for sensitivity in plan.get("sensitivity", [])]
    if len({c.id for c in candidates}) != len(candidates):
        raise ValueError("generated stress/sensitivity ids collide with declared candidates")
    return candidates


def recorded_candidates(candidates, replay_version):
    """Historical evidence retains its recorded pre-v3 name-based cost rule."""
    if replay_version == REPLAY_VERSION:
        return candidates
    if replay_version not in [None, "trend-native-replay-1", "trend-native-replay-2"]:
        raise ValueError("unsupported recorded replay protocol")
    return [replace(c, cost_scenario="stress" if c.id.endswith("-stress") else "base")
            for c in candidates]


def native_requests(plan, symbol, candidates):
    return [{"id": c.id, "config": config(plan, symbol, c)} for c in candidates]


def development_window(plan):
    windows = [window for window in plan["windows"] if is_development(window)]
    if len(windows) != 1:
        raise ValueError("plan requires exactly one development window")
    return windows[0]


def validate_plan(plan):
    """Reject ambiguous/path-unsafe protocols before downloading or writing."""
    def names(values, label):
        if not values or len(values) != len(set(values)):
            raise ValueError(f"{label} must be nonempty and unique")
        if any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", value)
               for value in values):
            raise ValueError(f"{label} must be safe path identifiers")
    names(list(plan["symbols"]), "symbols")
    names([candidate["id"] for candidate in plan["candidates"]], "candidate ids")
    names([window["id"] for window in plan["windows"]], "window ids")
    if len(plan["candidates"]) > 16:
        raise ValueError("native replay supports at most 16 candidates per batch")
    if plan.get("sensitivity"):
        names([value["id"] for value in plan["sensitivity"]], "sensitivity ids")
    if plan.get("baseline") is not None and plan["baseline"] not in {c["id"] for c in plan["candidates"]}:
        raise ValueError("baseline must name a declared candidate")
    development_window(plan)
    if not is_development(plan["windows"][0]):
        raise ValueError("development must precede all evaluation windows")
    for window in plan["windows"]:
        start, end = timestamp(window["start"]), timestamp(window["end"])
        if start % DAY or end % DAY or not 0 < end - start <= 730 * DAY:
            raise ValueError("windows must cover 1–730 full UTC days with exclusive end")
    if plan.get("selectionObjective", "medianSymbolMeanR") not in ["medianSymbolMeanR", "dailySharpe"]:
        raise ValueError("unknown development selection objective")
    if not math.isfinite(sleeve_capital(plan)):
        raise ValueError("initial capital must be finite")
    for candidate in plan["candidates"]:
        warmup_days(candidate)
        for symbol in plan["symbols"]:
            config(plan, symbol, Candidate.from_definition(candidate))
        for window in plan["windows"]:
            if len(window_candidates(plan, window, {"id": candidate["id"]})) > 16:
                raise ValueError("cost/sensitivity expansion exceeds 16 native candidates")
    bootstrap = plan["bootstrap"]
    if any(not isinstance(bootstrap[key], int) or bootstrap[key] < 1 for key in ["samples", "blockDays"]):
        raise ValueError("bootstrap samples and blockDays must be positive integers")
    if not isinstance(bootstrap["seed"], int):
        raise ValueError("bootstrap seed must be an integer")
    return plan
