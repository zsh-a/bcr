"""Frozen-plan validation and deterministic strategy/capital expansion."""
import datetime as dt
from dataclasses import dataclass, field, replace
import math
import re
from pathlib import Path
from typing import Literal

from warmup import is_development, warmup_days

DAY = 86400000
ROOT = Path(__file__).resolve().parents[2]
REPLAY_VERSION = "trend-native-replay-5"
NATIVE_BATCH_SIZE = 16
MAX_CANDIDATES = 64
MAX_EXPANDED_CANDIDATES = 128
MAX_RESEARCH_DAYS = 1096


@dataclass(frozen=True)
class Candidate:
    id: str
    strategy: dict
    cost_scenario: Literal["base", "stress"] = "base"
    risk_overrides: dict = field(default_factory=dict)

    @classmethod
    def from_definition(cls, definition):
        return cls(definition["id"], {k: v for k, v in definition.items() if k not in ("id", "riskOverrides")},
                   risk_overrides=validate_risk_overrides(definition.get("riskOverrides", {})))


def validate_risk_overrides(overrides):
    """Only the declared daily guard may differ from the plan's shared risk."""
    if (not isinstance(overrides, dict) or set(overrides) - {"dailyLossPct"}
            or any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= .5
                   for value in overrides.values())):
        raise ValueError("riskOverrides only supports finite dailyLossPct in 0–0.5")
    return dict(overrides)


def effective_risk(plan, candidate):
    return {**plan["risk"], **validate_risk_overrides(candidate.risk_overrides)}


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
    if version not in [4, 5, 6, 7, 8, 9, 10]:
        raise ValueError("research configVersion must be 4, 5, 6, 7, 8, 9 or 10")
    if version == 4 and "maxCostAtr" in candidate.strategy:
        raise ValueError("independent maxCostAtr requires configVersion 5 or later")
    strategy = candidate.strategy
    if version < 8 and any(key in strategy for key in ["channelExitBars", "breakoutReentry"]):
        raise ValueError("independent channel exit and breakout reentry require configVersion 8")
    if "channelExitBars" in strategy:
        bars = strategy["channelExitBars"]
        if strategy.get("management") != "channel" or type(bars) is not int or not 1 <= bars <= 1000:
            raise ValueError("channelExitBars requires channel management and an integer in 1–1000")
    if "breakoutReentry" in strategy and (strategy.get("entry", "breakout") != "breakout"
            or strategy["breakoutReentry"] not in ["every-close", "episode"]):
        raise ValueError("breakoutReentry requires breakout entry and every-close or episode")
    bars = strategy.get("breakoutBars", 20)
    if type(bars) is not int or not 2 <= bars <= (1000 if version >= 8 else 250):
        raise ValueError("breakoutBars exceeds the configuration version's range")
    if version < 7 and (strategy.get("entry") == "price-action" or "priceAction" in strategy):
        raise ValueError("price action requires configVersion 7")
    if strategy.get("entry") == "price-action":
        settings = strategy.get("priceAction")
        if (not isinstance(settings, dict) or set(settings) != {"keyLevel", "twoLegs"}
                or any(type(value) is not bool for value in settings.values())):
            raise ValueError("price-action entry requires boolean keyLevel and twoLegs")
    elif "priceAction" in strategy:
        raise ValueError("other entries must omit priceAction settings")
    if version < 9 and (strategy.get("entry") == "structured-pullback"
                        or "structuredPullback" in strategy or strategy.get("management") == "chandelier"):
        raise ValueError("structured pullback and chandelier management require configVersion 9")
    if strategy.get("entry") == "structured-pullback":
        settings = strategy.get("structuredPullback")
        choices = {"keyLevel": {"none", "pivot", "validated-ema", "either"},
                   "shape": {"none", "any", "two-legs", "wedge", "channel", "double-test"},
                   "candle": {"none", "reversal"}}
        if version >= 10:
            choices.update(confirmation={"before-breakout", "signal-close"},
                           keyRole={"pullback-retest", "impulse-context"})
        if (not isinstance(settings, dict) or set(settings) != set(choices)
                or any(not isinstance(settings[key], str) or settings[key] not in allowed
                       for key, allowed in choices.items())):
            raise ValueError("structured-pullback requires explicit policies for its configuration version")
    elif "structuredPullback" in strategy:
        raise ValueError("other entries must omit structuredPullback settings")
    if strategy.get("management") == "chandelier" and strategy.get("breakEvenAtr", 0) != 0:
        raise ValueError("chandelier management has no separate break-even module")
    if version < 6 and (strategy.get("entry") == "kdj" or strategy.get("filter") == "slow-ema"
                        or strategy.get("management") == "staged" or "staged" in strategy):
        raise ValueError("KDJ, slow EMA and staged management require configVersion 6")
    if strategy.get("management") == "staged":
        staged = strategy.get("staged")
        if (not isinstance(staged, dict) or set(staged) != {"breakEvenR", "trailingStartR"}
                or any(type(value) not in [int, float] or not math.isfinite(value) or not 0 <= value <= 20
                       for value in staged.values())):
            raise ValueError("staged management requires finite breakEvenR and trailingStartR in 0–20")
    elif "staged" in strategy:
        raise ValueError("non-staged management must omit staged settings")
    if candidate.cost_scenario not in ["base", "stress"]:
        raise ValueError("unknown candidate cost scenario")
    stress = candidate.cost_scenario == "stress"
    return {"version": version, "strategy": {"entry": "breakout", "direction": "both", "breakoutBars": 20,
            **({"maxCostAtr": 0} if version >= 5 else {}),
            **candidate.strategy},
            "execution": {**plan["symbols"][symbol], "initialCapital": sleeve_capital(plan),
                "feeBps": plan["costs"]["stressFeeBps" if stress else "feeBps"],
                "slippageBps": plan["costs"]["stressSlippageBps" if stress else "slippageBps"]},
            "risk": effective_risk(plan, candidate)}


