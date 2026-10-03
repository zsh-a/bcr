"""Metadata catalog, two-axis study cells, and audited sequential stage gates.

This is a small adapter to download/research/transfer_evaluation, not another
runner. Catalog snapshots contain source references, never strategy parameters.
Compile publishes one existing-format plan/manifest per symbol/time cell.
Catalog and preflight read metadata only; compile and seal audit recorded
account evidence. No command downloads or reads prices.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re

from artifacts import audit_window, evaluation_identity, load_evidence, read, sha, write_once
from evaluation import EVALUATION_VERSION, fixed_qualification, summarize
from protocol import DAY, sleeve_capital, timestamp, validate_plan
from transfer_evaluation import evaluate
from warmup import WARMUP_POLICY, warmup_days
from universe import validate_universe_snapshot

ROLES = ("development", "validation", "holdout")
CLAIMS = ("known-reused", "asset-holdout-known-time", "future-time")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def reference(path):
    path = Path(path).resolve()
    return {"path": str(path), "sha256": sha(path)}


def verified(ref):
    require(isinstance(ref, dict) and set(ref) == {"path", "sha256"}, "invalid artifact reference")
    path = Path(ref["path"])
    require(sha(path) == ref["sha256"], "artifact SHA mismatch: " + str(path))
    return read(path)


def payload(value):
    return (json.dumps(value, indent=2, allow_nan=False) + "\n").encode()


def semantic_identity(value):
    """Source hashes remain in immutable evidence, not semantic compatibility."""
    return {key: item for key, item in value.items()
            if key not in ("evaluationSha256", "auditorSha256", "generatorSha256", "warmupSourceSha256")}


def indexed(rows, label):
    require(isinstance(rows, list) and rows, label + " must be nonempty")
    ids = [r.get("id") for r in rows]
    require(all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", x) for x in ids)
            and len(set(ids)) == len(ids), label + " requires unique safe ids")
    return dict(zip(ids, rows))


def interval(row):
    start, end = timestamp(row["start"]), timestamp(row["end"])
    require(start % DAY == end % DAY == 0 and start < end, "invalid complete UTC interval")
    return start, end


def covered(ranges, start, end):
    cursor = start
    for first, last in sorted(interval(row) for row in ranges):
        if first > cursor:
            break
        cursor = max(cursor, last)
        if cursor >= end:
            return True
    return False


def catalog_snapshot(identifier, manifests):
    """Import *metadata* once; old plan identity becomes provenance only.

