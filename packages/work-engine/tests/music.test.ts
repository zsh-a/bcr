import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceSettings } from '../src/audio/content';
import { master, soundtrack } from '../src/audio/standard';
import { atomicJSON, json } from '../src/lib/files';
import type { Project } from '../src/project';

const root = mkdtempSync(join(tmpdir(), 'bcr-music-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function ffmpeg(args: string[]) {
  const result = Bun.spawnSync(['ffmpeg', '-v', 'error', '-nostdin', '-y', ...args]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
}

function fixture(id: string, music: boolean) {
  const workRoot = join(root, id);
  mkdirSync(join(workRoot, '.bcr/narration'), { recursive: true });
  mkdirSync(join(workRoot, 'public/audio'), { recursive: true });
  mkdirSync(join(workRoot, 'scripts'), { recursive: true });
  // Speech-like bursts with gaps, so ducking has speech to follow.
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=6:sample_rate=48000',
    '-af',
    "volume='if(lt(mod(t,2),1.2),0.3,0)':eval=frame",
    '-ac',
    '1',
    '-c:a',
    'pcm_f32le',
    join(workRoot, '.bcr/narration/narration-main.wav'),
  ]);
  writeFileSync(
    join(workRoot, 'scripts/score.ts'),
    `const samples = Number(process.env.BCR_SAMPLES);
const result = Bun.spawnSync(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
  'sine=frequency=440:sample_rate=48000', '-af', 'atrim=end_sample=' + samples + ',volume=0.2',
  '-ac', '2', '-c:a', 'flac', process.env.BCR_SCORE]);
if (result.exitCode !== 0) throw new Error(result.stderr.toString());
`,
  );
  atomicJSON(join(workRoot, 'timeline.json'), {
    fps: 30,
    sampleRate: 48000,
    main: {
      durationInFrames: 180,
      samples: 288000,
      audioFile: 'audio/mix-main.flac',
      narrationFile: 'narration-main.wav',
      segments: [
        { id: 'a', group: 'g', speechStart: 0, speechEnd: 1.2 },
        { id: 'b', group: 'g', speechStart: 2, speechEnd: 3.2 },
      ],
    },
  });
  const voice: Partial<VoiceSettings> = {
    mastering: { loudnessLUFS: -16, truePeakDBTP: -1.5 },
    ...(music
      ? {
          music: {
            script: 'scripts/score.ts',
            bedBelowVoiceLU: 18,
            duck: { threshold: 0.03, ratio: 2, attackMs: 30, releaseMs: 700 },
            minVoiceToMusicDb: 20,
          },
        }
      : {}),
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
      privateAssets: [],
      audio: {
        driver: 'standard',
        content: 'content.json',
        voice: 'voice.json',
        plan: '.bcr/narration/plan.json',
        timeline: 'timeline.json',
        mastering: 'mastering.json',
        quality: 'quality.json',
        score: 'public/audio/score.flac',
      },
    },
  };
  return project;
}

test('a configured score is rendered, set below the voice, ducked and mastered', async () => {
  const project = fixture('with-music', true);
  await soundtrack(project);
  await master(project);
  const record = json<{
    main: { verified: { input_i: string }; music: { bedGainDb: number; duckedStem: string } };
  }>(join(project.root, 'mastering.json')).main;
  expect(Math.abs(Number(record.verified.input_i) + 16)).toBeLessThan(0.3);
  expect(Number.isFinite(record.music.bedGainDb)).toBe(true);
  expect(record.music.duckedStem).toBe('.bcr/narration/music-ducked.wav');
  expect(Bun.file(join(project.root, record.music.duckedStem)).size).toBeGreaterThan(0);
});

test('without music the score stays a silent track and the master records it', async () => {
  const project = fixture('without-music', false);
  await soundtrack(project);
  await master(project);
  const record = json<{ main: { music: string } }>(join(project.root, 'mastering.json')).main;
  expect(record.music).toBe('disabled');
});
