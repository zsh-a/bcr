import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, contentHash } from '../src/audio/content';
import { parseCli } from '../src/cli/args';
import { workContext } from '../src/cli/context';
import { summarizeData } from '../src/cli/context-summary';
import { atomicJSON, fileMap, walk } from '../src/lib/files';
import { productionPlan } from '../src/pipeline/plan';
import { targetScope, timingStatus } from '../src/pipeline/scope';
import type { Project, Target } from '../src/project';
import { sourceSnapshot } from '../src/state/snapshots';
import { startPreview } from '../src/video/preview';
import { render } from '../src/video/render';

const root = mkdtempSync(join(tmpdir(), 'bcr-context-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(id: string) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'src/Scene.tsx'), 'export default () => null;');
  writeFileSync(join(dir, 'src/Cover.tsx'), 'export default () => null;');
  const main: Target = {
    id: 'main',
    runtime: 'remotion',
    entry: 'src/Scene.tsx',
    fps: 30,
    width: 64,
    height: 64,
    durationInFrames: 90,
  };
  const cover: Target = { ...main, id: 'cover-4x3', entry: 'src/Cover.tsx', durationInFrames: 1 };
  const p: Project = {
    id,
    root: dir,
    role: 'active',
    work: { id, title: '测试作品', defaultTarget: 'main', targets: [main, cover] },
    config: {
      version: 1,
      stage: 'draft',
      privateAssets: ['media/voice/reference.wav'],
      audio: {
        driver: 'standard',
        content: 'content.json',
        voice: 'voice.json',
        timeline: '.bcr/build/audio/timeline.json',
        plan: 'media/narration/plan.json',
        mastering: '.bcr/build/audio/mastering.json',
        quality: '.bcr/build/audio/quality.json',
        score: 'public/audio/score.flac',
      },
      runtime: {
        cues: 'cues.json',
        timing: '.bcr/build/runtime/timing.json',
        events: '.bcr/build/runtime/events.json',
      },
      targets: { main: { audio: 'audio/main.flac' }, 'cover-4x3': {} },
    },
  };
  const content: Content = {
    title: '测试作品',
    subtitle: '测试副标题',
    paragraphs: [
      {
        id: 'opening',
        gapAfter: 0,
        lines: [{ id: 'first', chapter: 'a', text: '你好。', caption: '你好。' }],
      },
    ],
  };
  atomicJSON(join(dir, 'work.json'), p.work);
  atomicJSON(join(dir, 'production.json'), p.config);
  atomicJSON(join(dir, 'content.json'), content);
  atomicJSON(join(dir, 'voice.json'), {
    referenceFile: 'media/voice/reference.wav',
    referenceTranscript: '',
  });
  atomicJSON(join(dir, 'cues.json'), { version: 1, cues: [] });
  atomicJSON(join(dir, p.config.audio!.timeline), {
    draft: true,
    contentHash: contentHash(content),
    fps: 30,
    main: { durationInFrames: 90, audioFile: 'audio/main.flac', segments: [] },
  });
  writeFileSync(
    join(dir, 'docs/STATUS.md'),
    '正式镜头未实现。请先根据分镜制作，不能把模型检查当成成片验收。\n'.repeat(200),
  );
  return { p, dir, main, cover };
}

test('static cover plans and snapshots do not depend on missing main audio or runtime', async () => {
  const { p, main, cover } = fixture('static-cover');
  expect(targetScope(p, cover)).toEqual({ audio: false, runtime: false, scenes: false });
  const plan = await productionPlan(p, cover);
  expect(plan.next).not.toContain('audio');
  expect(plan.next).not.toContain('prepare');
  expect(plan.blockers).toEqual([]);
  const snapshot = sourceSnapshot(p, cover);
  expect(existsSync(join(snapshot.project.root, '.bcr/build/runtime/manifest.json'))).toBe(false);
  expect(() => sourceSnapshot(p, main)).toThrow();
  const preview = await startPreview(p, cover);
  try {
    expect((await fetch(preview.url)).status).toBe(200);
  } finally {
    preview.stop();
  }
  // Stops before rendering; reaching this option check proves the unrelated draft/audio guard was skipped.
  await expect(render(p, cover, { scale: 0 })).rejects.toThrow('视频尺寸');
  await expect(render(p, main, { scale: 0 })).rejects.toThrow('工程仍是草稿');
});

test('draft main exposes timing provenance and actionable missing voice rather than final readiness', async () => {
  const { p, main } = fixture('draft-main');
  const plan = await productionPlan(p, main);
  expect(plan.stage).toBe('draft');
  expect(plan.timing.mode).toBe('draft');
  expect(plan.scope.audio).toBe(true);
  expect(plan.next).toContain('audio');
  expect(plan.blockers.find((item) => item.code === 'audio-inputs')?.message).toContain('参考声音');
  expect(plan.blockers.some((item) => item.code === 'draft-timing')).toBe(true);
  expect(plan.readiness.finalVisuals).toBe('not-assessed');
});

test('static covers retain explicit audio and imported timing dependencies', () => {
  const { p, dir, cover } = fixture('dependent-cover');
  p.config.targets[cover.id]!.audio = 'audio/cover.flac';
  expect(targetScope(p, cover).audio).toBe(true);
  delete p.config.targets[cover.id]!.audio;
  atomicJSON(join(dir, p.config.runtime!.timing), { draft: true });
  writeFileSync(
    join(dir, cover.entry),
    'import data from "../.bcr/build/runtime/timing.json"; export default () => data;',
  );
  expect(targetScope(p, cover).runtime).toBe(true);
  expect(targetScope(p, cover).audio).toBe(true);
  p.config.runtime!.timing = `./${p.config.runtime!.timing}`;
  expect(targetScope(p, cover).runtime).toBe(true);
  writeFileSync(join(dir, cover.entry), 'export default () => null;');
  cover.propsFile = p.config.runtime!.timing;
  expect(targetScope(p, cover).runtime).toBe(true);
  expect(targetScope(p, cover).audio).toBe(true);
  rmSync(join(dir, p.config.audio!.timeline));
  expect(timingStatus(p).mode).toBe('missing');
});

test('model handoff accounts for 700 KB of raw records without reading them into agent context', () => {
  const { p, dir } = fixture('large-data');
  const batches = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    samples: Array(40).fill(i / 2000),
    note: 'raw record',
  }));
  const data = {
    parameters: { repeats: 2000, coverDays: [20, 40] },
    exact: { risk: 0.3 },
    simulation: { failures: 613 },
    batches,
    checks: { consistent: true },
  };
  const text = JSON.stringify(data, null, 2);
  writeFileSync(join(dir, 'data.json'), text);
  expect(text.length).toBeGreaterThan(700_000);
  const before = fileMap(dir, walk(dir));
  const context = workContext(p, 'model');
  const summary = context.dataSummary as {
    bytes: number;
    characters: number;
    value: typeof data & {
      batches: {
        $omitted: boolean;
        recordCount: number;
        omittedRecords: number;
        serializedBytes: number;
      };
    };
  };
  expect(summary.bytes).toBe(statSync(join(dir, 'data.json')).size);
  expect(summary.characters).toBe(text.length);
  expect(summary.value.parameters).toEqual(data.parameters);
  expect(summary.value.exact).toEqual(data.exact);
  expect(summary.value.simulation).toEqual(data.simulation);
  expect(summary.value.checks).toEqual(data.checks);
  expect(summary.value.batches.$omitted).toBe(true);
  expect(summary.value.batches.recordCount).toBe(2000);
  expect(summary.value.batches.omittedRecords).toBe(2000);
  expect(summary.value.batches.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(batches)));
  expect(JSON.stringify(context).length).toBeLessThan(10_000);
  expect(context.status.truncated).toBe(true);
  expect(context.status.omittedCharacters + context.status.includedCharacters).toBe(
    context.status.characters,
  );
  expect(fileMap(dir, walk(dir))).toEqual(before);
});

