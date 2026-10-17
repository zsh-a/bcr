import { afterAll, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workContext } from '../src/cli/context';
import { atomicJSON, fileMap, hashFile, walk } from '../src/lib/files';
import { productionPlan } from '../src/pipeline/plan';
import type { Project, Target } from '../src/project';
import { recordReview, reviewStatus } from '../src/review';

const root = mkdtempSync(join(tmpdir(), 'bcr-reviews-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(id: string) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'src/Main.tsx'), 'export default () => null;');
  writeFileSync(join(dir, 'docs/brief.md'), '本期创作范围');
  writeFileSync(join(dir, 'docs/review.md'), '已检查 opening 的论证，证据留档。');
  atomicJSON(join(dir, 'sources.json'), { a: 'primary source' });
  atomicJSON(join(dir, 'content.json'), {
    title: '测试',
    subtitle: '',
    paragraphs: [
      {
        id: 'opening',
        gapAfter: 0,
        lines: [{ id: 'first', text: '你好。', caption: '你好。', chapter: 'a' }],
      },
    ],
  });
  const target: Target = {
    id: 'main',
    runtime: 'remotion',
    entry: 'src/Main.tsx',
    durationInFrames: 90,
    fps: 30,
    width: 64,
    height: 64,
  };
  const p: Project = {
    id,
    root: dir,
    role: 'active',
    work: { id, title: '测试', defaultTarget: 'main', targets: [target] },
    config: { version: 1, privateAssets: [], targets: { main: {} } },
  };
  atomicJSON(join(dir, 'work.json'), p.work);
  atomicJSON(join(dir, 'production.json'), p.config);
  return { p, target, dir };
}
const report = {
  kind: 'script',
  status: 'passed',
  note: '已通读，模型边界和段落交接一致。',
  evidence: 'docs/review.md',
  reviewer: 'review-agent',
};

test('reviews are append-only caller declarations with real evidence and no QA or release side effects', async () => {
  const { p, target, dir } = fixture('append-review');
  expect(reviewStatus(p, target).items.every((item) => item.status === 'missing')).toBe(true);
  const first = recordReview(p, target, report);
  const firstHash = hashFile(join(dir, first.path));
  expect(first.input.key).toMatch(/^[a-f0-9]{64}$/);
  expect(first.evidence.sha256).toBe(hashFile(join(dir, report.evidence)));
  expect(first.reviewer.type).toBe('agent');
  expect(first.reviewer.independentlyVerified).toBe(false);
  expect(first.scope).toBe('full');
  const second = recordReview(p, target, {
    ...report,
    status: 'needs-work',
    note: '仍需补充转场。',
  });
  expect(first.id).not.toBe(second.id);
  expect(hashFile(join(dir, first.path))).toBe(firstHash);
  expect(readdirSync(join(dir, '.bcr/reviews'))).toHaveLength(2);
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'script')?.status).toBe(
    'needs-work',
  );
  expect(existsSync(join(dir, '.bcr/build/validation.json'))).toBe(false);
  expect(existsSync(join(dir, '.bcr/build/frozen.json'))).toBe(false);
  const before = fileMap(dir, walk(dir));
  expect(
    workContext(p, 'resume').reviews.items.find((item) => item.kind === 'script')?.status,
  ).toBe('needs-work');
  expect(
    (await productionPlan(p, target)).reviews.items.find((item) => item.kind === 'script')?.status,
  ).toBe('needs-work');
  expect(fileMap(dir, walk(dir))).toEqual(before);
});

test('script review survives TTS, measured timing and scene changes but expires on authored inputs or evidence', () => {
  const { p, target, dir } = fixture('script-inputs');
  recordReview(p, target, report);
  target.durationInFrames = 300;
  writeFileSync(join(dir, target.entry), 'export default () => 42;');
  atomicJSON(join(dir, 'voice.json'), { model: 'new-voice-model' });
  atomicJSON(join(dir, 'timeline.json'), { draft: false });
  expect(reviewStatus(p, target).items[0]?.status).toBe('fresh');
  writeFileSync(join(dir, 'sources.json'), '{"a":"changed source"}');
  expect(reviewStatus(p, target).items[0]?.status).toBe('stale');
  recordReview(p, target, report);
  writeFileSync(join(dir, 'docs/brief.md'), '修改了教学范围');
  expect(reviewStatus(p, target).items[0]?.status).toBe('stale');
  recordReview(p, target, report);
  writeFileSync(join(dir, 'content.json'), '{"title":"修改了旁白"}');
  expect(reviewStatus(p, target).items[0]?.status).toBe('stale');
  recordReview(p, target, report);
  writeFileSync(join(dir, report.evidence), '证据发生变化');
  expect(reviewStatus(p, target).items[0]?.status).toBe('stale');
});

