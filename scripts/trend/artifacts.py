"""Atomic artifacts, immutable evidence boundaries, and historical receipt audit."""
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

from daily import daily_equity
from protocol import DAY, ROOT, development_window, native_requests, recorded_candidates, timestamp, validate_plan, window_candidates
from warmup import WARMUP_POLICY, warmup_days

REGISTRY = Path(__file__).with_name("frozen.json")


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def ensure_writable(path, directory=False):
    """The registry adds protection; it never changes frozen artifact bytes."""
    target = Path(path).resolve()
    registry = read(REGISTRY)
    directories = [(ROOT / value).resolve() for value in [*registry["runs"], *registry.get("directories", [])]]
    files = [(ROOT / value["path"]).resolve() for value in registry["artifacts"]]
    if (any(target == folder or folder in target.parents for folder in directories)
            or target in files or (directory and any(value.parent == target for value in files))):
        raise ValueError(f"frozen historical destination is read-only: {target}; choose a new output directory")


def atomic_bytes(path, data, replace=True):
    target = Path(path)
    ensure_writable(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".pending-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            temporary.replace(target)
        else:
            # Same-directory hard-link publication is atomic and never replaces
            # an existing frozen manifest/source, including concurrent writers.
            os.link(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2, allow_nan=False) + "\n").encode())


def write_once(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2, allow_nan=False) + "\n").encode(), replace=False)


def content_addressed(folder, data, suffix):
    digest = hashlib.sha256(data).hexdigest()
    path = Path(folder) / (digest + suffix)
    if path.exists():
        if sha(path) != digest:
            raise ValueError(f"content-addressed artifact was modified: {path}")
    else:
        atomic_bytes(path, data)
    return path


def source_fingerprint(*names):
    """A version's complete declared dependencies, independent of report layout."""
    folder = Path(__file__).parent
    sources = [(name, sha(folder / name)) for name in sorted(names)]
    return hashlib.sha256(json.dumps(sources, separators=(",", ":")).encode()).hexdigest()


def evaluation_fingerprint():
    return source_fingerprint("evaluation.py", "daily.py", "protocol.py", "warmup.py")


def execution_fingerprint():
    return source_fingerprint("research.py", "artifacts.py", "daily.py", "protocol.py", "warmup.py")


def verify_frozen():
    records = read(REGISTRY)["artifacts"]
    for record in records:
        if sha(ROOT / record["path"]) != record["sha256"]:
            raise ValueError(f"frozen artifact changed: {record['path']}")
    return len(records)


def load_evidence(plan_path, manifest_path, directory):
    """Audit recorded identities; never compare old code to today's source hash."""
    directory = Path(directory)
    plan = validate_plan(read(plan_path))
    manifest = read(manifest_path)
    selection = read(directory / "selection.json")
    plan_hash, manifest_hash = sha(plan_path), sha(manifest_path)
    if manifest["planSha256"] != plan_hash or selection["planSha256"] != plan_hash:
        raise ValueError("plan differs from the frozen selection or manifest")
    if selection.get("manifestSha256", manifest_hash) != manifest_hash:
        raise ValueError("manifest differs from the frozen selection")
    development = development_window(plan)
    if sha(directory / f"{development['id']}-summary.json") != selection["developmentSha256"]:
        raise ValueError("development summary differs from the frozen selection")
    if selection["id"] not in {candidate["id"] for candidate in plan["candidates"]}:
        raise ValueError("frozen selection is not a declared candidate")
    if set(manifest["symbols"]) != set(plan["symbols"]):
        raise ValueError("manifest symbols differ from the frozen plan")
    return {"plan": plan, "manifest": manifest, "selection": selection, "directory": directory,
            "planSha256": plan_hash, "manifestSha256": manifest_hash, "engine": None}


