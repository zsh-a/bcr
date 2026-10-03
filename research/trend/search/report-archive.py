"""Preserve the complete generated report bytes without changing research code.

Pack (keeps the original JSON):
  python3 research/trend/search/report-archive.py pack \
    --input research/trend/search/results.json \
    --archive research/trend/search/results.json.gz \
    --manifest research/trend/search/results-archive.json

Restore an exact ordinary JSON file for existing report readers:
  python3 research/trend/search/report-archive.py extract \
    --manifest research/trend/search/results-archive.json \
    --output /tmp/trend-search-results.json

All destinations must be new. Extraction checks both compressed and original
hashes and publishes only verified bytes. This attachment imports no production
research module and does not alter the frozen execution/evaluation identities.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

BLOCK = 1024 * 1024


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def new_destination(path):
    require(not os.path.lexists(path), f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)


def publish(path, temporary):
    # Same-directory link publication is atomic and never overwrites, including
    # when another writer creates the destination after the initial check.
    os.link(temporary, path)


def pack(args):
    require(args.archive.parent.resolve() == args.manifest.parent.resolve(),
            "archive and manifest must share a directory")
    require(args.archive.resolve() != args.manifest.resolve(), "archive and manifest must differ")
    new_destination(args.archive)
    new_destination(args.manifest)
    original_hash, count = hashlib.sha256(), 0
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=args.archive.parent, prefix=".archive-", delete=False) as output:
            temporary = Path(output.name)
            with args.input.open("rb") as source, gzip.GzipFile(
                    filename="", fileobj=output, mode="wb", compresslevel=9, mtime=0) as encoded:
                while chunk := source.read(BLOCK):
                    original_hash.update(chunk)
                    count += len(chunk)
                    encoded.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        require(args.input.stat().st_size == count and digest(args.input) == original_hash.hexdigest(),
                "source changed during packaging")
        source = args.input.resolve()
        repository = Path(__file__).resolve().parents[3]
        source_path = str(source.relative_to(repository)) if source.is_relative_to(repository) else str(source)
        manifest = {
            "version": 1,
            "format": "gzip-preserved-report-bytes",
            "source": {"path": source_path, "generatedPath": str(source),
                       "bytes": count, "sha256": original_hash.hexdigest()},
            "archive": {"file": args.archive.name, "bytes": temporary.stat().st_size,
                        "sha256": digest(temporary)},
            "compression": {"algorithm": "gzip", "level": 9, "mtime": 0, "filename": ""},
            "packer": {"file": Path(__file__).name, "sha256": digest(__file__)},
            "meaning": "Complete results.json bytes emitted by the unchanged report generator; no fields, whitespace, numeric spellings or evaluation identities were changed.",
            "restore": "The generated JSON may be absent from a checkout. Run this attachment's extract command with this manifest and a new output path, then pass the restored ordinary JSON to existing --results readers. The restored bytes must match source.sha256 exactly.",
        }
        publish(args.archive, temporary)
        with tempfile.NamedTemporaryFile(dir=args.manifest.parent, prefix=".archive-", delete=False) as output:
            manifest_temporary = Path(output.name)
            try:
                output.write((json.dumps(manifest, indent=2, allow_nan=False) + "\n").encode())
                output.flush()
                os.fsync(output.fileno())
                publish(args.manifest, manifest_temporary)
            finally:
                manifest_temporary.unlink(missing_ok=True)
        print(json.dumps(manifest, indent=2))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def extract(args):
    new_destination(args.output)
    manifest = json.loads(args.manifest.read_text())
    require(manifest.get("version") == 1 and manifest.get("format") == "gzip-preserved-report-bytes",
            "unsupported archive manifest")
    name = manifest["archive"]["file"]
    require(isinstance(name, str) and name not in ("", ".", "..") and Path(name).name == name,
            "archive must be a filename beside its manifest")
    archive = args.manifest.parent / name
    require(archive.stat().st_size == manifest["archive"]["bytes"]
            and digest(archive) == manifest["archive"]["sha256"], "compressed archive checksum mismatch")
    expected = manifest["source"]
    require(type(expected["bytes"]) is int and expected["bytes"] >= 0, "invalid original byte count")
    actual, count, temporary = hashlib.sha256(), 0, None
    try:
        with tempfile.NamedTemporaryFile(dir=args.output.parent, prefix=".extract-", delete=False) as output:
            temporary = Path(output.name)
            with gzip.open(archive, "rb") as source:
                while chunk := source.read(BLOCK):
                    count += len(chunk)
                    require(count <= expected["bytes"], "extracted data exceeds the declared byte count")
                    actual.update(chunk)
                    output.write(chunk)
            require(count == expected["bytes"] and actual.hexdigest() == expected["sha256"],
                    "restored report checksum mismatch")
            output.flush()
            os.fsync(output.fileno())
        publish(args.output, temporary)
        print(json.dumps({"output": str(args.output), "bytes": count, "sha256": actual.hexdigest()}))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    encode = commands.add_parser("pack", help="compress original bytes; retain the original JSON")
    for name in ("input", "archive", "manifest"):
        encode.add_argument("--" + name, type=Path, required=True)
    decode = commands.add_parser("extract", help="verify and restore to a new ordinary JSON path")
    for name in ("manifest", "output"):
        decode.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    (pack if args.command == "pack" else extract)(args)


if __name__ == "__main__":
    main()