def explicit_stress_candidates(plan):
    """An omitted list preserves historical selection/baseline stress expansion."""
    if "stressCandidates" not in plan:
        return None
    values = plan["stressCandidates"]
    if (not isinstance(values, list) or not values
            or any(not isinstance(value, str) for value in values)):
        raise ValueError("stressCandidates must be a nonempty list of declared candidate ids")
    if len(values) != len(set(values)):
        raise ValueError("stressCandidates must be unique")
    if not set(values) <= {candidate["id"] for candidate in plan["candidates"]}:
        raise ValueError("stressCandidates must name declared candidates")
    return values


def window_candidates(plan, window, selection=None):
    scope = window.get("candidateScope", "all")
    if scope not in ["all", "selected-and-baseline"]:
        raise ValueError("candidateScope must be all or selected-and-baseline")
    if is_development(window) and scope != "all":
        raise ValueError("development requires candidateScope all")
    candidates = [Candidate.from_definition(c) for c in plan["candidates"]]
    if len({c.id for c in candidates}) != len(candidates):
        raise ValueError("candidate ids must be unique")
    if len(candidates) > MAX_CANDIDATES:
        raise ValueError("research supports at most 64 declared candidates")
    stress_ids = explicit_stress_candidates(plan)
    if is_development(window):
        return candidates
    if selection is None:
        raise ValueError("non-development windows require a frozen selection")
    selected = next(c for c in candidates if c.id == selection["id"])
    if scope == "selected-and-baseline":
        allowed = {selected.id, plan.get("baseline")}
        candidates = [candidate for candidate in candidates if candidate.id in allowed]
    if stress_ids is None:
        stress_ids = [selected.id]
        baseline = plan.get("baseline")
        if baseline and baseline != selected.id:
            stress_ids.append(baseline)
    declared = {candidate.id: candidate for candidate in candidates}
    candidates += [replace(declared[candidate_id], id=candidate_id + "-stress", cost_scenario="stress")
                   for candidate_id in stress_ids if candidate_id in declared]
    candidates += [replace(selected, id=selected.id + "-" + sensitivity["id"], cost_scenario="base",
                           strategy={**selected.strategy, **{k: v for k, v in sensitivity.items() if k != "id"}})
                   for sensitivity in (plan.get("sensitivity", []) if scope == "all" else [])]
    if len({c.id for c in candidates}) != len(candidates):
        raise ValueError("generated stress/sensitivity ids collide with declared candidates")
    if len(candidates) > MAX_EXPANDED_CANDIDATES:
        raise ValueError("cost/sensitivity expansion exceeds 128 research candidates")
    return candidates


def recorded_candidates(candidates, replay_version):
    """Historical evidence retains its recorded pre-v3 name-based cost rule."""
    if replay_version in ["trend-native-replay-3", "trend-native-replay-4", REPLAY_VERSION]:
        return candidates
    if replay_version not in [None, "trend-native-replay-1", "trend-native-replay-2"]:
        raise ValueError("unsupported recorded replay protocol")
    return [replace(c, cost_scenario="stress" if c.id.endswith("-stress") else "base")
            for c in candidates]


