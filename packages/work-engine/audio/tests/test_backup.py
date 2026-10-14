"""The snapshot store must deduplicate and restore actual source bytes."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/backup-work.py'


class SnapshotTest(unittest.TestCase):
    def test_incremental_snapshot_and_restore(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            work = root / 'workspace/work'
            work.mkdir(parents=True)
            (work / 'content.json').write_text('original')
            engine = root / 'engine'
            for folder in ['audio', 'src']:
                (engine / folder).mkdir(parents=True)
            for name in ['package.json', 'tsconfig.json', 'audio/pyproject.toml', 'audio/uv.lock']:
                (engine / name).write_text('fixture')
            (root / 'bun.lock').write_text('lock')
            spec = root / 'specification.json'
            spec.write_text(
                json.dumps(
                    {
                        'root': str(work),
                        'project': 'work',
                        'workspace': str(work.parent),
                        'sources': [],
                        'experiments': [],
                        'engine': str(engine),
                        'engineLock': str(root / 'bun.lock'),
                        'store': str(root / 'backups'),
                    }
                )
            )

            def backup():
                return json.loads(
                    subprocess.check_output(
                        [sys.executable, str(SCRIPT), '--specification', str(spec)], text=True
                    )
                )

            first = backup()
            second = backup()
            self.assertTrue(first['actualRestoreVerified'])
            self.assertGreater(first['objectsWritten'], 0)
            self.assertEqual(second['objectsWritten'], 0)
            self.assertEqual(first['snapshot'], second['snapshot'])
            (work / 'content.json').write_text('changed')
            third = backup()
            self.assertEqual(third['objectsWritten'], 1)
            destination = root / 'restored'
            subprocess.check_output(
                [
                    sys.executable,
                    str(SCRIPT),
                    '--restore',
                    first['snapshot'],
                    '--destination',
                    str(destination),
                ]
            )
            self.assertEqual((destination / 'work/content.json').read_text(), 'original')
            self.assertEqual((work / 'content.json').read_text(), 'changed')


if __name__ == '__main__':
    unittest.main()
