"""Content-addressed private snapshots with actual restore verification."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore(snapshot, destination):
    manifest = json.loads(snapshot.read_text())
    store = snapshot.parent.parent
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, record in manifest['files'].items():
        target = destination / name
        if not target.resolve().is_relative_to(destination.resolve()):
            raise ValueError('Snapshot member escapes destination')
        source = store / 'objects' / record['sha256'][:2] / record['sha256']
        if source.stat().st_size != record['bytes'] or digest(source) != record['sha256']:
            raise ValueError(f'Corrupt backup object: {name}')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o600)
        if digest(target) != record['sha256']:
            raise ValueError(f'Restored bytes differ: {name}')
    if manifest.get('release') and (destination / 'release-history' / manifest['release']).is_dir():
        (destination / 'release-history/current').symlink_to(
            manifest['release'], target_is_directory=True
        )
        (destination / 'work/out').symlink_to(
            '../release-history/current/files', target_is_directory=True
        )
    return {'restored': len(manifest['files']), 'directory': str(destination)}


def collect(directory, prefix, entries, exclude=()):
    if directory.is_file() and not directory.is_symlink():
        entries[str(prefix)] = directory
        return
    if not directory.is_dir():
        return
    for current, names, files in os.walk(directory, followlinks=False):
        names[:] = sorted(
            name
            for name in names
            if name not in exclude and not (Path(current) / name).is_symlink()
        )
        for name in sorted(files):
            path = Path(current) / name
            if not path.is_symlink():
                entries[str(Path(prefix) / path.relative_to(directory))] = path


def backup(spec):
    root = Path(spec['root'])
    store = Path(spec['store'])
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    store.chmod(0o700)
    entries = {}
    collect(
        root, 'work', entries, {'.git', '.bcr', 'node_modules', 'out', '__pycache__', '.ruff_cache'}
    )
    for folder in spec['sources'] + spec['experiments']:
        path = (root / folder).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError(f'Storage source escapes Work: {folder}')
        collect(
            path,
            str(Path('work') / folder),
            entries,
            {'__pycache__', 'node_modules', '.ruff_cache'},
        )
    releases = Path(spec['workspace']) / '.releases' / spec['project']
    collect(releases, 'release-history', entries)
    engine = Path(spec['engine'])
    for folder in ['src', 'templates', 'audio/scripts', 'audio/tests']:
        collect(engine / folder, str(Path('engine/work-engine') / folder), entries, {'__pycache__'})
    for name in ['package.json', 'tsconfig.json', 'audio/pyproject.toml', 'audio/uv.lock']:
        entries[f'engine/work-engine/{name}'] = engine / name
    entries['engine/bun.lock'] = Path(spec['engineLock'])
    core = engine.parent / 'work-core'
    collect(core / 'src', 'engine/work-core/src', entries)
    if (core / 'package.json').is_file():
        entries['engine/work-core/package.json'] = core / 'package.json'
    workspace_file = Path(spec['workspace']) / 'workspace.json'
    if workspace_file.is_file():
        entries['workspace/workspace.json'] = workspace_file
    with tempfile.TemporaryDirectory(prefix='bcr-backup-') as temporary:
        if spec.get('state'):
            database = Path(temporary) / 'state.sqlite'
            with (
                sqlite3.connect(f'file:{spec["state"]}?mode=ro', uri=True) as source,
                sqlite3.connect(database) as target,
            ):
                source.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('Database snapshot integrity failed')
            entries['state/state.sqlite'] = database
        records = {
            name: {'sha256': digest(path), 'bytes': path.stat().st_size}
            for name, path in sorted(entries.items())
        }
        written = 0
        for name, record in records.items():
            target = store / 'objects' / record['sha256'][:2] / record['sha256']
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if digest(target) != record['sha256']:
                    raise ValueError(f'Existing backup object is corrupt: {name}')
            else:
                with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                    temporary_object = Path(stream.name)
                    with entries[name].open('rb') as source:
                        shutil.copyfileobj(source, stream)
                if digest(temporary_object) != record['sha256']:
                    temporary_object.unlink()
                    raise ValueError(f'Source changed during backup: {name}')
                temporary_object.chmod(0o600)
                temporary_object.replace(target)
                written += 1
        current_release = (
            os.readlink(releases / 'current') if (releases / 'current').is_symlink() else None
        )
        identity = hashlib.sha256(
            json.dumps(
                {'files': records, 'project': spec['project'], 'release': current_release},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        snapshot = store / 'snapshots' / f'{identity}.json'
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        manifest = {
            'version': 1,
            'project': spec['project'],
            'files': records,
            'release': current_release,
        }
        # Verify a real restored tree before publishing the final snapshot manifest.
        candidate = snapshot.with_suffix('.tmp')
        candidate.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        with tempfile.TemporaryDirectory(prefix='bcr-restore-proof-') as proof:
            restore(candidate, Path(proof) / 'restored')
        for name, path in entries.items():
            if digest(path) != records[name]['sha256']:
                raise ValueError(f'Source changed during restore proof: {name}')
        candidate.replace(snapshot)
        snapshot.chmod(0o600)
    return {
        'snapshot': str(snapshot),
        'files': len(records),
        'objectsWritten': written,
        'actualRestoreVerified': True,
        'privateOnly': True,
        'crossDeviceBackup': False,
    }


parser = argparse.ArgumentParser()
parser.add_argument('--specification', type=Path)
parser.add_argument('--restore', type=Path)
parser.add_argument('--destination', type=Path)
arguments = parser.parse_args()
if arguments.restore:
    if arguments.destination is None:
        parser.error('--restore requires --destination')
    result = restore(arguments.restore.resolve(), arguments.destination.resolve())
else:
    if arguments.specification is None:
        parser.error('--specification is required')
    result = backup(json.loads(arguments.specification.read_text()))
print(json.dumps(result, ensure_ascii=False))
