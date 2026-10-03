"""Atomic artifacts, immutable evidence boundaries, and historical receipt audit."""
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

from daily import daily_equity
from protocol import (DAY, ROOT, NATIVE_BATCH_SIZE, development_window, native_requests,
                      recorded_candidates, request_batches, timestamp, validate_inherited_rules,
                      validate_plan, validate_selection, validate_selection_source, window_candidates)
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


def evaluation_identity(evidence):
    """Bind an evaluation to recorded inputs, independently of its presentation.

    Preserve the published identity shape and ordered batch digest. A formatting
    change belongs to reportSourceSha256, never to statistical stage gates.
    """
    from evaluation import EVALUATION_VERSION

    records = [{"window": window["id"], "symbol": symbol,
                "sha256": sha(evidence["directory"] / window["id"] / f"{symbol}.json")}
               for window in evidence["plan"]["windows"] for symbol in evidence["plan"]["symbols"]]
    return {"planSha256": evidence["planSha256"], "manifestSha256": evidence["manifestSha256"],
            "selectionSha256": sha(evidence["directory"] / "selection.json"),
            "rawResultsSha256": hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest(),
            "evaluationVersion": EVALUATION_VERSION, "evaluationSha256": evaluation_fingerprint()}


def execution_fingerprint():
    return source_fingerprint("research.py", "artifacts.py", "daily.py", "protocol.py", "warmup.py")


def verify_frozen():
    records = read(REGISTRY)["artifacts"]
    for record in records:
        if sha(ROOT / record["path"]) != record["sha256"]:
            raise ValueError(f"frozen artifact changed: {record['path']}")
    return len(records)


def resolve_selection_source(plan):
    """Verify an old selection in its original domain; never inspect target returns."""
    from evaluation import fixed_qualification

    if plan.get("selectionMode") != "inherited":
        raise ValueError("selection source requires inherited mode")
    source = validate_selection_source(plan.get("selectionSource"))
    paths = {key: ROOT / source[key] for key in ["plan", "manifest", "run"]}
    for key in ["plan", "manifest"]:
        if sha(paths[key]) != source[key + "Sha256"]:
            raise ValueError(f"inherited source {key} checksum mismatch")
    source_plan = validate_plan(read(paths["plan"]))
    if source_plan.get("selectionMode") == "inherited":
        raise ValueError("inherited selection sources must name an original development study")
    development = development_window(source_plan)
    files = {"run": paths["run"] / "run.json", "selection": paths["run"] / "selection.json",
             "development": paths["run"] / f"{development['id']}-summary.json"}
    for key, path in files.items():
        if sha(path) != source[key + "Sha256"]:
            raise ValueError(f"inherited source {key} checksum mismatch")
    evidence = load_evidence(paths["plan"], paths["manifest"], paths["run"])
    selection, run = evidence["selection"], read(files["run"])
    for key in ["planSha256", "manifestSha256", "binarySha256", "replayVersion"]:
        if run.get(key) != selection.get(key):
            raise ValueError("inherited source run differs from its frozen selection")
    # The old receipt audit hashes immutable execution evidence. It does not
    # rerun price data or apply target symbols to the old qualification.
    receipts = []
    candidates = window_candidates(source_plan, development)
    for symbol in source_plan["symbols"]:
        output = paths["run"] / development["id"] / f"{symbol}.json"
        receipt_path = output.with_suffix(".receipt.json")
        receipt = read(receipt_path)
        configs = output.with_name(f"{symbol}-configs.json")
        expected = native_requests(source_plan, symbol, recorded_candidates(candidates, receipt.get("replayVersion")))
        if (receipt["resultSha256"] != sha(output) or receipt["configsSha256"] != sha(configs)
                or read(configs) != expected or receipt["window"] != development
                or any(receipt.get(key) != selection.get(key) for key in
                       ["planSha256", "manifestSha256", "binarySha256", "replayVersion"])):
            raise ValueError("inherited source development receipt mismatch")
        if len(expected) > NATIVE_BATCH_SIZE:
            audit_replay_shards(receipt, read(output), expected, development, symbol,
                                source["planSha256"], evidence["manifest"], output.parent)
        receipts.append({"symbol": symbol, "sha256": sha(receipt_path)})
    chosen = [row for row in read(files["development"]) if row["id"] == selection["id"]]
    if len(chosen) != 1:
        raise ValueError("inherited source lacks exactly one selected development summary")
    qualification = fixed_qualification(source_plan, chosen[0])
    if selection.get("developmentQualified") is not (qualification["status"] == "passed"):
        raise ValueError("inherited source qualification differs from its original domain")
    validate_inherited_rules(plan, source_plan, selection)
    identity = {**source, "selected": selection["id"], "baseline": source_plan.get("baseline"),
                "sourceSymbols": list(source_plan["symbols"]), "sourceDevelopmentWindow": development,
                "binarySha256": selection["binarySha256"], "replayVersion": selection.get("replayVersion"),
                "developmentReceipts": receipts}
    return {"selection": selection, "developmentSummary": chosen[0], "qualification": qualification,
            "identity": identity, "plan": source_plan}


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
    inherited = None
    if plan.get("selectionMode") == "inherited":
        inherited = resolve_selection_source(plan)
        if (selection.get("selectionSource") != inherited["identity"]
                or selection.get("developmentQualification") != inherited["qualification"]
                or selection.get("binarySha256") != inherited["selection"]["binarySha256"]):
            raise ValueError("inherited evidence differs from its audited source")
    else:
        development = development_window(plan)
        if sha(directory / f"{development['id']}-summary.json") != selection["developmentSha256"]:
            raise ValueError("development summary differs from the frozen selection")
    validate_selection(plan, selection)
    if set(manifest["symbols"]) != set(plan["symbols"]):
        raise ValueError("manifest symbols differ from the frozen plan")
    return {"plan": plan, "manifest": manifest, "selection": selection, "directory": directory,
            "planSha256": plan_hash, "manifestSha256": manifest_hash, "engine": None,
            **({"selectionSource": inherited} if inherited is not None else {})}


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
    observer_ids = [r["id"] for r in requests if r["config"]["version"] >= 10
                    and r["config"]["strategy"]["entry"] == "structured-pullback"]
    observations = batch.get("opportunityDiagnostics")
    if observer_ids:
        if (not isinstance(observations, dict) or observations.get("version") != 1
                or not isinstance(observations.get("scope"), str) or not observations["scope"]
                or not isinstance(observations.get("results"), list)
                or [r.get("id") for r in observations["results"]] != observer_ids):
            raise ValueError("opportunity diagnostics must cover each declared v10 structured candidate in order")
    elif observations is not None:
        raise ValueError("opportunity diagnostics are unsupported by these recorded configurations")
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