Each (dataset_id, path) imports exactly one source manifest. Sources can be
reused by any later experiment without retaining that old strategy/plan hash.
Imported historical windows are conservatively marked exposed, warmup included.
"""
    datasets, exposures = [], []
    for name, path in manifests:
        source = read(path)
        windows = source.get("warmupWindows")
        require(isinstance(windows, list) and windows, "source needs explicit warmupWindows metadata")
        price = [{"start": w["warmupStart"], "end": w["end"]} for w in windows]
        funding = [{"start": w["start"], "end": w["end"]} for w in windows]
        for row in price + funding:
            interval(row)
        datasets.append({"id": name, "availability": "available", "symbols": copy.deepcopy(source["symbols"]),
                         "coverage": price, "fundingCoverage": funding,
                         "priceValidation": copy.deepcopy(source.get("priceValidation", {})),
                         "provenance": reference(path)})
        exposures.extend({**row, "symbols": list(source["symbols"])} for row in price)
    indexed(datasets, "datasets")
    return {"version": 1, "id": identifier, "datasets": datasets, "exposures": exposures}


def _catalog_metadata(catalog):
    """Verify immutable old datasets and narrowly admitted future sources."""
    datasets = indexed(catalog["datasets"], "datasets")
    parent = verified(catalog["parent"]) if "parent" in catalog else None
    if parent is not None:
        _catalog_metadata(parent)
        old = indexed(parent["datasets"], "datasets")
        require(catalog["id"] == parent["id"] and set(datasets) == set(old), "extension cannot replace catalog/dataset identities")
        require(catalog.get("exposures", [])[:len(parent.get("exposures", []))] == parent.get("exposures", []),
                "extension must retain every previous exposure record")
        for key, prior in old.items():
            if prior != datasets[key]:
                require(prior.get("availability") == "not-yet-available" and "admission" in datasets[key],
                        "extension cannot change an existing source dataset")
    exposures = copy.deepcopy(catalog.get("exposures", []))
    for dataset in datasets.values():
        if dataset.get("availability") == "not-yet-available":
            require(not dataset.get("symbols") and not dataset.get("coverage") and not dataset.get("fundingCoverage"),
                    "reserved dataset must contain no invented coverage")
            continue
        require("provenance" in dataset, "available datasets require pinned source metadata")
        verified(dataset["provenance"])
        expected = catalog_snapshot(dataset["id"], [(dataset["id"], dataset["provenance"]["path"])])
        copied = {k: v for k, v in dataset.items() if k != "admission"}
        require(copied == expected["datasets"][0], "catalog source snapshot differs from pinned metadata")
        if "admission" in dataset:
            require(parent is not None, "future source admission requires an immutable parent catalog")
            declaration = verified(dataset["admission"])
            cells = [c for c in declaration["cells"] if c["dataset"] == dataset["id"]]
            require(cells and all(c["claim"] == "future-time" for c in cells), "reserved admission is limited to predeclared future cells")
            windows = indexed(declaration["windows"], "windows")
            universes = indexed(declaration["universes"], "universes")
            symbols = set()
            for cell in cells:
                window = windows[cell["window"]]
                start, end = interval(window)
                require(window["role"] == "holdout"
                        and start > dt.datetime.fromisoformat(declaration["frozenAt"]).timestamp() * 1000,
                        "admission must preserve a post-freeze holdout window")
                require(covered(dataset["coverage"], start - max(warmup_days(c) for c in declaration["protocol"]["candidates"]) * DAY, end)
                        and covered(dataset["fundingCoverage"], start, end), "admitted metadata does not cover the frozen future window")
                symbols.update(universes[cell["universe"]]["symbols"])
            require(symbols == set(dataset["symbols"]), "admission cannot replace or expand the predeclared future universe")
            # Such data is only a holdout for the original frozen experiment.
            exposures.extend({**e, "admission": dataset["admission"]} for e in expected["exposures"])
        else:
            for exposure in expected["exposures"]:
                first, last = interval(exposure)
                for symbol in exposure["symbols"]:
                    require(covered([e for e in exposures if symbol in e["symbols"]], first, last),
                            "catalog omits exposure from an imported observed source")
    return exposures


def extend_catalog(parent_path, experiment_path, dataset_id, manifest_path):
    """Admit completed future metadata without changing a frozen experiment."""
    parent = read(parent_path)
    _catalog_metadata(parent)
    require(any(d["id"] == dataset_id and d.get("availability") == "not-yet-available" for d in parent["datasets"]),
            "only an existing reserved dataset can be activated")
    imported = catalog_snapshot(dataset_id, [(dataset_id, manifest_path)])["datasets"][0]
    imported["admission"] = reference(experiment_path)
    result = {**copy.deepcopy(parent), "parent": reference(parent_path)}
    result["datasets"] = [imported if d["id"] == dataset_id else d for d in result["datasets"]]
    check = preflight(result, read(experiment_path))
    require(all(c["status"] == "ready" for c in check["cells"] if c["dataset"] == dataset_id),
            "future source is not yet available for the complete declared window")
    return result


def _catalog_descends(current, prior):
    while current != prior:
        value = verified(current)
        if "parent" not in value:
            return False
        current = value["parent"]
    return True


def preflight(catalog, experiment, *, today=None):
    """Pure metadata inspection: never open source CSV/JSON account results."""
    require(catalog.get("version") == experiment.get("version") == 1, "unsupported study/catalog version")
    datasets = indexed(catalog["datasets"], "datasets")
    universes = indexed(experiment["universes"], "universes")
    windows = indexed(experiment["windows"], "windows")
    cells = indexed(experiment["cells"], "cells")
    exposed = [e for e in _catalog_metadata(catalog)
               if "admission" not in e or verified(e["admission"]) != experiment]
    protocol = experiment["protocol"]
    require(protocol.get("selectionMode") == "fixed", "study adapter requires a predeclared fixed primary")
    require(not {"symbols", "windows", "selectionSource"} & set(protocol), "protocol must not contain data axes or source selection")
    require(not protocol.get("sensitivity"), "declare finite ablations as candidates, not target sensitivities")
    require(protocol.get("transferEvaluation", {}).get("requireDevelopmentQualified") is True
            and protocol["transferEvaluation"].get("requireEachWindowPositive") is True,
            "stage gates require frozen development qualification and positive returns")
    limit = protocol["transferEvaluation"].get("maxDailyDrawdown")
    require(type(limit) in (int, float) and 0 < limit <= 1, "frozen stage drawdown bound required")
    separation = experiment.get("separation", {})
    require(set(separation) == {"purgeDays", "gapDays"}
            and all(type(v) is int and v >= 0 for v in separation.values()), "explicit nonnegative purge/gap days required")
    freeze = dt.datetime.fromisoformat(experiment["frozenAt"])
    require(freeze.tzinfo is not None, "frozenAt must have an explicit timezone")
    frozen_ms = int(freeze.timestamp() * 1000)
    available_until = timestamp(str(today or dt.datetime.now(dt.timezone.utc).date()))
    assigned = set()
    for universe in universes.values():
        require(universe["role"] in ROLES and isinstance(universe["symbols"], dict) and universe["symbols"], "invalid symbol role/universe")
        require(not assigned & set(universe["symbols"]), "each symbol has one universe role; reuse that universe across time cells")
        assigned.update(universe["symbols"])
        if "snapshot" in universe:
            starts = [interval(windows[c["window"]])[0] for c in cells.values() if c["universe"] == universe["id"]]
            validate_universe_snapshot(verified(universe["snapshot"]), universe["symbols"], min([frozen_ms, *starts]))
    for window in windows.values():
        require(window["role"] in ROLES, "invalid time role")
        interval(window)
    for left in windows.values():
        for right in windows.values():
            if ROLES.index(left["role"]) < ROLES.index(right["role"]):
                require(timestamp(left["end"]) + sum(separation.values()) * DAY <= timestamp(right["start"]),
                        "time roles must advance chronologically with the declared purge/gap, including different symbols")
    result = []
    for cell in cells.values():
        require(set(cell) == {"id", "universe", "window", "dataset", "claim"}, "cell fields must be explicit and minimal")
        require(cell["universe"] in universes and cell["window"] in windows and cell["dataset"] in datasets, "unknown cell axis/dataset")
        universe, window, dataset = universes[cell["universe"]], windows[cell["window"]], datasets[cell["dataset"]]
        stage = max((universe["role"], window["role"]), key=ROLES.index)
        symbols = set(universe["symbols"])
        start, end = interval(window)
        require(cell["claim"] in CLAIMS, "unsupported evidence claim; freshOOS is not a metadata fact")
        known = False
        for exposure in exposed:
            first, last = interval(exposure)
            known |= bool(symbols & set(exposure["symbols"])) and start < last and first < end
        if cell["claim"] != "known-reused":
            require(not known, "previously exposed symbol/time cell cannot be relabeled fresh")
        if cell["claim"] == "asset-holdout-known-time":
            require(universe["role"] == "holdout" and not any(symbols & set(e["symbols"]) for e in exposed),
                    "asset holdout requires previously untested symbols assigned holdout")
        if cell["claim"] == "future-time":
            require(start > frozen_ms and window["role"] == "holdout", "future-time requires a post-freeze holdout time window")
        days = max(warmup_days(c) for c in protocol["candidates"])
        begin = start - days * DAY
        missing = []
        if dataset.get("availability", "available") != "available":
            missing.append("reserved-dataset")
        if not symbols <= set(dataset.get("symbols", {})):
            missing.append("symbol-sources")
        if not covered(dataset.get("coverage", []), begin, end):
            missing.append("price-context-coverage")
        if not covered(dataset.get("fundingCoverage", []), start, end):
            missing.append("active-funding-coverage")
        if end > available_until:
            missing.append("unfinished-calendar")
        result.append({**cell, "stage": stage, "symbolRole": universe["role"], "timeRole": window["role"],
                       "symbols": sorted(symbols), "start": window["start"], "end": window["end"],
                       "warmupDays": days, "warmupStart": dt.datetime.fromtimestamp(begin / 1000, dt.timezone.utc).date().isoformat(),
                       "status": "not-yet-available" if missing else "ready", "missing": missing,
                       "contextOnly": True, "knownExposure": known})
    require(sum(c["stage"] == "development" for c in result) == 1, "exactly one development cell is required")
    require(all(any(c["stage"] == stage for c in result) for stage in ROLES), "declare development, validation and final holdout cells")
    for index, left in enumerate(result):
        for right in result[index + 1:]:
            if not set(left["symbols"]) & set(right["symbols"]):
                continue
            a, b = sorted((left, right), key=lambda c: c["start"])
            require(timestamp(a["end"]) <= timestamp(b["start"]), "scored symbol/time cells overlap")
            if a["stage"] != b["stage"]:
                require(ROLES.index(a["stage"]) < ROLES.index(b["stage"]), "same-symbol stages must advance in time")
                require(timestamp(a["end"]) + sum(separation.values()) * DAY <= timestamp(b["start"]),
                        "declared purge plus gap must remain outside scored account windows")
    return {"version": 1, "cells": result,
            "scope": "Metadata coverage only; readiness does not verify source bytes or authorize skipping stage gates. Warmup never expands account or scoring dates.",
            "limits": "Exposure/frozenAt are auditable local declarations, not a trusted timestamp or an access-control proof of human ignorance. Import explicitly marks historical source observations known; a registered plan alone is not evidence of consumed observations."}


def _values(catalog, experiment, cell, source=None):
    """Compile one existing runner domain; preserve independent per-sleeve cash."""
    universe = next(u for u in experiment["universes"] if u["id"] == cell["universe"])
    dataset = next(d for d in catalog["datasets"] if d["id"] == cell["dataset"])
    plan = copy.deepcopy(experiment["protocol"])
    plan.update(symbols=copy.deepcopy(universe["symbols"]), windows=[{
        "id": cell["id"], "role": cell["stage"], "start": cell["start"], "end": cell["end"]}])
    if cell["stage"] != "development":
        require(source is not None, "later stages require audited source selection")
        origin = verified(source["plan"])
        selection = verified(source["selection"])
        keep = {selection["id"], origin["baseline"]}
        plan["candidates"] = [c for c in plan["candidates"] if c["id"] in keep]
        for key in ("selectionMinTrades", "selectionMinProfitableSymbols", "selectionCandidates", "selectionObjective"):
            plan.pop(key, None)
        plan.update(selectionMode="inherited", fixedCandidate=selection["id"], stressCandidates=[c["id"] for c in plan["candidates"]],
                    comparisons=[], sensitivity=[], selectionSource=source["selectionSource"])
        if plan.get("capitalMode") == "total-account-equal-sleeves":
            plan["initialCapital"] = sleeve_capital(origin) * len(plan["symbols"])
    plan["transferEvaluation"]["windows"] = [cell["id"]]
    plan["studyCell"] = {k: cell[k] for k in ("id", "stage", "symbolRole", "timeRole", "claim")}
    validate_plan(plan)
    manifest = {"version": 2, "planSha256": hashlib.sha256(payload(plan)).hexdigest(), "warmupPolicy": WARMUP_POLICY,
                "warmupWindows": [{**plan["windows"][0], "warmupDays": cell["warmupDays"], "warmupStart": cell["warmupStart"]}],
                "priceValidation": copy.deepcopy(dataset.get("priceValidation", {})),
                "generatorSha256": sha(__file__), "warmupSourceSha256": sha(Path(__file__).with_name("warmup.py")),
                "symbols": {symbol: copy.deepcopy(dataset["symbols"][symbol]) for symbol in plan["symbols"]}}
    return plan, manifest


def _compilation(path):
    value = read(path)
    require(value.get("kind") == "study-compilation-v1", "not a study compilation")
    catalog, experiment = verified(value["catalog"]), verified(value["experiment"])
    cell = next((c for c in preflight(catalog, experiment)["cells"] if c["id"] == value["cell"]), None)
    require(cell is not None and cell["status"] == "ready", "compiled cell unavailable")
    source = _gates(catalog, experiment, cell, value["receipts"], value["catalog"], value["experiment"])
    expected_plan, expected_manifest = _values(catalog, experiment, cell, source)
    require(verified(value["plan"]) == expected_plan
            and semantic_identity(verified(value["manifest"])) == semantic_identity(expected_manifest),
            "compilation differs from frozen catalog/experiment")
    return value, cell


def _seal_value(compilation_path, run, evaluation=None):
    compilation, cell = _compilation(compilation_path)
    plan_path, manifest_path = Path(compilation["plan"]["path"]), Path(compilation["manifest"]["path"])
    run = Path(run).resolve()
    evidence = load_evidence(plan_path, manifest_path, run)
    plan, selection = evidence["plan"], evidence["selection"]
    window = plan["windows"][0]
    batches, _ = audit_window(evidence, window)
    run_ref, selection_ref = reference(run / "run.json"), reference(run / "selection.json")
    run_identity = verified(run_ref)
    require(all(run_identity.get(k) == selection.get(k) for k in
                ("planSha256", "manifestSha256", "binarySha256", "replayVersion")), "run/selection identity mismatch")
    common = {"kind": "study-stage-seal-v1", "compilation": reference(compilation_path),
              "catalog": compilation["catalog"], "experiment": compilation["experiment"], "cell": cell["id"],
              "stage": cell["stage"], "run": str(run), "runIdentity": run_ref, "selection": selection_ref,
              "selected": selection["id"], "rawIdentity": semantic_identity(evaluation_identity(evidence)),
              "auditorSha256": sha(__file__)}
    if cell["stage"] == "development":
        require(evaluation is None, "development gate uses actual base ledger, not a supplied verdict")
        require(selection["id"] == plan["fixedCandidate"] and selection.get("evaluationVersion") == EVALUATION_VERSION,
                "development fixed choice/evaluation semantic version differs; use an explicit migration for a new evaluator")
        summary = summarize(plan, batches, selection["id"], bootstrap=False)
        qualification = fixed_qualification(plan, summary)
        require(qualification == selection["developmentQualification"]
                and selection["developmentQualified"] is (qualification["status"] == "passed"),
                "development qualification differs from actual audited accounts")
        checks = {"sourceQualification": qualification["status"] == "passed", "basePositiveReturn": summary["equalSleeveReturn"] > 0,
                  "baseDailyDrawdown": summary["dailyPortfolioDrawdown"] >= -plan["transferEvaluation"]["maxDailyDrawdown"]}
        source = {"plan": compilation["plan"], "selection": selection_ref,
                  "selectionSource": {"plan": str(plan_path), "manifest": str(manifest_path), "run": str(run),
                                      "planSha256": sha(plan_path), "manifestSha256": sha(manifest_path),
                                      "runSha256": run_ref["sha256"], "selectionSha256": selection_ref["sha256"],
                                      "developmentSha256": sha(run / (cell["id"] + "-summary.json"))}}
        return {**common, "passed": all(checks.values()), "checks": checks, "qualification": qualification,
                "baseReturn": summary["equalSleeveReturn"], "baseDailyDrawdown": summary["dailyPortfolioDrawdown"],
                "costScope": "development-base-only", "source": source}
    require(evaluation is not None, "later stages require the formal transfer evaluation artifact")
    recorded = read(evaluation)
    require(semantic_identity(recorded.get("evaluationIdentity", {})) == semantic_identity(evaluation_identity(evidence))
            and recorded.get("selection") == selection, "formal evaluation belongs to different inputs or selection")
    require(all(isinstance(recorded.get(key), str) and re.fullmatch(r"[0-9a-f]{64}", recorded[key])
                for key in ("transferSourceSha256", "generatorSha256")), "formal evaluation lacks recorded source provenance")
    actual = evaluate(plan, selection, {window["id"]: batches}, selection_source=evidence["selectionSource"])
    require(all(recorded.get(key) == value for key, value in actual.items()), "formal evaluation differs from recomputed audited ledgers")
    return {**common, "evaluation": reference(evaluation), "passed": actual["acceptance"]["status"] == "passed-for-forward-observation",
            "acceptance": actual["acceptance"], "costScope": "base-and-stress"}


def _gates(catalog, experiment, cell, refs, catalog_ref, experiment_ref):
    if cell["stage"] == "development":
        require(not refs, "development cannot import target-domain receipts")
        return None
    cells = preflight(catalog, experiment)["cells"]
    required = {c["id"] for c in cells if c["stage"] == "development"
                or (cell["stage"] == "holdout" and c["stage"] == "validation")}
    seen, source = set(), None
    for ref in refs:
        receipt = verified(ref)
        require(receipt.get("cell") in required and receipt["cell"] not in seen, "unexpected/duplicate stage receipt")
        require(receipt.get("experiment") == experiment_ref
                and _catalog_descends(catalog_ref, receipt.get("catalog")), "receipt belongs to another experiment/catalog lineage")
        require(receipt.get("passed") is True, "a failed stage cannot unlock later observations")
        audit_stage_receipt(ref["path"])
        seen.add(receipt["cell"])
        if receipt["stage"] == "development":
            source = receipt["source"]
    require(seen == required, "missing prerequisite stage receipts")
    return source


def compile_cell(catalog_path, experiment_path, cell_id, output, receipts=()):
    catalog_ref, experiment_ref = reference(catalog_path), reference(experiment_path)
    catalog, experiment = verified(catalog_ref), verified(experiment_ref)
    cell = next((c for c in preflight(catalog, experiment)["cells"] if c["id"] == cell_id), None)
    require(cell is not None and cell["status"] == "ready", "unknown or not-yet-available cell")
    refs = [reference(path) for path in receipts]
    source = _gates(catalog, experiment, cell, refs, catalog_ref, experiment_ref)
    plan, manifest = _values(catalog, experiment, cell, source)
    output = Path(output)
    require(not output.exists(), "compilation requires a new directory")
    write_once(output / "plan.json", plan)
    write_once(output / "manifest.json", manifest)
    receipt = {"kind": "study-compilation-v1", "catalog": catalog_ref, "experiment": experiment_ref,
               "cell": cell_id, "stage": cell["stage"], "plan": reference(output / "plan.json"),
               "manifest": reference(output / "manifest.json"), "receipts": refs}
    write_once(output / "compilation.json", receipt)
    return receipt


def seal_stage(compilation, run, output, evaluation=None):
    require(not Path(output).exists(), "existing stage receipt is immutable")
    result = _seal_value(compilation, run, evaluation)
    write_once(output, result)
    return result


def audit_stage_receipt(path):
    """Read a recorded verdict only after replay receipts and gates have been re-audited."""
    receipt = read(path)
    verified(receipt["compilation"])
    if "evaluation" in receipt:
        verified(receipt["evaluation"])
    actual = _seal_value(receipt["compilation"]["path"], receipt["run"], receipt.get("evaluation", {}).get("path"))
    require(semantic_identity(actual) == semantic_identity(receipt), "stage receipt was not produced by audited evidence")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    catalog = sub.add_parser("catalog")
    catalog.add_argument("--id", required=True)
    catalog.add_argument("--dataset", action="append", required=True, help="NAME=existing-manifest.json (repeatable)")
    catalog.add_argument("--output", type=Path, required=True)
    extend = sub.add_parser("extend")
    extend.add_argument("--catalog", type=Path, required=True)
    extend.add_argument("--experiment", type=Path, required=True)
    extend.add_argument("--dataset", required=True)
    extend.add_argument("--manifest", type=Path, required=True)
    extend.add_argument("--output", type=Path, required=True)
    for name in ("preflight", "compile"):
        command = sub.add_parser(name)
        command.add_argument("--catalog", type=Path, required=True)
        command.add_argument("--experiment", type=Path, required=True)
        if name == "compile":
            command.add_argument("--cell", required=True)
            command.add_argument("--receipt", type=Path, action="append", default=[])
            command.add_argument("--output", type=Path, required=True)
    seal = sub.add_parser("seal")
    seal.add_argument("--compilation", type=Path, required=True)
    seal.add_argument("--run", type=Path, required=True)
    seal.add_argument("--evaluation", type=Path)
    seal.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "catalog":
        result = catalog_snapshot(args.id, [value.split("=", 1) for value in args.dataset])
        write_once(args.output, result)
        print(json.dumps({"output": str(args.output), "sha256": sha(args.output)}))
    elif args.command == "extend":
        result = extend_catalog(args.catalog, args.experiment, args.dataset, args.manifest)
        write_once(args.output, result)
        print(json.dumps({"output": str(args.output), "sha256": sha(args.output)}))
    elif args.command == "preflight":
        print(json.dumps(preflight(read(args.catalog), read(args.experiment)), indent=2))
    elif args.command == "compile":
        print(json.dumps(compile_cell(args.catalog, args.experiment, args.cell, args.output, args.receipt), indent=2))
    else:
        result = seal_stage(args.compilation, args.run, args.output, args.evaluation)
        print(json.dumps({"cell": result["cell"], "stage": result["stage"], "passed": result["passed"], "sha256": sha(args.output)}))


if __name__ == "__main__":
    main()