def validate_batch(batch, requests, window, symbol, plan_hash, warmup_policy=None):
    """Shared pre-publication and historical audit checks for native results."""
    start, end = timestamp(window["start"]), timestamp(window["end"])
    if (batch.get("planSha256") != plan_hash or batch.get("window") != window["id"]
            or batch.get("symbol") != symbol or batch.get("startTime") != start or batch.get("endTime") != end):
        raise ValueError("raw result window/plan identity mismatch")
    if not isinstance(batch.get("engine"), str) or not batch["engine"]:
        raise ValueError("raw result lacks an engine identity")
    expected = {request["id"]: request["config"] for request in requests}
    if len(batch["results"]) != len(expected) or {row["id"] for row in batch["results"]} != set(expected):
        raise ValueError("raw result does not contain every declared candidate exactly once")
    calendar = list(range(start + DAY - 1, end, DAY))
    for row in batch["results"]:
        if row["config"] != expected[row["id"]]:
            raise ValueError("result configuration differs from the recorded request")
        daily = daily_equity(row)
        if [point["time"] for point in daily] != calendar:
            raise ValueError("daily account calendar is incomplete")
        if warmup_policy == WARMUP_POLICY and row.get("warmupStart") != start - warmup_days(row["config"]["strategy"]) * DAY:
            raise ValueError("replay warmup differs from the recorded active-window policy")
        initial = row["config"]["execution"]["initialCapital"]
        final = row["metrics"]["finalEquity"]
        net = sum(trade["netPnl"] for trade in row["trades"])
        if (any(not math.isfinite(value) for value in [initial, final, net])
                or any(not math.isfinite(point["equity"]) for point in daily)
                or not math.isclose(initial + net, final, rel_tol=1e-8, abs_tol=1e-6)
                or not math.isclose(daily[-1]["equity"], final, rel_tol=1e-8, abs_tol=1e-6)):
            raise ValueError("trade ledger, daily account and final cash do not reconcile")


def audit_window(evidence, window):
    plan, selection = evidence["plan"], evidence["selection"]
    candidates = window_candidates(plan, window, selection)
    batches, provenance = [], []
    for symbol in plan["symbols"]:
        path = evidence["directory"] / window["id"] / f"{symbol}.json"
        receipt = read(path.with_suffix(".receipt.json"))
        configs_path = path.with_name(f"{symbol}-configs.json")
        requested = read(configs_path)
        recorded = recorded_candidates(candidates, receipt.get("replayVersion"))
        expected = native_requests(plan, symbol, recorded)
        if requested != expected:
            raise ValueError(f"stored configurations differ from frozen plan: {path}")
        if (receipt["resultSha256"] != sha(path)
                or receipt["configsSha256"] != sha(configs_path)
                or receipt["binarySha256"] != selection["binarySha256"]
                or receipt["manifestSha256"] != evidence["manifestSha256"]
                or receipt.get("planSha256", evidence["planSha256"]) != evidence["planSha256"]
                or receipt["window"] != window):
            raise ValueError(f"raw result provenance mismatch: {path}")
        # Versions predating stage-specific fingerprints kept one runner hash.
        for key in ["runnerSha256", "replayVersion"]:
            if key in selection and receipt.get(key) != selection[key]:
                raise ValueError(f"historical execution identity mismatch: {path}")
        batch = read(path)
        policies = {value for value in [receipt.get("warmupPolicy"), evidence["manifest"].get("warmupPolicy")] if value is not None}
        if len(policies) > 1:
            raise ValueError("receipt and manifest warmup policies differ")
        policy = next(iter(policies), None)
        validate_batch(batch, requested, window, symbol, evidence["planSha256"], policy)
        evidence["engine"] = evidence["engine"] or batch["engine"]
        if batch["engine"] != evidence["engine"]:
            raise ValueError("study mixes engine versions")
        batches.append(batch)
        provenance.append({"window": window["id"], "symbol": symbol, "receipt": receipt,
                           "warmupValidation": "active-window-recomputed" if policy == WARMUP_POLICY else "historical-start-recorded-only",
                           "fundingSha256": evidence["manifest"]["symbols"][symbol]["fundingSha256"],
                           "warmup": {row["id"]: row.get("warmupStart", batch.get("warmupStart"))
                                      for row in batch["results"]}})
    return batches, provenance