def replay_partitions(manifest, symbol, warmup, end):
    """Mirror the native CLI's month-level source selection, preserving repeats.

    A scoped month may have several continuous partitions. All are read before
    the native minute filter, so repeated month labels are part of provenance.
    """
    return [part["month"] for part in manifest["symbols"][symbol]["partitions"]
            if timestamp(part["month"] + "-01") < end
            and timestamp(part["month"] + "-01") + 31 * DAY > warmup]


def merge_replay_batches(batches, requests, window, symbol, plan_hash, manifest):
    chunks = request_batches(requests)
    if len(batches) != len(chunks):
        raise ValueError("missing native replay shard")
    common, observation_identity, observations = None, None, []
    for batch, chunk in zip(batches, chunks):
        validate_batch(batch, chunk, window, symbol, plan_hash, WARMUP_POLICY)
        if [row["id"] for row in batch["results"]] != [row["id"] for row in chunk]:
            raise ValueError("native shard candidate order differs from request")
        warmup = min(row["warmupStart"] for row in batch["results"])
        if (batch.get("warmupStart") != warmup
                or batch.get("partitions") != replay_partitions(manifest, symbol, warmup, batch["endTime"])):
            raise ValueError("native shard warmup/source partitions differ from frozen manifest")
        if "opportunityDiagnostics" in batch:
            diagnostic = batch["opportunityDiagnostics"]
            header = {key: value for key, value in diagnostic.items() if key != "results"}
            if observation_identity is not None and header != observation_identity:
                raise ValueError("native shards mix opportunity diagnostic identities")
            observation_identity = header
            observations.extend(diagnostic["results"])
        identity = {key: value for key, value in batch.items()
                    if key not in ("results", "warmupStart", "partitions", "opportunityDiagnostics")}
        if batch.get("version") != 1 or (common is not None and identity != common):
            raise ValueError("native shards mix engine, window or result identities")
        common = identity
    warmup = min(batch["warmupStart"] for batch in batches)
    result = {**common, "warmupStart": warmup,
              "partitions": replay_partitions(manifest, symbol, warmup, timestamp(window["end"])),
              "results": [row for batch in batches for row in batch["results"]]}
    if observation_identity is not None:
        result["opportunityDiagnostics"] = {**observation_identity, "results": observations}
    validate_batch(result, requests, window, symbol, plan_hash, WARMUP_POLICY)
    return result


def audit_replay_shards(receipt, batch, requests, window, symbol, plan_hash, manifest, directory):
    """A merged v4 result remains linked to every immutable native input/output."""
    shards = receipt.get("shards")
    if len(requests) <= NATIVE_BATCH_SIZE and shards is None:
        return
    chunks = request_batches(requests)
    if (receipt.get("replayVersion") not in ["trend-native-replay-4", "trend-native-replay-5"] or not isinstance(shards, list)
            or len(shards) != len(chunks)):
        raise ValueError("merged replay lacks complete native shard provenance")
    batches = []
    for index, (record, chunk) in enumerate(zip(shards, chunks)):
        if record.get("index") != index or record.get("candidateIds") != [row["id"] for row in chunk]:
            raise ValueError("native shard order/candidates differ from frozen requests")
        paths = []
        for key in ("configs", "result"):
            path = Path(record[key + "Path"])
            if path.is_absolute() or Path(directory).resolve() not in (Path(directory) / path).resolve().parents:
                raise ValueError("native shard path must stay inside its result directory")
            path = Path(directory) / path
            if sha(path) != record[key + "Sha256"]:
                raise ValueError("native shard checksum mismatch")
            paths.append(path)
        if read(paths[0]) != chunk:
            raise ValueError("native shard configuration differs from frozen requests")
        batches.append(read(paths[1]))
    expected = merge_replay_batches(batches, requests, window, symbol, plan_hash, manifest)
    if expected != batch:
        raise ValueError("merged result differs from its validated native shards")


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
        audit_replay_shards(receipt, batch, requested, window, symbol, evidence["planSha256"],
                            evidence["manifest"], path.parent)
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
