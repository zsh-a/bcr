import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { nativeAlignment } from '../src/audio/align';
import type { NativeRequest } from '../src/audio/audiocpp';
import type { VoiceSettings } from '../src/audio/content';
import { generateNarration, voiceover } from '../src/audio/standard';
import { atomicJSON, hashFile, json } from '../src/lib/files';
import type { Project } from '../src/project';

const root = mkdtempSync(join(tmpdir(), 'bcr-native-audio-test-'));
const profile = join(root, 'profile.json');
const oldProfile = process.env.AUDIO_CPP_PROFILE;
const calls: { model: string; request: NativeRequest }[] = [];
let invalidAlignment = false;
const wav = Buffer.alloc(44 + 16000 * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 16000; sample++) {
  wav.writeInt16LE(Math.round(Math.sin(sample * 0.1) * 2000), 44 + sample * 2);
}
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/tasks/run');
    const body = (await request.json()) as { model: string; request: NativeRequest };
    calls.push(body);
    if (body.model === 'aligner') {
      return Response.json({
        words: [
          {
            word: invalidAlignment
              ? '错误'
              : body.request.text.includes('二零一三')
                ? '二零一三年'
                : body.request.text === '采样边界'
                  ? '采样边界'
                  : '一起合作',
            start_sample: 1600,
            end_sample: body.request.text === '采样边界' ? 16001 : 14400,
          },
        ],
      });
    }
    return Response.json({ audio: wav.toString('base64'), sample_rate: 16000, channels: 1 });
  },
});

function writeProfile(alignRevision = 'align-v1') {
  atomicJSON(profile, {
    endpoint: server.url.toString(),
    runtimeRevision: 'native-test-v1',
    configurationRevision: 'config-v1',
    alignmentModel: 'aligner',
    models: { narrator: { revision: 'tts-v1' }, aligner: { revision: alignRevision } },
  });
}

function fixture(id: string) {
  const workRoot = join(root, id);
  mkdirSync(join(workRoot, 'public/audio'), { recursive: true });
  mkdirSync(join(workRoot, '.bcr/narration'), { recursive: true });
  writeFileSync(join(workRoot, 'public/audio/reference.wav'), wav);
  writeFileSync(join(workRoot, '.bcr/emotion.wav'), wav);
  atomicJSON(join(workRoot, 'content.json'), {
    title: '合成波形接口测试',
    subtitle: '',
    paragraphs: [
      {
        id: 'cooperate',
        gapAfter: 0,
        lines: [
          { id: 'cooperate-line', text: '一起合作。', caption: '一起合作。', chapter: 'fixture' },
        ],
      },
    ],
  });
  const voice: VoiceSettings = {
    backend: 'audio.cpp',
    model: 'narrator',
    endpoint: server.url.toString(),
    referenceTranscript: '一起合作。',
    language: 'Chinese',
    generation: {
      emotionReference: '.bcr/emotion.wav',
      options: { emotion_alpha: 0.35, seed: 42 },
    },
    mastering: { loudnessLUFS: -16, truePeakDBTP: -1.5 },
    quality: {
      maxCaptionWidth: 24,
      maxCaptionCharactersPerSecond: 12,
      maxParagraphGapSeconds: 1,
      maxInternalSilenceSeconds: 1,
      maxCharactersPerMinute: 320,
    },
  };
  atomicJSON(join(workRoot, 'voice.json'), voice);
  const project: Project = {
    root: workRoot,
    id,
    role: 'test',
    work: { id, targets: [{ id: 'main', runtime: 'remotion', entry: 'src/Main.tsx', fps: 30 }] },
    config: {
      version: 1,
      targets: { main: {} },
      privateAssets: ['audio/reference.wav'],
      audio: {
        driver: 'standard',
        content: 'content.json',
        voice: 'voice.json',
        plan: '.bcr/narration/plan.json',
        timeline: 'audio-timeline.json',
        mastering: 'audio-mastering.json',
        quality: 'audio-quality.json',
        score: 'public/audio/score.flac',
      },
    },
  };
  return { project, voice };
}

beforeAll(() => {
  process.env.AUDIO_CPP_PROFILE = profile;
  writeProfile();
});

test('configured media plans use portable relative asset references', async () => {
  const { project } = fixture('portable-media');
  project.config.audio!.directory = 'media/generated';
  project.config.audio!.plan = 'media/generated/plan.json';
  await voiceover(project);
  const plan = json<{ groups: { raw: string; generation: string }[] }>(
    join(project.root, project.config.audio!.plan),
  );
  expect(isAbsolute(plan.groups[0].raw)).toBe(false);
  expect(isAbsolute(plan.groups[0].generation)).toBe(false);
  expect(existsSync(join(project.root, plan.groups[0].raw))).toBe(true);
  await nativeAlignment(project);
  expect(
    existsSync(join(project.root, plan.groups[0].raw.replace('.wav', '.alignment.json'))),
  ).toBe(true);
});

