"""Local forced alignment; subtitle cues never control audio edits.

Run in the shared uv-locked workspace environment.
TTS and alignment caches are keyed by content, not mutable clip names.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import torch
from qwen_asr import Qwen3ForcedAligner

ROOT = Path(sys.argv[1]).resolve()
CACHE = ROOT / '.bcr/narration'
MODEL = 'Qwen/Qwen3-ForcedAligner-0.6B'
plan = json.loads((CACHE / 'plan.json').read_text())
model = None
for group in plan['groups']:
    raw = Path(group['raw'])
    sha = hashlib.sha256(raw.read_bytes()).hexdigest()
    destination = CACHE / f'{group["hash"]}.alignment.json'
    if destination.exists():
        previous = json.loads(destination.read_text())
        if (
            previous['audioSha256'] == sha
            and previous['model'] == MODEL
            and previous.get('text') == group['text']
        ):
            print(f'Reuse alignment: {group["id"]}', flush=True)
            continue
    if model is None:
        model = Qwen3ForcedAligner.from_pretrained(
            MODEL,
            dtype=torch.bfloat16,
            device_map=os.environ.get('ALIGN_DEVICE', 'cuda:0'),
            attn_implementation='sdpa',
        )
    result = model.align(
        audio=str(raw), text=group['text'], language=plan['settings'].get('language', 'Chinese')
    )[0]
    words = [
        {'text': item.text, 'start': float(item.start_time), 'end': float(item.end_time)}
        for item in result
    ]
    if not words or any(word['end'] < word['start'] for word in words):
        raise ValueError(f'Invalid alignment: {group["id"]}')
    payload = {'model': MODEL, 'audioSha256': sha, 'text': group['text'], 'words': words}
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Aligned {group["id"]}: {len(words)} tokens, {words[-1]["end"]:.3f}s', flush=True)
