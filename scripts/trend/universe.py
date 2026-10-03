"""Point-in-time membership metadata, independent of prices and strategy parameters.

Snapshots declare source availability, including exclusions and incomplete coverage.
Binding fixes one universe for a study; this is not a dynamic rebalancing engine.
"""
import datetime as dt
import re


def require(condition, message):
    if not condition:
        raise ValueError(message)


def instant(value):
    require(isinstance(value, str), "universe time must be an ISO timestamp")
    parsed = dt.datetime.fromisoformat(value)
    require(parsed.tzinfo is not None, "universe time needs an explicit timezone")
    return parsed.timestamp() * 1000


def validate_universe_snapshot(snapshot, selected, as_of):
    """Validate a pinned membership snapshot at the actual decision time (milliseconds)."""
    require(isinstance(snapshot, dict) and snapshot.get("kind") == "trend-universe-snapshot"
            and snapshot.get("version") == 1, "unsupported universe snapshot")
    require(isinstance(snapshot.get("venue"), str) and snapshot["venue"], "universe venue required")
    observed, available = instant(snapshot.get("observedAt")), instant(snapshot.get("availableAt"))
    require(observed <= available <= as_of, "universe snapshot was not available as of the decision")
    source = snapshot.get("source", {})
    require(isinstance(source, dict) and isinstance(source.get("uri"), str) and source["uri"]
            and isinstance(source.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", source["sha256"]),
            "universe source requires URI and SHA-256")
    coverage = snapshot.get("coverage", {})
    require(isinstance(coverage, dict) and coverage.get("complete") is True
            and coverage.get("missingSymbols") == [], "incomplete universe coverage cannot support selection")
    members = snapshot.get("members")
    require(isinstance(members, list) and members, "universe members required")
    seen, eligible = set(), set()
    for member in members:
        require(isinstance(member, dict) and isinstance(member.get("symbol"), str) and member["symbol"]
                and type(member.get("eligible")) is bool and isinstance(member.get("reason"), str)
                and member["reason"], "universe member requires symbol, eligibility and reason")
        require(member["symbol"] not in seen, "duplicate universe member")
        seen.add(member["symbol"])
        if member["eligible"]:
            eligible.add(member["symbol"])
    require(set(selected) <= eligible, "selected symbols missing or ineligible in the as-of universe")
    return {"observedAt": snapshot["observedAt"], "availableAt": snapshot["availableAt"],
            "venue": snapshot["venue"], "members": len(members), "eligible": len(eligible)}
