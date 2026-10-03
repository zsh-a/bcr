"""Execute explicit frozen protocols through the shared Rust minute engine."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from artifacts import (atomic_bytes, audit_replay_shards, ensure_writable, evaluation_fingerprint,
                       execution_fingerprint, merge_replay_batches, read, resolve_selection_source,
                       sha, validate_batch, write)
from evaluation import EVALUATION_VERSION, fixed_qualification, select_development, summarize
from protocol import (REPLAY_VERSION, development_window, is_development,
                      native_requests, request_batches, timestamp, validate_plan, validate_selection, window_candidates)
from warmup import WARMUP_POLICY


def replay_requests(args, window, symbol, requests, fingerprint, out, configs):
    """One execution/publication lifecycle, regardless of native batch count."""
    chunks = request_batches(requests)
    sharded = len(chunks) > 1
    payload = (json.dumps(requests, indent=2, allow_nan=False) + "\n").encode()
    signature = {"binarySha256": fingerprint, "replayVersion": REPLAY_VERSION,
                 "configsSha256": hashlib.sha256(payload).hexdigest(), "manifestSha256": sha(args.manifest),
                 "planSha256": sha(args.plan), "warmupPolicy": WARMUP_POLICY, "window": window}
    manifest = read(args.manifest)
    if manifest.get("planSha256") != signature["planSha256"] or sha(args.binary) != fingerprint:
        raise ValueError("replay inputs differ from the frozen execution identity")
    receipt = out.with_suffix(".receipt.json")
    recorded = read(receipt) if receipt.exists() else {}
    cached = out.exists() and all(recorded.get(key) == value for key, value in
                                  {**signature, "resultSha256": sha(out)}.items())
    if cached:
        if not configs.exists() or sha(configs) != signature["configsSha256"]:
            raise ValueError("replay configuration checksum mismatch")
        result = read(out)
        validate_batch(result, requests, window, symbol, signature["planSha256"], WARMUP_POLICY)
        audit_replay_shards(recorded, result, requests, window, symbol, signature["planSha256"], manifest, out.parent)
        if not sharded:
            merge_replay_batches([result], requests, window, symbol, signature["planSha256"], manifest)
    else:
        source_hash = execution_fingerprint()
        out.parent.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
        destination = out.parent / (symbol + "-shards") / key
        with tempfile.TemporaryDirectory(dir=out.parent, prefix=".replay-") as temporary:
            temporary = Path(temporary)
            batches, pending_files, shards = [], [], []
            for index, chunk in enumerate(chunks):
                shard_configs = temporary / f"{index:03d}-configs.json"
                shard_result = temporary / f"{index:03d}-result.json"
                write(shard_configs, chunk)
                subprocess.run([str(args.binary), str(args.manifest), symbol, str(shard_configs),
                                str(timestamp(window["start"])), str(timestamp(window["end"])),
                                str(shard_result), window["id"]], check=True)
                batch = read(shard_result)
                validate_batch(batch, chunk, window, symbol, signature["planSha256"], WARMUP_POLICY)
                batches.append(batch)
                if sharded:
                    record = {"index": index, "candidateIds": [row["id"] for row in chunk]}
                    for name, path in [("configs", shard_configs), ("result", shard_result)]:
                        target = destination / path.name
                        record[name + "Path"] = str(target.relative_to(out.parent))
                        record[name + "Sha256"] = sha(path)
                        pending_files.append((path, target, record[name + "Sha256"]))
                    shards.append(record)
                    print(f"validated {window['id']} {symbol}: native shard {index + 1}/{len(chunks)} ({len(chunk)} candidates)", flush=True)
            result = merge_replay_batches(batches, requests, window, symbol, signature["planSha256"], manifest)
            if (sha(args.plan) != signature["planSha256"] or sha(args.manifest) != signature["manifestSha256"]
                    or sha(args.binary) != fingerprint or execution_fingerprint() != source_hash):
                raise ValueError("replay inputs or execution sources changed during execution")
            # Shards are immutable evidence, published only once the entire
            # native batch has passed. A receipt is the final commit marker.
            for pending, target, expected in pending_files:
                if target.exists():
                    if sha(target) != expected:
                        raise ValueError("existing native shard evidence differs; use a new output directory")
                else:
                    atomic_bytes(target, pending.read_bytes(), replace=False)
            final_receipt = {**signature, "executionSourceSha256": source_hash}
            if sharded:
                final_receipt["shards"] = shards
            audit_replay_shards(final_receipt, result, requests, window, symbol, signature["planSha256"], manifest, out.parent)
            atomic_bytes(configs, payload)
            if sharded:
                write(out, result)
            else:
                # Keep the native serialization and historical single-call
                # receipt shape; batching is only an execution detail.
                result = batches[0]
                atomic_bytes(out, shard_result.read_bytes())
            write(receipt, {**final_receipt, "resultSha256": sha(out)})
    print(f"replayed {window['id']} {symbol}: {len(requests)} declared variants", flush=True)
    return result


def run_symbol(args, plan, window, symbol, candidates, fingerprint):
    ensure_writable(args.output, directory=True)
    out = args.output / window["id"] / f"{symbol}.json"
    configs = args.output / window["id"] / f"{symbol}-configs.json"
    requests = native_requests(plan, symbol, candidates)
    return replay_requests(args, window, symbol, requests, fingerprint, out, configs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True, help="explicit native build; replay never compiles or replaces a binary")
    parser.add_argument("--stage", default="all", help="all or a window id from the plan")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    ensure_writable(args.output, directory=True)
    plan = validate_plan(read(args.plan))
    if args.workers < 1:
        raise ValueError("workers must be positive")
    if args.stage != "all" and args.stage not in {w["id"] for w in plan["windows"]}:
        raise ValueError("unknown study window")
    manifest = read(args.manifest)
    if manifest["planSha256"] != sha(args.plan):
        raise ValueError("plan changed after archive download; regenerate manifest")
    fingerprint = sha(args.binary)
    source = resolve_selection_source(plan) if plan.get("selectionMode") == "inherited" else None
    if source is not None and fingerprint != source["selection"]["binarySha256"]:
        raise ValueError("inherited replay must use the source study's native binary")
    identity = {"planSha256": sha(args.plan), "manifestSha256": sha(args.manifest),
                "binarySha256": fingerprint, "replayVersion": REPLAY_VERSION}
    run_path = args.output / "run.json"
    if run_path.exists():
        if any(read(run_path).get(key) != value for key, value in identity.items()):
            raise ValueError("output belongs to another run; choose a new output directory")
    else:
        write(run_path, {**identity, "executionSourceSha256": execution_fingerprint()})
    evaluation_hash = evaluation_fingerprint()
    selection_path = args.output / "selection.json"
    development = None if source is not None else development_window(plan)
    if (development is not None and selection_path.exists() and args.stage in ["all", development["id"]]
            and read(selection_path).get("evaluationSha256") != evaluation_hash):
        raise ValueError("evaluation changed after selection; use report.py for a new evaluation without reselection")
    selection = None
    if source is not None:
        selection = {**identity, "id": plan["fixedCandidate"], "selectionMode": "inherited", "objective": "inherited",
                     "developmentQualified": source["selection"]["developmentQualified"],
                     "developmentQualification": source["qualification"], "qualificationScope": "source-domain",
                     "selectionSource": source["identity"], "evaluationVersion": EVALUATION_VERSION,
                     "evaluationSha256": evaluation_hash, "criterion": plan["selection"]}
        validate_selection(plan, selection)
        if selection_path.exists():
            if read(selection_path) != selection:
                raise ValueError("inherited selection changed; choose a new output directory")
        else:
            write(selection_path, selection)
    for window in plan["windows"]:
        if args.stage != "all" and window["id"] != args.stage:
            continue
        if source is None and not is_development(window):
            selection = read(selection_path)
            if (any(selection.get(key) != value for key, value in identity.items())
                    or selection["developmentSha256"] != sha(args.output / f"{development['id']}-summary.json")):
                raise ValueError("frozen development selection does not belong to this run")
            validate_selection(plan, selection)
        candidates = window_candidates(plan, window, selection)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            batches = list(pool.map(lambda symbol: run_symbol(args, plan, window, symbol, candidates, fingerprint), plan["symbols"]))
        summaries = [summarize(plan, batches, candidate.id) for candidate in candidates]
        write(args.output / f"{window['id']}-summary.json", summaries)
        if is_development(window):
            best, objective, qualified = select_development(plan, summaries)
            selection = {**identity, "id": best["id"], "developmentQualified": qualified,
                         "evaluationVersion": EVALUATION_VERSION, "evaluationSha256": evaluation_hash,
                         "developmentSha256": sha(args.output / f"{development['id']}-summary.json"),
                         "criterion": plan["selection"], "objective": objective}
            if plan.get("selectionMode") == "fixed":
                selection.update(selectionMode="fixed", developmentQualification=fixed_qualification(plan, best))
            validate_selection(plan, selection)
            write(selection_path, selection)
            print(f"frozen development choice: {selection['id']}; development qualified: {qualified}", flush=True)
        for row in summaries:
            print(f"{window['id']} {row['id']}: return={row['equalSleeveReturn']:.2%}, mean R={row['meanNetR']}, positive symbols={row['profitableSymbols']}/{row['sleeveCount']}", flush=True)
    if source is not None and resolve_selection_source(plan)["identity"] != source["identity"]:
        raise ValueError("inherited source changed during replay")


if __name__ == "__main__":
    main()