test('cover context supplies bounded copy and executable actions without requiring TTS', () => {
  const { p, dir, cover } = fixture('cover-copy-actions');
  atomicJSON(join(dir, 'content.json'), { title: '标题'.repeat(300), subtitle: '副标题' });
  const context = workContext(p, 'cover', cover.id);
  expect(context.copy?.title?.value.length).toBe(320);
  expect(context.copy?.title?.omittedCharacters).toBe(280);
  expect(context.copy?.title?.truncated).toBe(true);
  expect(context.copy?.subtitle?.value).toBe('副标题');
  expect(context.scope.audio).toBe(false);
  expect(context.actions.map((item) => item.id)).toEqual(['capture']);
  expect(context.actions[0]?.argv).toEqual([
    'bcr-work',
    '--root',
    root,
    'capture',
    p.id,
    '--target',
    cover.id,
    '--frame',
    '0',
  ]);
  expect(context.actions.every((item) => item.cwd === p.root)).toBe(true);
  expect(context.reads.required.find((item) => item.path === 'content.json')?.sha256).toMatch(
    /^[a-f0-9]{64}$/,
  );
});

test('selected semantic paragraphs are complete, invalid IDs fail, and regression review still requires full reading', () => {
  const { p, dir } = fixture('semantic-selection');
  const paragraph = {
    id: 'opening',
    gapAfter: 0.1,
    lines: [
      { id: 'first', chapter: 'a', text: '第一句话。', caption: '第一句话。' },
      { id: 'second', chapter: 'a', text: '第二句话。', caption: '第二句话。' },
    ],
  };
  atomicJSON(join(dir, 'content.json'), { title: '标题', subtitle: '', paragraphs: [paragraph] });
  const before = fileMap(dir, walk(dir));
  const context = workContext(p, 'review', undefined, 'opening');
  expect(context.selectedSegment?.paragraph).toEqual(paragraph);
  expect(context.selectedSegment?.complete).toBe(true);
  expect(context.readingRequirement?.scope).toBe('full-script');
  expect(context.reads.required.find((item) => item.path === 'content.json')?.select).toContain(
    '通读',
  );
  expect(() => workContext(p, 'write', undefined, 'first')).toThrow('找不到语义段');
  expect(() => workContext(p, 'write', undefined, 'missing')).toThrow('找不到语义段');
  expect(fileMap(dir, walk(dir))).toEqual(before);
  paragraph.lines[0]!.text = '长'.repeat(24_000);
  atomicJSON(join(dir, 'content.json'), { title: '标题', subtitle: '', paragraphs: [paragraph] });
  expect(() => workContext(p, 'write', undefined, 'opening')).toThrow('没有截断返回');
});

