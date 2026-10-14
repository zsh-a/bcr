import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hashFile, inside, json } from '../lib/files';
import type { VoiceSettings } from './content';
import { recordedSource } from './recorded';

type RequestOptions = Record<string, string | number | boolean | number[]>;
interface NativeProfile {
  endpoint: string;
  runtimeRevision: string;
  configurationRevision: string;
  models: Record<string, { revision: string }>;
  alignmentModel: string;
}
interface NativeWord {
  word: string;
  start_sample: number;
  end_sample: number;
}
export interface NativeResult {
  audio?: string;
  sample_rate?: number;
  channels?: number;
  words?: NativeWord[];
  timing?: { wall_ms?: number };
}
export interface NativeRequest {
  text: string;
  language?: string;
  voice_ref?: string;
  reference_text?: string;
  audio?: string;
  audio_base64?: string;
  options: RequestOptions;
}

export function audioCppSettings(voice: VoiceSettings, alignment = false) {
  const profilePath =
    process.env.AUDIO_CPP_PROFILE ?? join(homedir(), '.config/bcr/audio-cpp.json');
  const profile = existsSync(profilePath) ? json<NativeProfile>(profilePath) : undefined;
  const model = alignment
    ? (voice.alignment?.model ?? profile?.alignmentModel ?? 'Qwen3-ForcedAligner-0.6B')
    : voice.model;
  const modelRevision =
    profile?.models[model]?.revision ??
    (alignment ? voice.alignment?.modelRevision : voice.modelRevision);
  const runtimeRevision = profile?.runtimeRevision ?? voice.runtimeRevision;
  if (!modelRevision || !runtimeRevision) {
    throw new Error(`请在 ${profilePath} 配置 audio.cpp 的运行版本和模型身份: ${model}`);
  }
  const endpoint = (
    process.env.AUDIO_CPP_ENDPOINT ??
    (voice.backend === 'audio.cpp' ? voice.endpoint : undefined) ??
    profile?.endpoint ??
    'http://127.0.0.1:8089'
  ).replace(/\/$/, '');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('audio.cpp endpoint 必须是 HTTP 服务地址');
  }
  return {
    backend: 'audio.cpp' as const,
    endpoint,
    model,
    modelRevision,
    runtimeRevision,
    configurationRevision: profile?.configurationRevision,
    options: alignment ? (voice.alignment?.options ?? {}) : (voice.generation?.options ?? {}),
  };
}

export function paragraphRequest(root: string, voice: VoiceSettings, id: string, text: string) {
  const override = voice.generation?.paragraphs?.[id];
  const emotion = override?.emotionReference ?? voice.generation?.emotionReference;
  const emotionPath = emotion ? inside(root, emotion) : undefined;
  return {
    request: {
      text: override?.text ?? text,
      language: voice.language,
      voice_ref: inside(root, voice.referenceFile ?? 'public/audio/reference.wav'),
      reference_text: voice.referenceTranscript,
      ...(emotionPath ? { audio: emotionPath } : {}),
      options: { ...voice.generation?.options, ...override?.options },
    } satisfies NativeRequest,
    emotionHash: emotionPath ? hashFile(emotionPath) : undefined,
  };
}

export async function runNativeTask(
  settings: ReturnType<typeof audioCppSettings>,
  request: NativeRequest,
): Promise<NativeResult> {
  const response = await fetch(`${settings.endpoint}/v1/tasks/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model, request }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`audio.cpp ${settings.model} 返回 ${response.status}: ${body.slice(0, 2000)}`);
  }
  return JSON.parse(body) as NativeResult;
}

export function nativeWav(result: NativeResult) {
  if (!result.audio || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.audio)) {
    throw new Error('audio.cpp 没有返回有效的 Base64 WAV');
  }
  const wav = Buffer.from(result.audio, 'base64');
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('audio.cpp 返回的音频不是 WAV');
  }
  return wav;
}

export function audioCppInputFiles(root: string, voice: VoiceSettings) {
  const files: string[] = [];
  const recorded = recordedSource(root, voice);
  if (recorded) {
    files.push(recorded.path, ...recorded.groups.map((group) => group.raw));
  }
  const references = [
    voice.generation?.emotionReference,
    ...Object.values(voice.generation?.paragraphs ?? {}).map((item) => item.emotionReference),
  ];
  for (const reference of references) {
    if (reference) {
      files.push(inside(root, reference));
    }
  }
  return files;
}

export function inlineWav(path: string) {
  return readFileSync(path).toString('base64');
}
