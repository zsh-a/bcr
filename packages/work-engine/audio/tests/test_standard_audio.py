"""Check source preservation and mastering with synthetic PCM, without TTS or model inference."""

import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

TOOLS = Path(__file__).resolve().parents[2]
PYTHON = TOOLS / 'audio/.venv/bin/python'
BUN = shutil.which('bun')


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False) + '\n')


class StandardAudioTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='bcr-audio-fixture-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cache = self.root / '.bcr/narration'
        self.cache.mkdir(parents=True)
        (self.root / 'public/audio').mkdir(parents=True)
        rate = 48000
        time = np.arange(round(2.1 * rate)) / rate
        envelope = np.where((time >= 0.16) & (time <= 1.88), 0.15, 0.0)
        signal = (
            envelope * (np.sin(2 * np.pi * 220 * time) + 0.3 * np.sin(2 * np.pi * 440 * time))
        ).astype(np.float32)
        raw = self.cache / 'fixture.wav'
        sf.write(raw, signal, rate, subtype='FLOAT')
        lines = [
            {'id': 'test-first', 'chapter': 'testing', 'text': '测试', 'caption': '测试'},
            {'id': 'test-second', 'chapter': 'testing', 'text': '样本', 'caption': '样本'},
        ]
        write_json(
            self.cache / 'plan.json',
            {
                'fps': 30,
                'contentHash': 'synthetic-test-only',
                'settings': {'language': 'Chinese'},
                'groups': [
                    {
                        'id': 'test-paragraph',
                        'hash': 'fixture',
                        'raw': str(raw),
                        'text': '测试样本',
                        'lines': lines,
                        'gap': 0,
                    }
                ],
                'programs': {'main': ['test-paragraph']},
            },
        )
        write_json(
            self.cache / 'fixture.alignment.json',
            {
                'model': 'synthetic-test-only',
                'audioSha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
                'words': [
                    {'text': '测试', 'start': 0.2, 'end': 1.0},
                    {'text': '样本', 'start': 1.0, 'end': 1.8},
                ],
            },
        )
        write_json(
            self.root / 'work.json',
            {'id': 'audio-fixture', 'targets': [{'id': 'main', 'fps': 30, 'durationInFrames': 1}]},
        )
        write_json(
            self.root / 'production.json',
            {
                'version': 1,
                'privateAssets': [],
                'targets': {'main': {'audio': 'audio/mix-main.flac'}},
                'audio': {
                    'timeline': 'audio-timeline.json',
                    'score': 'public/audio/score.flac',
                    'mastering': 'audio-mastering.json',
                    'voice': 'voice.json',
                },
            },
        )
        write_json(
            self.root / 'voice.json',
            {
                'mastering': {'loudnessLUFS': -16, 'truePeakDBTP': -1.5},
                'quality': {
                    'maxCaptionWidth': 24,
                    'maxCaptionCharactersPerSecond': 12,
                    'maxParagraphGapSeconds': 1.2,
                    'maxInternalSilenceSeconds': 0.8,
                    'maxCharactersPerMinute': 320,
                },
            },
        )

    def run_python(self, stage, success=True):
        result = subprocess.run(
            [str(PYTHON), str(TOOLS / 'audio/scripts' / stage), str(self.root), '--require-raw'],
            capture_output=True,
            text=True,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_preserves_raw_samples_and_builds_one_lossless_master(self):
        self.run_python('assemble-narration.py')
        for stage in ['soundtrack', 'master']:
            result = subprocess.run(
                [BUN, str(TOOLS / 'src/audio/standard.ts'), stage, str(self.root)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
        self.run_python('check-audio.py')
        timeline = json.loads((self.root / 'audio-timeline.json').read_text())
        report = json.loads((self.root / 'audio-quality.json').read_text())['checks']['main']
        self.assertFalse(timeline['draft'])
        self.assertEqual(report['rawSourceComparison'], 'passed')
        self.assertEqual(report['audioFileSwitches'], 0)
        self.assertEqual(report['subtitleBridges'][0]['insertedSilenceSeconds'], 0)
        self.assertTrue(report['sampleLengthMatchesVideo'])
        master = json.loads((self.root / 'audio-mastering.json').read_text())['main']
        self.assertTrue(master['losslessMaster']['decodedSamplesMatchWav'])
        self.assertTrue((self.cache / 'fixture.wav').exists())

    def test_stale_alignment_fails_before_publishing_timing(self):
        raw = self.cache / 'fixture.wav'
        raw.write_bytes(raw.read_bytes() + b'changed')
        result = self.run_python('assemble-narration.py', success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Stale alignment', result.stderr)
        self.assertFalse((self.root / 'audio-timeline.json').exists())

    def test_alignment_text_must_match_narration(self):
        path = self.cache / 'fixture.alignment.json'
        alignment = json.loads(path.read_text())
        alignment['words'][0]['text'] = '不同'
        write_json(path, alignment)
        result = self.run_python('assemble-narration.py', success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Alignment text differs', result.stderr)


if __name__ == '__main__':
    unittest.main()
