"""Regression checks for timing, source preservation and a single mastered track."""

import hashlib
import json
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(sys.argv[1]).resolve()
timeline = json.loads((ROOT / 'audio-timeline.json').read_text())
plan_path = ROOT / '.bcr/narration/plan.json'
plan = json.loads(plan_path.read_text()) if plan_path.exists() else None
if '--require-raw' in sys.argv and plan is None:
    raise ValueError('Raw narration plan is required for rebuild verification')
mastering = json.loads((ROOT / 'audio-mastering.json').read_text())
work = json.loads((ROOT / 'work.json').read_text())
voice = json.loads((ROOT / 'voice.json').read_text())
quality = voice['quality']
if timeline.get('draft'):
    raise ValueError('Draft timing cannot pass audio acceptance')
rate = timeline['sampleRate']
report = {'version': 2, 'sampleRate': rate, 'checks': {}}


def caption_width(line):
    """One width unit is one full-width glyph; limits belong to voice.json."""
    return sum(1.0 if unicodedata.east_asian_width(char) in ('W', 'F') else 0.5 for char in line)


def longest_quiet(signal):
    hop = rate // 200
    count = len(signal) // hop
    rms = np.sqrt(np.mean(signal[: count * hop].reshape(-1, hop) ** 2, axis=1))
    best = current = 0
    for quiet in rms < 10 ** (-45 / 20):
        current = current + 1 if quiet else 0
        best = max(best, current)
    return round(best * hop / rate, 4)


variants = [
    key for key, value in timeline.items() if isinstance(value, dict) and value.get('audioFile')
]
if not variants:
    raise ValueError('No measured narration track')