def native_requests(plan, symbol, candidates):
    return [{"id": c.id, "config": config(plan, symbol, c)} for c in candidates]


def request_batches(requests):
    """One study/selection, deterministically transported in bounded native calls."""
    if not 1 <= len(requests) <= MAX_EXPANDED_CANDIDATES:
        raise ValueError("replay requires 1–128 candidate requests")
    if len({row["id"] for row in requests}) != len(requests):
        raise ValueError("replay candidate requests must be unique")
    return [requests[index:index + NATIVE_BATCH_SIZE] for index in range(0, len(requests), NATIVE_BATCH_SIZE)]


def development_window(plan):
    windows = [window for window in plan["windows"] if is_development(window)]
    if len(windows) != 1:
        raise ValueError("plan requires exactly one development window")
    return windows[0]


def validate_selection_source(source):
    paths = {"plan", "manifest", "run"}
    hashes = {"planSha256", "manifestSha256", "runSha256", "selectionSha256", "developmentSha256"}
    if (not isinstance(source, dict) or set(source) != paths | hashes
            or any(not isinstance(source[key], str) or not source[key].strip() for key in paths)
            or any(not isinstance(source[key], str) or not re.fullmatch(r"[0-9a-f]{64}", source[key]) for key in hashes)):
        raise ValueError("selectionSource requires plan/manifest/run paths and all five SHA-256 identities")
    return source


def validate_inherited_rules(plan, source_plan, source_selection):
    """Only target symbols/precision and observation windows may change the policy."""
    primary, baseline = source_selection["id"], source_plan.get("baseline")
    if (plan["fixedCandidate"] != primary or plan.get("baseline") != baseline
            or {c["id"] for c in plan["candidates"]} != {primary, baseline}):
        raise ValueError("inherited candidates must be the source selection and source baseline")
    if (plan.get("configVersion", 4) != source_plan.get("configVersion", 4)
            or plan["costs"] != source_plan["costs"]
            or plan.get("capitalMode", "independent-equal-sleeves") != source_plan.get("capitalMode", "independent-equal-sleeves")
            or sleeve_capital(plan) != sleeve_capital(source_plan)):
        raise ValueError("inherited configuration version, costs and sleeve capital policy must match the source")
    prior = {c["id"]: Candidate.from_definition(c) for c in source_plan["candidates"]}
    old_symbol, new_symbol = next(iter(source_plan["symbols"])), next(iter(plan["symbols"]))
    for definition in plan["candidates"]:
        current = Candidate.from_definition(definition)
        old_config, new_config = config(source_plan, old_symbol, prior[current.id]), config(plan, new_symbol, current)
        if old_config["strategy"] != new_config["strategy"] or old_config["risk"] != new_config["risk"]:
            raise ValueError("inherited strategy and effective risk must exactly match the source")


