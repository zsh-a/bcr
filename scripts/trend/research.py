"""Execute explicit frozen protocols through the shared Rust minute engine."""
import argparse
import concurrent.futures
from pathlib import Path
import subprocess
import tempfile

from artifacts import atomic_bytes, ensure_writable, evaluation_fingerprint, execution_fingerprint, read, sha, validate_batch, write
from evaluation import EVALUATION_VERSION, select_development, summarize
from protocol import ROOT, REPLAY_VERSION, development_window, is_development, native_requests, timestamp, validate_plan, window_candidates
from warmup import WARMUP_POLICY


def run_symbol(args, plan, window, symbol, candidates, fingerprint):
    ensure_writable(args.output, directory=True)
    out = args.output / window["id"] / f"{symbol}.json"
    configs = args.output / window["id"] / f"{symbol}-configs.json"
    requests = native_requests(plan, symbol, candidates)
    write(configs, requests)
    receipt = out.with_suffix(".receipt.json")
    signature = {"binarySha256": fingerprint, "replayVersion": REPLAY_VERSION,
                 "configsSha256": sha(configs), "manifestSha256": sha(args.manifest),
                 "planSha256": sha(args.plan), "warmupPolicy": WARMUP_POLICY, "window": window}
    recorded = read(receipt) if receipt.exists() else {}
    cached = out.exists() and all(recorded.get(key) == value for key, value in {**signature, "resultSha256": sha(out)}.items())
    if not cached:
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=out.parent, prefix=".replay-") as temporary:
            pending = Path(temporary) / "result.json"
            subprocess.run([str(args.binary), str(args.manifest), symbol, str(configs), str(timestamp(window["start"])),
                            str(timestamp(window["end"])), str(pending), window["id"]], check=True)
            result = read(pending)
            validate_batch(result, requests, window, symbol, signature["planSha256"], WARMUP_POLICY)
            atomic_bytes(out, pending.read_bytes())
        write(receipt, {**signature, "executionSourceSha256": execution_fingerprint(), "resultSha256": sha(out)})
    else:
        result = read(out)
        validate_batch(result, requests, window, symbol, signature["planSha256"], WARMUP_POLICY)
    print(f"replayed {window['id']} {symbol}: {len(candidates)} declared variants", flush=True)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--binary", type=Path, default=ROOT / "crates/quant/target/release/trend")
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
    development = development_window(plan)
    if (selection_path.exists() and args.stage in ["all", development["id"]]
            and read(selection_path).get("evaluationSha256") != evaluation_hash):
        raise ValueError("evaluation changed after selection; use report.py for a new evaluation without reselection")
    selection = None
    for window in plan["windows"]:
        if args.stage != "all" and window["id"] != args.stage:
            continue
        if not is_development(window):
            selection = read(selection_path)
            if (any(selection.get(key) != value for key, value in identity.items())
                    or selection["developmentSha256"] != sha(args.output / f"{development['id']}-summary.json")):
                raise ValueError("frozen development selection does not belong to this run")
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
            write(selection_path, selection)
            print(f"frozen development choice: {selection['id']}; development qualified: {qualified}", flush=True)
        for row in summaries:
            print(f"{window['id']} {row['id']}: return={row['equalSleeveReturn']:.2%}, mean R={row['meanNetR']}, positive symbols={row['profitableSymbols']}/{row['sleeveCount']}", flush=True)


if __name__ == "__main__":
    main()