for variant in variants:
    track = timeline[variant]
    mixed, mix_sr = sf.read(ROOT / 'public' / track['audioFile'], dtype='float32')
    # The narration master lives in the cache; a checkout without it still runs
    # every other check, and the report says the sample comparison was skipped.
    narration_path = ROOT / '.bcr/narration' / track['narrationFile']
    pcm = sf.read(narration_path, dtype='float32')[0] if narration_path.exists() else None
    assert mix_sr == rate
    assert mixed.ndim == 2 and mixed.shape[1] == 2
    assert (
        len(mixed) == track['samples'] == round(track['durationInFrames'] / timeline['fps'] * rate)
    )
    assert np.isfinite(mixed).all()
    if pcm is not None:
        assert pcm.ndim == 1 and len(pcm) == len(mixed)
        assert np.isfinite(pcm).all()
    assert float(np.max(np.abs(mixed))) < 0.999
    assert (
        next(target['durationInFrames'] for target in work['targets'] if target['id'] == variant)
        == track['durationInFrames']
    )
    assert (
        mastering[variant]['sha256']
        == hashlib.sha256((ROOT / 'public' / track['audioFile']).read_bytes()).hexdigest()
    )
    assert (
        abs(float(mastering[variant]['verified']['input_i']) - voice['mastering']['loudnessLUFS'])
        <= 0.3
    )
    assert (
        float(mastering[variant]['verified']['input_tp'])
        <= voice['mastering']['truePeakDBTP'] + 0.1
    )
    previous_end = 0
    reading = []
    for cue in track['segments']:
        assert previous_end <= cue['start'] < cue['end'] <= track['durationInFrames']
        assert abs(cue['start'] / timeline['fps'] - cue['speechStart']) <= 2 / timeline['fps']
        assert cue['speechStart'] < cue['speechEnd']
        lines = cue['caption'].split('\n')
        assert 1 <= len(lines) <= 2 and all(
            caption_width(line) <= quality['maxCaptionWidth'] for line in lines
        )
        visible_characters = sum(character.isalnum() for character in cue['caption'])
        seconds = (cue['end'] - cue['start']) / timeline['fps']
        # Project-specific reading target, not a claimed platform standard.
        cps = visible_characters / seconds
        assert cps <= quality['maxCaptionCharactersPerSecond'], (
            f'{variant}/{cue["id"]}: dense subtitle ({cps:.2f} chars/s)'
        )
        reading.append(
            {
                'id': cue['id'],
                'durationSeconds': round(seconds, 3),
                'charactersPerSecond': round(cps, 3),
            }
        )
        previous_end = cue['end']
    exact_groups = []
    # Measure delivery pace separately from caption layout. Passing a
    # characters-per-line check alone does not establish comfortable pacing.
    spoken_characters = sum(
        len(''.join(c for c in g['text'] if c.isalnum()))
        for g in (plan['groups'] if plan else [])
        if g['id'] in {edit['id'] for edit in track['groups']}
    )
    speech_seconds = sum(cue['speechEnd'] - cue['speechStart'] for cue in track['segments'])
    pace = {
        'spokenCharacters': spoken_characters,
        'overallCharactersPerMinute': round(
            spoken_characters / (track['durationInFrames'] / timeline['fps']) * 60, 2
        )
        if spoken_characters
        else None,
        'speechOnlyCharactersPerMinute': round(spoken_characters / speech_seconds * 60, 2)
        if spoken_characters
        else None,
    }
    if spoken_characters:
        # Project-configured pace thresholds include intentional paragraph holds.
        assert pace['speechOnlyCharactersPerMinute'] <= quality['maxCharactersPerMinute'], (
            f'{variant}: review delivery pace {pace}'
        )
        assert pace['overallCharactersPerMinute'] <= quality['maxCharactersPerMinute'], (
            f'{variant}: review overall pace {pace}'
        )
    for i, edit in enumerate(track['groups']):
        group = (
            next((group for group in plan['groups'] if group['id'] == edit['id']), None)
            if plan
            else None
        )
        if pcm is None or group is None or not Path(group['raw']).exists():
            if '--require-raw' in sys.argv:
                raise ValueError(f'Missing raw group: {edit["id"]}')
            continue
        raw = np.frombuffer(
            subprocess.check_output(
                [
                    'ffmpeg',
                    '-v',
                    'error',
                    '-i',
                    group['raw'],
                    '-ar',
                    str(rate),
                    '-ac',
                    '1',
                    '-f',
                    'f32le',
                    '-',
                ]
            ),
            dtype='<f4',
        )
        start = round(edit['trimStart'] * rate)
        end = round(edit['trimEnd'] * rate)
        margin = round(0.006 * rate)
        rendered = pcm[
            edit['startSample'] + margin : edit['startSample'] + edit['samples'] - margin
        ]
        reference = raw[start + margin : end - margin]
        # Float intermediate: all internal breaths/phonemes are preserved.
        assert len(rendered) == len(reference)
        error = float(np.max(np.abs(rendered - reference)))
        assert error < 2 / 2**23, (
            f'{variant}/{edit["id"]}: source error {error}, raw peak {float(np.max(np.abs(reference)))}'
        )
        if i + 1 < len(track['groups']):
            next_start = track['groups'][i + 1]['startSample']
            assert next_start - edit['startSample'] - edit['samples'] == edit['gapAfterSamples']
            assert edit['gapAfterSamples'] == round(group['gap'] * rate)
            assert 0 <= edit['gapAfterSamples'] <= round(quality['maxParagraphGapSeconds'] * rate)
            if edit['gapAfterSamples'] > round(0.26 * rate):
                assert edit.get('holdReason'), 'Long holds need an explicit editorial reason'
        exact_groups.append(edit['id'])
    bridges = []
    if pcm is not None:
        for before, after in zip(track['segments'], track['segments'][1:]):
            if before['group'] != after['group']:
                continue
            around = pcm[
                round((before['speechEnd'] - 0.15) * rate) : round(
                    (after['speechStart'] + 0.15) * rate
                )
            ]
            bridges.append(
                {
                    'from': before['id'],
                    'to': after['id'],
                    'time': before['speechEnd'],
                    'longestQuietSeconds': longest_quiet(around),
                    'insertedSilenceSeconds': 0,
                }
            )
        assert len(bridges) == len(track['segments']) - len(track['groups'])
    report['checks'][variant] = {
        'durationSeconds': track['durationInFrames'] / timeline['fps'],
        'independentCaptions': len(track['segments']),
        'exactSourcePreservedGroups': exact_groups,
        'subtitleBridges': bridges,
        'editorialHolds': [
            {
                'after': edit['id'],
                'seconds': edit['gapAfterSamples'] / rate,
                'reason': edit.get('holdReason', ''),
            }
            for edit in track['groups']
            if edit['gapAfterSamples']
        ],
        'rawSourceComparison': 'passed'
        if len(exact_groups) == len(track['groups'])
        else 'not-run: raw cache unavailable',
        'audioFileSwitches': 0,
        'pacing': pace,
        'subtitleReading': {
            'maxWidthPerLine': max(
                caption_width(line)
                for cue in track['segments']
                for line in cue['caption'].split('\n')
            ),
            'fastestCue': max(reading, key=lambda cue: cue['charactersPerSecond']),
            'withinProjectTarget': True,
        },
        'loudnessLUFS': mastering[variant]['verified']['input_i'],
        'truePeakDBTP': mastering[variant]['verified']['input_tp'],
        'singleMaster': True,
        'sampleLengthMatchesVideo': True,
        'nonOverlappingCaptions': True,
    }
print(json.dumps(report, ensure_ascii=False, indent=2))
for variant, checks in report['checks'].items():
    assert all(
        bridge['longestQuietSeconds'] < quality['maxInternalSilenceSeconds']
        for bridge in checks['subtitleBridges']
    ), f'{variant}: review an excessive within-paragraph pause'
(ROOT / 'audio-quality.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