test('draft chapters expose a blocker and route to audio handoff instead of suggesting guessed chapter times', () => {
  const { p } = fixture('draft-chapters');
  const context = workContext(p, 'chapters');
  expect(context.blockers[0]?.code).toBe('measured-timing-required');
  expect(context.actions[0]?.argv).toContain('audio');
});

test('cover manifests omit unrelated data and audio, and CLI emits read-only compact handoffs', async () => {
  const { p, dir, cover } = fixture('context-cli');
  atomicJSON(join(dir, 'data.json'), { base64: 'PRIVATE_DATA_MUST_NOT_APPEAR' });
  const context = workContext(p, 'cover', cover.id);
  expect(context.scope).toEqual({ audio: false, runtime: false, scenes: false });
  expect(
    context.reads.configuration.find((item) => item.path === 'video-assets.lock.json'),
  ).toEqual({
    path: 'video-assets.lock.json',
    role: '本期视觉资产与品牌选择；不存在时不要猜测其他锁文件名',
    exists: false,
    bytes: null,
  });
  expect(workContext(p, 'cover').target.id).toBe(cover.id);
  expect(context.dataSummary).toBeUndefined();
  const manifest = [...context.reads.required, ...context.reads.onDemand];
  expect(manifest.some((item) => /data\.json|voice\.json|timeline\.json/.test(item.path))).toBe(
    false,
  );
  expect(manifest.find((item) => item.path === 'content.json')?.select).toBe('title, subtitle');
  expect(parseCli(['context', p.id, '--task', 'cover']).values.task).toBe('cover');
  expect(() => workContext(p, 'unknown')).toThrow('--task');
  atomicJSON(join(root, 'workspace.json'), {
    version: 1,
    projects: [{ id: p.id, role: 'active' }],
  });
  const before = fileMap(dir, walk(dir));
  const process = Bun.spawn(
    [
      globalThis.process.execPath,
      join(import.meta.dir, '../src/cli.ts'),
      '--root',
      root,
      'context',
      p.id,
      '--task',
      'cover',
      '--target',
      cover.id,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const stdout = await new Response(process.stdout).text();
  const stderr = await new Response(process.stderr).text();
  expect(await process.exited).toBe(0);
  expect(stderr).toBe('');
  expect(stdout.trim().split('\n')).toHaveLength(1);
  expect(JSON.parse(stdout).target.id).toBe(cover.id);
  expect(stdout).not.toContain('PRIVATE_DATA_MUST_NOT_APPEAR');
  expect(fileMap(dir, walk(dir))).toEqual(before);
});

test('summary bounds nested objects and strings with explicit omission markers and no encoded payloads', () => {
  const base64 = 'SGVsbG8='.repeat(200);
  const summary = summarizeData({
    parameters: { long: '长文字。'.repeat(12_500) },
    privateReferenceAudio: base64,
    nested: Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, { text: 'x'.repeat(1000) }]),
    ),
  });
  const text = JSON.stringify(summary);
  expect(text.length).toBeLessThan(13_000);
  expect(text).toContain('string-limit');
  expect(text).toContain('private-or-encoded-payload');
  expect(text).toContain('$omittedFields');
  expect(text).not.toContain(base64);
});