test('recorded narration changes tempo without another TTS call and rejects altered source audio', async () => {
  const { project } = fixture('recorded-tempo');
  const voicePath = join(project.root, 'voice.json');
  const voice = json<VoiceSettings>(voicePath);
  const original = join(project.root, '.bcr/original.wav');
  writeFileSync(original, wav);
  const sourceSha256 = hashFile(original);
  const sourcePlan = join(project.root, '.bcr/source-plan.json');
  atomicJSON(sourcePlan, {
    settings: {
      model: voice.model,
      referenceHash: hashFile(join(project.root, 'public/audio/reference.wav')),
    },
    groups: [
      { id: 'cooperate', text: '一起合作。', hash: 'original', raw: original, sourceSha256 },
    ],
  });
  voice.generation = {
    recordedSource: { plan: '.bcr/source-plan.json', sha256: hashFile(sourcePlan), tempo: 1.05 },
  };
  atomicJSON(voicePath, voice);
  const count = calls.length;
  await voiceover(project);
  await voiceover(project);
  expect(calls.length).toBe(count);
  expect(hashFile(original)).toBe(sourceSha256);
  const plan = json<{ groups: { raw: string; generation: string }[] }>(
    join(project.root, '.bcr/narration/plan.json'),
  );
  const record = json<{
    backend: string;
    durationSeconds: number;
    generation: { derivation: { sourceSha256: string; tempo: number } };
  }>(plan.groups[0]!.generation);
  expect(record.backend).toBe('recording-derivative');
  expect(record.durationSeconds).toBeGreaterThan(0.85);
  expect(record.durationSeconds).toBeLessThan(1);
  expect(record.generation.derivation).toMatchObject({ sourceSha256, tempo: 1.05 });
  writeFileSync(original, 'changed source');
  await expect(voiceover(project)).rejects.toThrow('原始录音身份发生变化');
});

test('multi-track programs preserve original recordings and generate only changed paragraphs', async () => {
  const { project, voice } = fixture('multi-track-recording');
  project.config.audio!.driver = 'scripted';
  project.config.audio!.directory = '.bcr/narration';
  const original = join(project.root, '.bcr/narration/original.wav');
  writeFileSync(original, wav);
  const originalHash = hashFile(original);
  const sourcePlan = join(project.root, '.bcr/source-plan.json');
  atomicJSON(sourcePlan, {
    settings: {
      model: voice.model,
      referenceHash: hashFile(join(project.root, 'public/audio/reference.wav')),
    },
    groups: [
      {
        id: 'cooperate',
        text: '一起合作。',
        hash: 'original',
        raw: '.bcr/narration/original.wav',
        sourceSha256: originalHash,
      },
    ],
  });
  voice.generation = {
    recordedSource: {
      plan: '.bcr/source-plan.json',
      sha256: hashFile(sourcePlan),
      tempo: 1,
      onTextChange: 'generate',
    },
  };
  atomicJSON(join(project.root, 'voice.json'), voice);
  const program = {
    fps: 30,
    groups: [{ id: 'cooperate', lines: [{ text: '一起合作。' }], gap: 0.6, holdReason: '留白' }],
    programs: { main: ['cooperate'], highlight: ['cooperate'] },
  };
  const count = calls.length;
  await generateNarration(project, program);
  const plan = json<{
    groups: { raw: string; hash: string; holdReason: string }[];
    programs: Record<string, string[]>;
  }>(join(project.root, project.config.audio!.plan));
  expect(calls.length).toBe(count);
  expect(plan.groups[0]).toMatchObject({
    raw: '.bcr/narration/original.wav',
    hash: 'original',
    holdReason: '留白',
  });
  expect(plan.programs).toEqual(program.programs);
  expect(hashFile(original)).toBe(originalHash);
  program.groups[0]!.lines[0]!.text = '一起合作吧。';
  await generateNarration(project, program);
  expect(calls.length).toBe(count + 1);
  expect(calls.at(-1)!.request.text).toBe('一起合作吧。');
  expect(hashFile(original)).toBe(originalHash);
});