def validate_selection(plan, selection):
    """Check the recorded choice against its plan, without choosing again."""
    if selection["id"] not in {candidate["id"] for candidate in plan["candidates"]}:
        raise ValueError("frozen selection is not a declared candidate")
    if "selectionCandidates" in plan and selection["id"] not in plan["selectionCandidates"]:
        raise ValueError("frozen selection is outside the declared selectionCandidates")
    if plan.get("selectionMode") == "fixed":
        if (selection["id"] != plan["fixedCandidate"] or selection.get("selectionMode") != "fixed"
                or selection.get("objective") != "fixed"):
            raise ValueError("frozen selection differs from the predeclared fixed candidate")
        qualification = selection.get("developmentQualification", {})
        status = qualification.get("status")
        if (status not in ["insufficient-sample", "failed", "passed"]
                or selection.get("developmentQualified") is not (status == "passed")
                or not isinstance(qualification.get("reasons"), list)
                or bool(qualification["reasons"]) == (status == "passed")):
            raise ValueError("fixed selection lacks consistent development qualification")
    if plan.get("selectionMode") == "inherited":
        source = selection.get("selectionSource", {})
        if (selection["id"] != plan["fixedCandidate"] or selection.get("selectionMode") != "inherited"
                or selection.get("objective") != "inherited" or selection.get("qualificationScope") != "source-domain"
                or not isinstance(source, dict) or any(source.get(k) != v for k, v in plan["selectionSource"].items())
                or "developmentSha256" in selection):
            raise ValueError("inherited selection differs from its source or fabricates local development")
        qualification = selection.get("developmentQualification", {})
        status = qualification.get("status")
        if (status not in ["insufficient-sample", "failed", "passed"]
                or selection.get("developmentQualified") is not (status == "passed")
                or not isinstance(qualification.get("reasons"), list)
                or bool(qualification["reasons"]) == (status == "passed")):
            raise ValueError("inherited selection lacks consistent source-domain qualification")


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
    if len(plan["candidates"]) > MAX_CANDIDATES:
        raise ValueError("research supports at most 64 declared candidates")
    explicit_stress_candidates(plan)
    if plan.get("sensitivity"):
        names([value["id"] for value in plan["sensitivity"]], "sensitivity ids")
        if any("riskOverrides" in value for value in plan["sensitivity"]):
            raise ValueError("riskOverrides belongs to declared candidates; sensitivities inherit it")
    if plan.get("baseline") is not None and plan["baseline"] not in {c["id"] for c in plan["candidates"]}:
        raise ValueError("baseline must name a declared candidate")
    mode = plan.get("selectionMode", "ranked")
    if mode not in ["ranked", "fixed", "inherited"]:
        raise ValueError("selectionMode must be ranked, fixed or inherited")
    if mode in ["fixed", "inherited"]:
        if plan.get("fixedCandidate") not in {c["id"] for c in plan["candidates"]}:
            raise ValueError("fixedCandidate must name a declared candidate")
        if "selectionCandidates" in plan or "selectionObjective" in plan:
            raise ValueError("fixed selection cannot declare selectionCandidates or selectionObjective")
        for key, default in [("selectionMinTrades", 30), ("selectionMinProfitableSymbols", 4)]:
            if type(plan.get(key, default)) is not int or plan.get(key, default) < 1:
                raise ValueError(f"{key} must be a positive integer")
    elif "fixedCandidate" in plan:
        raise ValueError("fixedCandidate requires selectionMode fixed or inherited")
    if mode == "inherited":
        validate_selection_source(plan.get("selectionSource"))
        if any(is_development(window) for window in plan["windows"]):
            raise ValueError("inherited studies cannot contain a development window")
        if any(key in plan for key in ["selectionMinTrades", "selectionMinProfitableSymbols"]):
            raise ValueError("inherited studies cannot impose new development qualification")
        if plan.get("sensitivity"):
            raise ValueError("inherited studies cannot add sensitivity candidates")
        if set(plan.get("stressCandidates", [])) != {c["id"] for c in plan["candidates"]}:
            raise ValueError("inherited studies must retain both cost scenarios for every candidate")
    elif "selectionSource" in plan:
        raise ValueError("selectionSource requires selectionMode inherited")
    if "selectionCandidates" in plan:
        if not isinstance(plan["selectionCandidates"], list):
            raise ValueError("selectionCandidates must be a list of declared candidate ids")
        names(plan["selectionCandidates"], "selectionCandidates")
        if not set(plan["selectionCandidates"]) <= {c["id"] for c in plan["candidates"]}:
            raise ValueError("selectionCandidates must name declared candidates")
    comparisons = plan.get("comparisons", [])
    if comparisons:
        names([value["id"] for value in comparisons], "comparison ids")
        declared = {candidate["id"] for candidate in plan["candidates"]}
        if any(value.get("candidate") not in declared or value.get("reference") not in declared
               or value["candidate"] == value["reference"] for value in comparisons):
            raise ValueError("comparisons require two different declared candidates")
    if mode != "inherited":
        development_window(plan)
        if not is_development(plan["windows"][0]):
            raise ValueError("development must precede all evaluation windows")
    for window in plan["windows"]:
        start, end = timestamp(window["start"]), timestamp(window["end"])
        if start % DAY or end % DAY or not 0 < end - start <= MAX_RESEARCH_DAYS * DAY:
            raise ValueError("windows must cover 1–1096 full UTC days with exclusive end")
    if plan.get("selectionObjective", "medianSymbolMeanR") not in ["medianSymbolMeanR", "dailySharpe"]:
        raise ValueError("unknown development selection objective")
    if not math.isfinite(sleeve_capital(plan)):
        raise ValueError("initial capital must be finite")
    for candidate in plan["candidates"]:
        warmup_days(candidate)
        for symbol in plan["symbols"]:
            config(plan, symbol, Candidate.from_definition(candidate))
        for window in plan["windows"]:
            window_candidates(plan, window, {"id": candidate["id"]})
    bootstrap = plan["bootstrap"]
    if any(not isinstance(bootstrap[key], int) or bootstrap[key] < 1 for key in ["samples", "blockDays"]):
        raise ValueError("bootstrap samples and blockDays must be positive integers")
    if not isinstance(bootstrap["seed"], int):
        raise ValueError("bootstrap seed must be an integer")
    return plan
