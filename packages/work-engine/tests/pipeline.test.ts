import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, contentHash } from '../src/audio/content';
import { atomicJSON, fileMap, json, verifyExactMap } from '../src/lib/files';
import { assertWritableOutput } from '../src/lib/output';
import { workspaceStorageId } from '../src/lib/paths';
import { prepareRuntime, readRuntime, runtimeStatus } from '../src/pipeline/runtime';
import { freeze, validate, validationStatus } from '../src/pipeline/validation';
import type { Project, Target } from '../src/project';
import { sourceSnapshot } from '../src/state/snapshots';
import { startPreview } from '../src/video/preview';
import { planScenes } from '../src/video/scenes/plan';

const root = mkdtempSync(join(tmpdir(), 'bcr-pipeline-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(name: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'public/audio'), { recursive: true });
  writeFileSync(
    join(dir, 'src/Main.tsx'),
    'import A from "./A";import B from "./B";export default()=>null;',
  );
  writeFileSync(join(dir, 'src/A.tsx'), 'export default 1;');
  writeFileSync(join(dir, 'src/B.tsx'), 'export default 2;');
  writeFileSync(join(dir, 'public/audio/mix.flac'), 'audio');
  const t: Target = {
    id: 'main',
    runtime: 'remotion',
    entry: 'src/Main.tsx',
    width: 64,
    height: 64,
    fps: 30,
    durationInFrames: 90,
  };
  const p: Project = {
    id: name,
    root: dir,
    role: 'active',
    work: { id: name, targets: [t] },
    config: { version: 1, privateAssets: [], targets: { main: { audio: 'audio/mix.flac' } } },
  };
  return { p, t, dir };
}

function runtimeFixture(name: string) {
  const value = fixture(name);
  const { p, dir } = value;
  p.config.audio = {
    driver: 'standard',
    content: 'content.json',
    voice: 'voice.json',
    directory: 'media/narration',
    timeline: 'timeline.json',
    plan: 'media/narration/plan.json',
    mastering: 'master.json',
    quality: 'quality.json',
    score: 'public/audio/score.flac',
  };
  p.config.runtime = {
    cues: 'cues.json',
    timing: '.bcr/build/runtime/timing.json',
    events: '.bcr/build/runtime/events.json',
  };
  const content: Content = {
    title: name,
    subtitle: '',
    paragraphs: [
      {
        id: 'opening',
        gapAfter: 0,
        lines: [{ id: 'line', chapter: 'a', text: '这里是解释。', caption: '这里是解释。' }],
      },
    ],
  };
  atomicJSON(join(dir, 'content.json'), content);
  atomicJSON(join(dir, 'timeline.json'), {
    contentHash: contentHash(content),
    draft: false,
    fps: 30,
    sampleRate: 48000,
    main: {
      durationInFrames: 90,
      audioFile: 'audio/mix.flac',
      segments: [
        { id: 'line', chapter: 'a', group: 'opening', caption: '这里是解释。', start: 0, end: 90 },
      ],
      groups: [{ id: 'opening', startSample: 0, trimStart: 0, rawSha256: 'audio-identity' }],
    },
  });
  atomicJSON(join(dir, 'cues.json'), {
    version: 1,
    cues: [{ id: 'meaning', group: 'opening', phrase: '解释' }],
  });
  atomicJSON(join(dir, 'media/narration/plan.json'), {
    groups: [{ id: 'opening', raw: 'media/narration/raw.wav' }],
  });
  atomicJSON(join(dir, 'media/narration/raw.alignment.json'), {
    audioSha256: 'audio-identity',
    words: [
      { text: '这里是', start: 0, end: 0.4 },
      { text: '解释', start: 0.5, end: 1 },
    ],
  });
  return value;
}

test('runtime derives actual alignment, reuses intact outputs and detects stale inputs or outputs', () => {
  const { p, dir } = runtimeFixture('runtime');
  expect(runtimeStatus(p).fresh).toBe(false);
  expect(prepareRuntime(p).cached).toBe(false);
  expect(readRuntime(p).frames.meaning).toBe(15);
  expect(prepareRuntime(p).cached).toBe(true);
  writeFileSync(join(dir, p.config.runtime!.events), '{}');
  expect(runtimeStatus(p).fresh).toBe(false);
  prepareRuntime(p);
  expect(runtimeStatus(p).fresh).toBe(true);
  const source = json<Content>(join(dir, 'content.json'));
  source.paragraphs[0].lines[0].text = '修改之后。';
  atomicJSON(join(dir, 'content.json'), source);
  expect(() => prepareRuntime(p)).toThrow('先执行 audio');
});

test('failed cue compilation preserves the previously accepted runtime', () => {
  const { p, dir } = runtimeFixture('failed-runtime');
  prepareRuntime(p);
  const old = readFileSync(join(dir, p.config.runtime!.events));
  atomicJSON(join(dir, 'cues.json'), {
    version: 1,
    cues: [{ id: 'missing', group: 'opening', phrase: '没有这个短语' }],
  });
  expect(() => prepareRuntime(p)).toThrow('短语');
  expect(readFileSync(join(dir, p.config.runtime!.events))).toEqual(old);
});

test('scene dependencies preserve unrelated scenes and audio changes, but include outgoing handoffs', () => {
  const { p, t, dir } = fixture('scene-deps');
  p.config.runtime = { cues: 'unused', timing: 'timing.json', events: 'events.json' };
  p.config.scenes = { catalog: 'scenes.json' };
  atomicJSON(join(dir, 'scenes.json'), {
    version: 1,
    transitionFrames: 18,
    dissolvingGroups: [],
    scenes: [
      { id: 'a', entry: 'src/A.tsx', cues: ['dynamic-anchor'] },
      { id: 'b', entry: 'src/B.tsx', cues: [] },
    ],
  });
  const runtime = {
    draft: false,
    fps: 30,
    frames: { 'dynamic-anchor': 15 },
    main: {
      durationInFrames: 90,
      audioFile: 'audio/mix.flac',
      segments: [
        { id: 'a-line', chapter: 'a', group: 'a', caption: 'A', start: 0, end: 40 },
        { id: 'b-line', chapter: 'b', group: 'b', caption: 'B', start: 40, end: 90 },
      ],
    },
  };
  const before = planScenes(p, t, {}, runtime);
  expect(before[0].input.frames['dynamic-anchor']).toBe(15);
  writeFileSync(join(dir, 'src/B.tsx'), 'export default 3;');
  const changed = planScenes(p, t, {}, runtime);
  expect(changed[0].key).toBe(before[0].key);
  expect(changed[1].key).not.toBe(before[1].key);
  writeFileSync(join(dir, 'src/A.tsx'), 'export default 4;');
  expect(planScenes(p, t, {}, runtime)[1].key).not.toBe(changed[1].key);
  const prior = planScenes(p, t, {}, runtime).map((scene) => scene.key);
  writeFileSync(join(dir, 'public/audio/mix.flac'), 'master volume changed');
  expect(planScenes(p, t, {}, runtime).map((scene) => scene.key)).toEqual(prior);
});

test('source snapshots retain original bytes after mutable Work edits', () => {
  const { p, t, dir } = fixture('frozen-source');
  const snapshot = sourceSnapshot(p, t);
  writeFileSync(join(dir, 'src/A.tsx'), 'export default 999;');
  expect(readFileSync(join(snapshot.project.root, 'src/A.tsx'), 'utf8')).toBe('export default 1;');
});

test('validation is bound to the served snapshot and freeze rejects older passed reports', async () => {
  const { p, t, dir } = fixture('qa-boundary');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(
    join(dir, 'scripts/qa.ts'),
    `const served=await(await fetch(new URL('/__bcr/identity',process.env.BCR_QA_URL))).json();if(served.input.key!==JSON.parse(process.env.BCR_QA_INPUT).key)throw Error('wrong snapshot');await Bun.write(process.env.BCR_QA_OUTPUT+'/result.json',JSON.stringify({passed:true}));`,
  );
  p.config.validation = {
    checks: [{ id: 'browser', command: [process.execPath, 'scripts/qa.ts'] }],
  };
  expect(validationStatus(p, t).fresh).toBe(false);
  await validate(p, t);
  expect(validationStatus(p, t).fresh).toBe(true);
  expect(freeze(p, t).validationKey).toBeDefined();
  writeFileSync(join(dir, 'src/A.tsx'), 'export default 999;');
  expect(validationStatus(p, t).fresh).toBe(false);
  expect(() => freeze(p, t)).toThrow('过期');
});

test('release boundaries reject writes through aliases and detect unmanifested files', () => {
  const dir = join(root, 'release-boundary');
  const releases = join(dir, '.releases');
  const files = join(releases, 'project/version/files');
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, 'accepted.txt'), 'accepted');
  symlinkSync(files, join(dir, 'out'));
  expect(() => assertWritableOutput(join(dir, 'out/new.txt'), releases)).toThrow('不可写');
  const expected = fileMap(files, [join(files, 'accepted.txt')]);
  expect(verifyExactMap(files, expected)).toBe(true);
  writeFileSync(join(files, 'extra.txt'), 'unregistered');
  expect(verifyExactMap(files, expected)).toBe(false);
});