test('native alignment retains the Chinese year numeral spelling without dropping zero', async () => {
  const { project } = fixture('year-alignment');
  const contentPath = join(project.root, 'content.json');
  const content = json<{ paragraphs: { lines: { text: string; caption: string }[] }[] }>(
    contentPath,
  );
  content.paragraphs[0]!.lines[0]!.text = '二〇一三年。';
  content.paragraphs[0]!.lines[0]!.caption = '二〇一三年。';
  atomicJSON(contentPath, content);
  await voiceover(project);
  await nativeAlignment(project);
  expect(calls.at(-1)?.request.text).toBe('二零一三年。');
  const plan = json<{ groups: { raw: string }[] }>(join(project.root, '.bcr/narration/plan.json'));
  const alignment = json<{ text: string; words: { text: string }[] }>(
    plan.groups[0]!.raw.replace('.wav', '.alignment.json'),
  );
  expect(alignment.text).toBe('二〇一三年。');
  expect(alignment.words.map((word) => word.text).join('')).toBe('二〇一三年');
});

test('alignment resampling cannot extend the last cue beyond the original WAV sample clock', async () => {
  const { project } = fixture('sample-clock');
  const edge = Buffer.alloc(44 + 48001 * 2);
  wav.copy(edge, 0, 0, 44);
  edge.writeUInt32LE(edge.length - 8, 4);
  edge.writeUInt32LE(48000, 24);
  edge.writeUInt32LE(96000, 28);
  edge.writeUInt32LE(edge.length - 44, 40);
  const path = join(project.root, '.bcr/narration/edge.wav');
  writeFileSync(path, edge);
  atomicJSON(join(project.root, '.bcr/narration/plan.json'), {
    groups: [{ id: 'edge', hash: 'edge', raw: path, text: '采样边界' }],
  });
  await nativeAlignment(project);
  const result = json<{ words: { end: number }[] }>(path.replace('.wav', '.alignment.json'));
  expect(result.words[0]!.end).toBe(48001 / 48000);
});
afterAll(() => {
  server.stop(true);
  if (oldProfile === undefined) {
    delete process.env.AUDIO_CPP_PROFILE;
  } else {
    process.env.AUDIO_CPP_PROFILE = oldProfile;
  }
  rmSync(root, { recursive: true, force: true });
});

test('native TTS preserves the full paragraph and emotion controls; changed references invalidate cache', async () => {
  const { project } = fixture('native-cache');
  const initial = calls.length;
  await voiceover(project);
  await voiceover(project);
  expect(calls.length - initial).toBe(1);
  expect(calls.at(-1)?.request).toMatchObject({
    text: '一起合作。',
    language: 'Chinese',
    audio: join(project.root, '.bcr/emotion.wav'),
    options: { emotion_alpha: 0.35, seed: 42 },
  });
  const previous = json<{ groups: { raw: string; hash: string }[] }>(
    join(project.root, '.bcr/narration/plan.json'),
  );
  const emotion = join(project.root, '.bcr/emotion.wav');
  const changed = Buffer.from(wav);
  changed.writeInt16LE(1234, 100);
  writeFileSync(emotion, changed);
  await voiceover(project);
  const next = json<typeof previous>(join(project.root, '.bcr/narration/plan.json'));
  expect(next.groups[0]!.hash).not.toBe(previous.groups[0]!.hash);
  expect(existsSync(previous.groups[0]!.raw)).toBe(true);
  const generation = json<{ rawSha256: string }>(
    next.groups[0]!.raw.replace('.wav', '.generation.json'),
  );
  expect(generation.rawSha256).toBe(hashFile(next.groups[0]!.raw));
  writeFileSync(next.groups[0]!.raw, 'corrupted');
  await expect(voiceover(project)).rejects.toThrow('缓存录音发生变化');
});

test('native alignment converts sample timestamps, rejects incomplete text, and retains earlier alignment versions', async () => {
  const { project } = fixture('native-align');
  await voiceover(project);
  const plan = json<{ groups: { hash: string }[] }>(join(project.root, '.bcr/narration/plan.json'));
  const destination = join(
    project.root,
    '.bcr/narration',
    `${plan.groups[0]!.hash}.alignment.json`,
  );
  invalidAlignment = true;
  await expect(nativeAlignment(project)).rejects.toThrow('对齐文本不完整');
  expect(existsSync(destination)).toBe(false);
  invalidAlignment = false;
  await nativeAlignment(project);
  const first = readFileSync(destination, 'utf8');
  expect(JSON.parse(first).words).toEqual([{ text: '一起合作', start: 0.1, end: 0.9 }]);
  const count = calls.length;
  await nativeAlignment(project);
  expect(calls.length).toBe(count);
  writeProfile('align-v2');
  await nativeAlignment(project);
  const history = join(project.root, '.bcr/narration/alignment-history');
  expect(readdirSync(history).length).toBe(1);
  expect(readFileSync(join(history, readdirSync(history)[0]!), 'utf8')).toBe(first);
  writeProfile();
});
