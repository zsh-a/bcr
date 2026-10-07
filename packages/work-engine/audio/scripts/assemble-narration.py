"""Sample-accurate assembly; only paragraph edges are trimmed/faded.

No time stretching, no internal silence removal, no audio cuts at subtitle cues.
Raw WAVs and forced alignments remain in .bcr/narration for reproducibility.
"""

import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(sys.argv[1]).resolve()
CACHE = ROOT / '.bcr/narration'
RATE = 48000
plan = json.loads((CACHE / 'plan.json').read_text())
FPS = plan['fps']
groups = {}


def clean(text):
    return ''.join(char for char in text if char.isalnum()).lower()


def save_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


for group in plan['groups']:
    alignment = json.loads((CACHE / f'{group["hash"]}.alignment.json').read_text())
    if hashlib.sha256(Path(group['raw']).read_bytes()).hexdigest() != alignment['audioSha256']:
        raise ValueError(f'Stale alignment: {group["id"]}')
    # Decode/resample once before sample-index calculations.
    decoded = subprocess.check_output(
        [
            'ffmpeg',
            '-v',
            'error',
            '-i',
            group['raw'],
            '-ar',
            str(RATE),
            '-ac',
            '1',
            '-f',
            'f32le',
            '-',
        ]
    )
    pcm = np.frombuffer(decoded, dtype='<f4').copy()
    # Retain quiet consonants and natural breath: trim outer blank only.
    hop = RATE // 200
    windows = pcm[: len(pcm) // hop * hop].reshape(-1, hop)
    active = np.flatnonzero(np.sqrt(np.mean(windows**2, axis=1)) > 10 ** (-48 / 20))
    if not len(active):
        raise ValueError(f'Silent TTS: {group["id"]}')
    words = alignment['words']
    start = max(0, min(int(active[0] * hop), round(words[0]['start'] * RATE)) - round(0.060 * RATE))
    end = min(
        len(pcm),
        max(int((active[-1] + 1) * hop), round(words[-1]['end'] * RATE)) + round(0.100 * RATE),
    )
    signal = pcm[start:end].copy()
    # 5 ms click protection affects only preserved outer margins, not speech.
    fade = round(0.005 * RATE)
    signal[:fade] *= np.linspace(0, 1, fade)
    signal[-fade:] *= np.linspace(1, 0, fade)
    characters = []
    for word in words:
        text = clean(word['text'])
        for i, char in enumerate(text):
            duration = word['end'] - word['start']
            characters.append(
                (
                    char,
                    word['start'] + duration * i / len(text),
                    word['start'] + duration * (i + 1) / len(text),
                )
            )
    expected = clean(group['text'])
    if ''.join(char[0] for char in characters) != expected:
        raise ValueError(f'Alignment text differs: {group["id"]}')
    cursor = 0
    cues = []
    for line in group['lines']:
        count = len(clean(line['text']))
        tokens = characters[cursor : cursor + count]
        # Validate on the sample clock; decimal subtraction can otherwise put
        # a legitimate last token 1e-15 s beyond the exact paragraph boundary.
        begin_sample = round(tokens[0][1] * RATE) - start
        finish_sample = round(tokens[-1][2] * RATE) - start
        if not 0 <= begin_sample < finish_sample <= len(signal):
            raise ValueError(f'Invalid cue bounds: {line["id"]}: {begin_sample}, {finish_sample}')
        begin, finish = begin_sample / RATE, finish_sample / RATE
        cues.append({**line, 'speechStart': begin, 'speechEnd': finish})
        cursor += count
    groups[group['id']] = {
        **group,
        'pcm': signal,
        'cues': cues,
        'trimStart': start / RATE,
        'trimEnd': end / RATE,
        'rawSha256': alignment['audioSha256'],
    }

timeline = {
    'version': 2,
    'fps': FPS,
    'sampleRate': RATE,
    'alignmentModel': alignment['model'],
    'settings': plan['settings'],
    'draft': False,
    'contentHash': plan['contentHash'],
}
for variant, ids in plan['programs'].items():
    chunks = [np.zeros(round(0.32 * RATE), dtype=np.float32)]
    cursor = len(chunks[0])
    segments, edits = [], []
    for index, group_id in enumerate(ids):
        group = groups[group_id]
        offset = cursor / RATE
        for cue in group['cues']:
            segments.append(
                {
                    'id': cue['id'],
                    'chapter': cue['chapter'],
                    'caption': cue['caption'],
                    'group': group_id,
                    'speechStart': round(offset + cue['speechStart'], 6),
                    'speechEnd': round(offset + cue['speechEnd'], 6),
                }
            )
        edits.append(
            {
                'id': group_id,
                'startSample': cursor,
                'samples': len(group['pcm']),
                'trimStart': group['trimStart'],
                'trimEnd': group['trimEnd'],
                'rawSha256': group['rawSha256'],
                'ttsHash': group['hash'],
                'gapAfterSamples': round(group['gap'] * RATE) if index < len(ids) - 1 else 0,
                'holdReason': group.get('holdReason', ''),
            }
        )
        chunks.append(group['pcm'])
        cursor += len(group['pcm'])
        if index < len(ids) - 1:
            silence = np.zeros(round(group['gap'] * RATE), dtype=np.float32)
            chunks.append(silence)
            cursor += len(silence)
    duration = math.ceil((cursor / RATE + 1.8) * FPS)
    total_samples = round(duration / FPS * RATE)
    chunks.append(np.zeros(total_samples - cursor, dtype=np.float32))
    for i, segment in enumerate(segments):
        segment['start'] = max(0, math.floor(segment['speechStart'] * FPS) - 1)
        segment['end'] = min(duration, math.ceil(segment['speechEnd'] * FPS) + 3)
        # Completed thoughts remain readable during an intentional editorial hold.
        # No speech is cut or stretched to achieve this.
        if i + 1 == len(segments) or segment['group'] != segments[i + 1]['group']:
            segment['end'] = min(duration, math.ceil((segment['speechEnd'] + 0.65) * FPS))
        if i + 1 < len(segments):
            segment['end'] = min(
                segment['end'], math.floor(segments[i + 1]['speechStart'] * FPS) - 1
            )
        segment['frames'] = segment['end'] - segment['start']
        if segment['frames'] <= 0:
            raise ValueError(f'Empty cue: {segment["id"]}')
    audio_file = f'narration-{variant}.wav'
    # Float intermediates preserve resampling overshoot; normalize before PCM16.
    # The narration stays in the cache: the render only needs the mastered mix,
    # and two ~80 MiB WAVs in public/ would exceed the source snapshot budget.
    sf.write(ROOT / '.bcr/narration' / audio_file, np.concatenate(chunks), RATE, subtype='FLOAT')
    timeline[variant] = {
        'durationInFrames': duration,
        'audioFile': f'audio/mix-{variant}.flac',
        'narrationFile': audio_file,
        'samples': total_samples,
        'groups': edits,
        'segments': segments,
    }
    (ROOT / f'subtitles-{variant}.srt').write_text(
        '\n'.join(
            f'{i + 1}\n{stamp(cue["start"] / FPS)} --> {stamp(cue["end"] / FPS)}\n{cue["caption"]}\n'
            for i, cue in enumerate(segments)
        )
    )
    print(
        f'{variant}: {duration / FPS:.3f}s; {len(ids)} semantic groups, {len(segments)} independent captions',
        flush=True,
    )
work = json.loads((ROOT / 'work.json').read_text())
for target in work['targets']:
    if target['id'] in plan['programs']:
        target['durationInFrames'] = timeline[target['id']]['durationInFrames']
save_json(ROOT / 'audio-timeline.json', timeline)
save_json(ROOT / 'work.json', work)
