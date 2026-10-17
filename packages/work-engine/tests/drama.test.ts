import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceSettings } from '../src/audio/content';
import { dramaRequest } from '../src/audio/drama';
import { voiceover } from '../src/audio/standard';
import { atomicJSON, json } from '../src/lib/files';
import type { Project } from '../src/project';

const root = mkdtempSync(join(tmpdir(), 'bcr-drama-test-'));
const calls = join(root, 'calls.log');
const oldProfile = process.env.DRAMA_RS_PROFILE;
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

beforeAll(() => {
  const runtime = join(root, 'drama');
  writeFileSync(join(root, 'reply.wav'), wav);
  // A synthetic server with the drama-rs HTTP contract; it never loads a model.
  writeFileSync(
    runtime,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from 'node:fs';
const [host, port] = process.argv[process.argv.indexOf('--addr') + 1].split(':');
const log = (entry) => appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + '\\n');
log({ started: process.argv.slice(2) });
Bun.serve({ hostname: host, port: Number(port), async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health' || request.method === 'GET') return Response.json([]);
  if (url.pathname === '/v1/voices') {
    log({ voice: url.searchParams.get('name'), text: url.searchParams.get('text'), bytes: (await request.arrayBuffer()).byteLength });
    return Response.json({});
  }
  log({ speak: await request.json() });
  return new Response(readFileSync(${JSON.stringify(join(root, 'reply.wav'))}));
} });
`,
  );
  chmodSync(runtime, 0o755);
  mkdirSync(join(root, 'model'));
  writeFileSync(join(root, 'model/weights'), 'synthetic');
  process.env.DRAMA_RS_PROFILE = join(root, 'profile.json');
  atomicJSON(process.env.DRAMA_RS_PROFILE, { runtime, model: join(root, 'model') });
});

afterAll(() => {
  if (oldProfile === undefined) {
    delete process.env.DRAMA_RS_PROFILE;
  } else {
    process.env.DRAMA_RS_PROFILE = oldProfile;
  }
  rmSync(root, { recursive: true, force: true });
});

function fixture(id: string) {
  const workRoot = join(root, id);
  mkdirSync(join(workRoot, 'media/voice'), { recursive: true });
  writeFileSync(join(workRoot, 'media/voice/reference.wav'), wav);
  atomicJSON(join(workRoot, 'content.json'), {
    title: '合成服务测试',
    subtitle: '',
    paragraphs: [
      {
        id: 'question',
        gapAfter: 0.9,
        holdReason: '转入下一个意思',
        lines: [
          { id: 'question-line', text: '平均三天到货。', caption: '平均三天到货。', chapter: 'a' },
        ],
      },
      {
        id: 'answer',
        gapAfter: 0,
        lines: [
          { id: 'answer-line', text: '看一整片面积。', caption: '看一整片面积。', chapter: 'a' },
        ],
      },
    ],
  });
  const voice: VoiceSettings = {
    backend: 'drama-rs',
    model: 'Drama-3-Q4',
    referenceFile: 'media/voice/reference.wav',
    referenceTranscript: '参考文本。',
    language: 'Chinese',
    generation: {
      styleTag: '[conversational]',
      options: { seed: 42, max_new: 2560 },
      paragraphs: { answer: { text: '看<emphasis>一整片面积</emphasis>。' } },
    },
    mastering: { loudnessLUFS: -16, truePeakDBTP: -1.5 },
    quality: {
      maxCaptionWidth: 24,
      maxCaptionCharactersPerSecond: 12,
      maxParagraphGapSeconds: 1.2,
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
      privateAssets: ['media/voice/reference.wav'],
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

const logged = () =>
  readFileSync(calls, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

test('drama-rs generates each paragraph whole from one registered reference and reuses the cache', async () => {
  const { project } = fixture('drama-generate');
  await voiceover(project);
  const entries = logged();
  expect(entries.filter((entry) => entry.started)).toHaveLength(1);
  expect(entries.filter((entry) => entry.voice)).toEqual([
    { voice: 'reference', text: '参考文本。', bytes: wav.length },
  ]);
  const speaks = entries.flatMap((entry) => (entry.speak ? [entry.speak] : []));
  expect(speaks).toEqual([
    {
      seed: 42,
      max_new: 2560,
      text: '[conversational] 平均三天到货。',
      voice: 'reference',
      split: false,
    },
    {
      seed: 42,
      max_new: 2560,
      text: '[conversational] 看<emphasis>一整片面积</emphasis>。',
      voice: 'reference',
      split: false,
    },
  ]);
  const plan = json<{ settings: Record<string, unknown>; groups: { generation: string }[] }>(
    join(project.root, '.bcr/narration/plan.json'),
  );
  expect(plan.settings.backend).toBe('drama-rs');
  expect(JSON.stringify(plan.settings)).not.toContain(root);
  expect(json<{ backend: string }>(plan.groups[0]!.generation).backend).toBe('drama-rs');
  await voiceover(project);
  expect(logged()).toHaveLength(entries.length);
});

test('drama-rs direction tags cannot change the spoken words', () => {
  const { voice } = fixture('drama-direction');
  voice.generation!.paragraphs = { answer: { text: '看一部分面积。' } };
  expect(() => dramaRequest(voice, 'answer', '看一整片面积。')).toThrow('改变了口播文字');
  expect(dramaRequest(voice, 'question', '平均三天到货。').text).toBe(
    '[conversational] 平均三天到货。',
  );
});