test('legacy Python model and brief resolve to existing files, with summary-only parameter fallback', () => {
  const { p, dir, cover } = fixture('legacy-python-model');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'brief.md'), 'Legacy brief');
  writeFileSync(join(dir, 'scripts/model.py'), 'def model(): return 42\n');
  atomicJSON(join(dir, 'data.json'), {
    parameters: { repeats: 2000 },
    batches: Array(2000).fill({ sample: 42 }),
  });
  atomicJSON(join(dir, 'video-assets.lock.json'), { version: 1, theme: 'lab' });
  const before = fileMap(dir, walk(dir));
  expect(
    workContext(p, 'resume').reads.required.find((item) => item.role.includes('本期目标'))?.path,
  ).toBe('brief.md');
  const model = workContext(p, 'model');
  expect(model.reads.required.some((item) => item.path === 'scripts/model.py' && item.exists)).toBe(
    true,
  );
  expect(
    model.reads.required.some((item) =>
      ['src/model.ts', 'model-inputs.json', 'data.json'].includes(item.path),
    ),
  ).toBe(false);
  expect((model.dataSummary as { value: { parameters: unknown } }).value.parameters).toEqual({
    repeats: 2000,
  });
  for (const task of ['cover', 'visual']) {
    const context = workContext(p, task, task === 'cover' ? cover.id : undefined);
    expect(
      context.reads.required.some((item) => item.path === 'video-assets.lock.json' && item.exists),
    ).toBe(true);
  }
  atomicJSON(join(dir, 'model-inputs.json'), { repeats: 2000 });
  expect(
    workContext(p, 'model').reads.required.some(
      (item) => item.path === 'model-inputs.json' && item.exists,
    ),
  ).toBe(true);
  rmSync(join(dir, 'model-inputs.json'));
  writeFileSync(join(dir, 'docs/brief.md'), 'Canonical brief');
  expect(
    workContext(p, 'resume').reads.required.find((item) => item.role.includes('本期目标'))?.path,
  ).toBe('docs/brief.md');
  rmSync(join(dir, 'docs/brief.md'));
  expect(fileMap(dir, walk(dir))).toEqual(before);
});

test('cover context fails clearly when no cover target exists instead of defaulting to main', () => {
  const { p, main } = fixture('no-cover');
  p.work.targets = [main];
  expect(() => workContext(p, 'cover')).toThrow('未声明 cover 或 cover-4x3');
  // Explicit custom IDs remain usable; the omission is never silently filled by main.
  expect(workContext(p, 'cover', main.id).target.id).toBe(main.id);
});