test('pilot and visual records bind target artifacts, keep sample scope and detect changed evidence', () => {
  const { p, target, dir } = fixture('visual-inputs');
  const pilot = recordReview(p, target, { ...report, kind: 'pilot' });
  expect(pilot.scope).toBe('sample');
  expect(() => recordReview(p, target, { ...report, kind: 'pilot', scope: 'full' })).toThrow(
    'pilot',
  );
  recordReview(p, target, { ...report, kind: 'visual', scope: 'full' });
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'visual')?.status).toBe(
    'fresh',
  );
  writeFileSync(join(dir, target.entry), 'export default () => "changed";');
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'visual')?.status).toBe(
    'stale',
  );
  recordReview(p, target, { ...report, kind: 'visual' });
  writeFileSync(join(dir, report.evidence), '更换了所审样片');
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'visual')?.status).toBe(
    'stale',
  );
});

test('listening cannot be registered as an agent check and human reports remain explicitly unverified', () => {
  const { p, target, dir } = fixture('listening-review');
  expect(() => recordReview(p, target, { ...report, kind: 'listening' })).toThrow(
    '机器分析不能登记',
  );
  const record = recordReview(p, target, {
    ...report,
    kind: 'listening',
    reviewer: '检查者声明名',
    reviewerType: 'human',
    scope: 'full',
  });
  expect(record.reviewer.source).toBe('caller-declared');
  expect(record.reviewer.independentlyVerified).toBe(false);
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'listening')?.status).toBe(
    'fresh',
  );
  writeFileSync(join(dir, 'content.json'), '{"title":"new words"}');
  expect(reviewStatus(p, target).items.find((item) => item.kind === 'listening')?.status).toBe(
    'stale',
  );
});

test('review boundaries reject missing reviewer, nonexistent evidence, traversal and external symlinks', () => {
  const { p, target, dir } = fixture('review-boundaries');
  writeFileSync(join(root, 'outside.txt'), 'outside evidence');
  symlinkSync(join(root, 'outside.txt'), join(dir, 'external.txt'));
  for (const evidence of [
    '../outside.txt',
    join(root, 'outside.txt'),
    'external.txt',
    'docs/missing.md',
    'docs',
  ]) {
    expect(() => recordReview(p, target, { ...report, evidence })).toThrow();
  }
  expect(() => recordReview(p, target, { ...report, reviewer: '' })).toThrow('--reviewer');
  expect(() => recordReview(p, target, { ...report, note: '' })).toThrow('--note');
  expect(existsSync(join(dir, '.bcr/reviews'))).toBe(false);
});

test('corrupt review records remain bounded warnings and CLI registers only declared checks', async () => {
  const { p, target, dir } = fixture('review-cli');
  atomicJSON(join(root, 'workspace.json'), {
    version: 1,
    projects: [{ id: p.id, role: 'active' }],
  });
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '../src/cli.ts'),
      '--root',
      root,
      'review',
      p.id,
      '--kind',
      'script',
      '--status',
      'passed',
      '--note',
      '完成文稿回归',
      '--evidence',
      'docs/review.md',
      '--reviewer',
      'cli-agent',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(stderr).toBe('');
  expect(JSON.parse(stdout).reviewer.type).toBe('agent');
  writeFileSync(join(dir, '.bcr/reviews/corrupt.json'), '{"version":1,"kind":"script"}');
  expect(reviewStatus(p, target).ignoredRecords).toBe(1);
  expect(JSON.stringify(reviewStatus(p, target)).length).toBeLessThan(4000);
  expect(readFileSync(join(dir, report.evidence), 'utf8')).toContain('已检查');
});