test('stable workspace storage identity survives a directory move', () => {
  const first = join(root, 'workspace-first');
  const moved = join(root, 'workspace-moved');
  for (const path of [first, moved]) {
    atomicJSON(join(path, 'workspace.json'), { version: 1, storageId: 'stable-workspace-01' });
  }
  expect(workspaceStorageId(first)).toBe(workspaceStorageId(moved));
});

test('snapshot preview resolves import-only ESM packages without special CLI conditions', async () => {
  const { p, t, dir } = fixture('esm-preview');
  mkdirSync(join(dir, 'vendor'));
  const archive = join(dir, 'vendor/esm.tgz');
  await Bun.write(
    archive,
    new Bun.Archive({
      'package/package.json': JSON.stringify({
        name: '@fixture/esm',
        version: '1.0.0',
        type: 'module',
        exports: { '.': { import: './index.js' } },
      }),
      'package/index.js': 'export const answer=42;',
    }),
  );
  writeFileSync(archive, Bun.gzipSync(readFileSync(archive)));
  atomicJSON(join(dir, 'package.json'), {
    name: 'esm-preview',
    private: true,
    dependencies: { '@fixture/esm': 'file:vendor/esm.tgz' },
  });
  const install = Bun.spawn([process.execPath, 'install', '--ignore-scripts'], {
    cwd: dir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (await install.exited) {
    throw new Error(await new Response(install.stderr).text());
  }
  writeFileSync(
    join(dir, 'src/Main.tsx'),
    'import {answer} from "@fixture/esm";export default()=>String(answer);',
  );
  const preview = await startPreview(p, t);
  try {
    const page = await fetch(preview.url);
    expect(page.status).toBe(200);
    const identity = (await (await fetch(new URL('/__bcr/identity', preview.url))).json()) as {
      input: { key: string };
    };
    expect(identity.input.key).toBe(preview.input.key);
  } finally {
    preview.stop();
  }
});
