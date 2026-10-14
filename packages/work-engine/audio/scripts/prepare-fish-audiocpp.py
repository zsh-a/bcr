"""Repack official Fish S2 Pro checkpoints for audio.cpp, without quantization."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def save(tensors, destination):
    temporary = destination.with_suffix('.tmp')
    save_file({name: value.contiguous() for name, value in tensors.items()}, str(temporary))
    temporary.replace(destination)
    return digest(destination)


def remap(name):
    if name.startswith('text_model.model.'):
        return name.removeprefix('text_model.model.')
    if name.startswith('audio_decoder.'):
        suffix = name.removeprefix('audio_decoder.')
        return suffix if suffix.startswith('codebook_embeddings.') else 'fast_' + suffix
    return name


def fuse_norm(tensors):
    result = {}
    for name, value in tensors.items():
        if name.endswith('.weight_g'):
            base = name.removesuffix('_g')
            result[base] = torch._weight_norm(tensors[base + '_v'], value, 0)
        elif name.endswith('.parametrizations.weight.original0'):
            base = name.removesuffix('.parametrizations.weight.original0')
            direction = tensors[base + '.parametrizations.weight.original1']
            result[base + '.weight'] = torch._weight_norm(direction, value, 0)
        elif name.endswith(('.weight_v', '.parametrizations.weight.original1')):
            continue
        else:
            result[name] = value
    return result


def split_projections(tensors, config=None):
    result = {}
    for name, value in tensors.items():
        if name.endswith('.attention.wqkv.weight'):
            if config is None:
                query = value.shape[1]
                key_value = (value.shape[0] - query) // 2
            else:
                block = (
                    config['audio_decoder_config']
                    if name.startswith('fast_')
                    else config['text_config']
                )
                query = block['n_head'] * block['head_dim']
                key_value = block['n_local_heads'] * block['head_dim']
            parts = torch.split(value, [query, key_value, key_value], dim=0)
            base = name.removesuffix('wqkv.weight')
            for label, part in zip(['q_proj', 'k_proj', 'v_proj'], parts, strict=True):
                result[base + label + '.weight'] = part.contiguous()
        else:
            result[name] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if output == source or source in output.parents:
        raise ValueError('Native output must be outside the source checkpoint')
    output.mkdir(parents=True, exist_ok=True)
    index = json.loads((source / 'model.safetensors.index.json').read_text())
    config = json.loads((source / 'config.json').read_text())
    manifest_path = output / 'conversion.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    prior_records = {item['source']: item for item in previous.get('shards', [])}
    records, weight_map = [], {}
    for shard in sorted(set(index['weight_map'].values())):
        destination = output / shard.replace('model-', 'model-audiocpp-')
        source_sha = digest(source / shard)
        prior = prior_records.get(shard)
        if prior and prior['source_sha256'] != source_sha:
            raise ValueError('Source checkpoint changed; use a separate native output directory')
        tensors = {remap(name): value for name, value in load_file(str(source / shard)).items()}
        tensors = split_projections(tensors, config)
        if not destination.exists() or previous.get('converterVersion') not in (2, 3):
            print(f'Repacking {shard}', flush=True)
            native_sha = save(tensors, destination)
        else:
            native_sha = digest(destination)
            if not prior or native_sha != prior['native_sha256']:
                raise ValueError(f'Native shard differs from its conversion record: {destination}')
        weight_map.update({name: destination.name for name in tensors})
        records.append(
            {
                'source': shard,
                'source_sha256': source_sha,
                'native': destination.name,
                'native_sha256': native_sha,
            }
        )
        del tensors
    (output / 'model_audio_cpp.safetensors.index.json').write_text(
        json.dumps({'metadata': index.get('metadata', {}), 'weight_map': weight_map}, indent=2)
        + '\n'
    )
    codec_path = output / 'codec.safetensors'
    if not codec_path.exists() or previous.get('converterVersion') != 3:
        print('Fusing codec weight normalization', flush=True)
        tensors = torch.load(source / 'codec.pth', map_location='cpu', weights_only=True)
        tensors = tensors.get('state_dict', tensors)
        if any('generator.' in name for name in tensors):
            tensors = {
                name.removeprefix('generator.'): value
                for name, value in tensors.items()
                if name.startswith('generator.')
            }
        tensors = split_projections(fuse_norm(tensors))
        for anchor in [
            'decoder.model.0.conv.weight',
            'quantizer.semantic_quantizer.quantizers.0.codebook.weight',
        ]:
            if anchor not in tensors:
                raise ValueError(f'Codec anchor missing: {anchor}')
        save(tensors, codec_path)
        del tensors
    for name in [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
        'special_tokens_map.json',
        'chat_template.jinja',
        'LICENSE.md',
    ]:
        shutil.copyfile(source / name, output / name)
    manifest = {
        'converterVersion': 3,
        'source': str(source),
        'precision': 'original BF16 AR and FP32 codec',
        'conversion': 'Official Fish key remapping, lossless Q/K/V split, dim=0 codec weight-normalization folding',
        'shards': records,
        'codec_sha256': digest(codec_path),
    }
    (output / 'conversion.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Native Fish package ready', flush=True)


if __name__ == '__main__':
    main()
