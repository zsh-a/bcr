"""Read-only checks of published snapshots or frozen native-run receipts."""
import argparse
import json
from pathlib import Path

from artifacts import audit_window, load_evidence, verify_frozen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frozen", action="store_true", help="verify all registered published artifact hashes")
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()
    if args.frozen:
        if any([args.plan, args.manifest, args.input]):
            parser.error("--frozen is separate from run auditing")
        print(json.dumps({"verifiedArtifacts": verify_frozen()}))
        return
    if not all([args.plan, args.manifest, args.input]):
        parser.error("provide --frozen or all of --plan --manifest --input")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    count = 0
    for window in evidence["plan"]["windows"]:
        batches, _ = audit_window(evidence, window)
        count += len(batches)
    print(json.dumps({"verifiedBatches": count, "engine": evidence["engine"],
                      "selection": evidence["selection"]["id"], "sourceCsvFilesRehashed": False}))


if __name__ == "__main__":
    main()
