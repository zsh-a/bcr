import { afterAll, expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertMeasured, audio } from '../src/audio';
import { type Content, readContent } from '../src/audio/content';
import { writeDraft } from '../src/audio/draft';
import { workContext } from '../src/cli/context';
import { statusSummary } from '../src/cli/status';
import {
  assets,
  atomicJSON,
  fileMap,
  hashFile,
  inside,
  json,
  locked,
  type Project,
  project,
  sha,
  sourceGraph,
  type Target,
  TOOLS,
  targetIdentity,
  verifyMap,
  walk,
} from '../src/core';
import { initProject } from '../src/init';
import { dependencies } from '../src/lib/dependencies';
import { packageArchives } from '../src/lib/package-archives';
import { orphanPlan } from '../src/maintenance';
import { release } from '../src/release';
import { av1Level, encodeOptions, render } from '../src/render';
import { testState } from './setup';

const root = mkdtempSync(join(tmpdir(), 'bcr-manager-test-'));
test('vendored package archives reject traversal, folders and links', () => {
  const dir = join(root, 'archive-paths');
  mkdirSync(join(dir, 'vendor'), { recursive: true });
  writeFileSync(join(dir, 'vendor/library.tgz'), 'archive');
  const archives = packageArchives(dir, { '@test/library': 'file:vendor/library.tgz' });
  expect(archives.length).toBe(1);
  expect(archives[0].sha256).toBe(sha('archive'));
  for (const version of [
    'file:../outside.tgz',
    'file:vendor/../outside.tgz',
    'file:vendor/folder',
    'workspace:*',
    'link:../outside',
  ]) {
    expect(() => packageArchives(dir, { library: version })).toThrow();
  }
  symlinkSync(join(dir, 'vendor/library.tgz'), join(dir, 'vendor/link.tgz'));
  expect(() => packageArchives(dir, { library: 'file:vendor/link.tgz' })).toThrow();
});

test('dependency caches and render identities include vendored package bytes', async () => {
  const workspace = workspaceFixture('archive-workspace');
  const created = await initProject('archive-work', { install: false }, { root: workspace });
  const current = project('archive-work', workspace);
  const archive = join(created.path, 'vendor/library-0.1.0.tgz');
  mkdirSync(join(created.path, 'vendor'));
  await Bun.write(
    archive,
    new Bun.Archive({
      'package/package.json': JSON.stringify({
        name: '@bcr/archive-fixture',
        version: '0.1.0',
        type: 'module',
        exports: './index.js',
      }),
      'package/index.js': 'export const answer = 42;',
    }),
  );
  writeFileSync(archive, Bun.gzipSync(readFileSync(archive)));
  atomicJSON(join(created.path, 'package.json'), {
    name: 'archive-work',
    private: true,
    dependencies: { '@bcr/archive-fixture': 'file:vendor/library-0.1.0.tgz' },
    overrides: { '@bcr/archive-fixture': 'file:vendor/library-0.1.0.tgz' },
  });
  const install = Bun.spawn([process.execPath, 'install', '--ignore-scripts'], {
    cwd: created.path,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const status = await install.exited;
  if (status) {
    throw new Error(await new Response(install.stderr).text());
  }
  const before = targetIdentity(current, current.work.targets[0]);
  expect(before.files['vendor/library-0.1.0.tgz']).toBe(sha(readFileSync(archive)));
  const environment = await dependencies(current);
  expect(
    readFileSync(join(environment, 'node_modules/@bcr/archive-fixture/index.js'), 'utf8'),
  ).toBe('export const answer = 42;');
  expect(await dependencies(current)).toBe(environment);
  const cachedArchive = join(environment, 'vendor/library-0.1.0.tgz');
  writeFileSync(cachedArchive, 'corrupt-cache');
  await dependencies(current);
  expect(sha(readFileSync(cachedArchive))).toBe(sha(readFileSync(archive)));
  writeFileSync(archive, 'changed-source');
  expect(targetIdentity(current, current.work.targets[0]).key).not.toBe(before.key);
});
function workspaceFixture(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  atomicJSON(join(dir, 'workspace.json'), {
    version: 1,
    cacheBudgetGiB: 8,
    projects: [],
    custom: 'preserved',
  });
  return dir;
}
test('compact status reads current configuration and delivery without creating a database', async () => {
  const dir = workspaceFixture('summary-workspace');
  const created = await initProject(
    'summary-work',
    { title: '摘要', install: false },
    { root: dir },
  );
  const before = fileMap(dir, walk(dir));
  const stateDirectory = join(testState, 'state');
  const stateBefore = fileMap(stateDirectory, walk(stateDirectory));
  const summary = statusSummary(undefined, dir);
  expect(summary.projects[0]).toMatchObject({
    id: 'summary-work',
    timing: 'estimated',
    currentRelease: null,
  });
  expect(fileMap(dir, walk(dir))).toEqual(before);
  expect(fileMap(stateDirectory, walk(stateDirectory))).toEqual(stateBefore);
  const delivery = join(root, 'summary-delivery');
  mkdirSync(join(delivery, 'files'), { recursive: true });
  atomicJSON(join(delivery, 'manifest.json'), { id: 'immutable-release' });
  symlinkSync(join(delivery, 'files'), join(created.path, 'out'));
  expect(statusSummary('summary-work', dir).projects[0].currentRelease).toBe('immutable-release');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(testState, { recursive: true, force: true });
});

test('init creates registered drafts with separate content, targets and shared pinned tools', async () => {
  const dir = workspaceFixture('init-workspace');
  const title = '新 Work「带引号」与换行\n$(literal)';
  const result = await initProject('new-episode', { title, install: false }, { root: dir });
  const current = project('new-episode', dir);
  expect(result.path).toBe(join(dir, 'new-episode'));
  expect(current.work.title).toBe(title);
  expect(current.work.targets.map((target) => target.id)).toEqual(['main', 'cover', 'cover-4x3']);
  expect(current.config.stage).toBe('draft');
  expect(current.config.audio?.driver).toBe('standard');
  expect(json<{ custom: string }>(join(dir, 'workspace.json')).custom).toBe('preserved');
  expect(json<{ draft: boolean }>(join(result.path, current.config.audio!.timeline)).draft).toBe(
    true,
  );
  expect(existsSync(join(result.path, 'public/audio/reference.wav'))).toBe(false);
  expect(existsSync(join(result.path, '.bcr/audio-env'))).toBe(false);
  expect(existsSync(join(result.path, 'docs/platform-description.md'))).toBe(true);
  const handoff = workContext(current, 'resume');
  expect(handoff.status.exists).toBe(true);
  expect(handoff.status.truncated).toBe(false);
  expect(handoff.reads.required.every((entry) => entry.exists)).toBe(true);
  const pkg = json<{ dependencies: Record<string, string>; scripts: Record<string, string> }>(
    join(result.path, 'package.json'),
  );
  expect(pkg.dependencies.remotion).toBe(
    json<{ dependencies: Record<string, string> }>(join(TOOLS, 'package.json')).dependencies
      .remotion,
  );
  expect(pkg.dependencies['@remotion/player']).toBe(pkg.dependencies.remotion);
  expect(pkg.scripts['audio:build']).toContain('bcr-work --root ..');
  sourceGraph(current.root, 'src/Scene.tsx');
  expect(readdirSync(dir).some((name) => name.startsWith('.init-'))).toBe(false);
});

test('init enforces the title limit before publishing or registering a work', async () => {
  const dir = workspaceFixture('init-title-limit');
  await initProject('accepted', { title: '字'.repeat(200), install: false }, { root: dir });
  const registry = readFileSync(join(dir, 'workspace.json'), 'utf8');
  await expect(
    initProject('too-long', { title: '字'.repeat(201), install: false }, { root: dir }),
  ).rejects.toThrow('1–200');
  expect(existsSync(join(dir, 'too-long'))).toBe(false);
  expect(readFileSync(join(dir, 'workspace.json'), 'utf8')).toBe(registry);
  expect(readdirSync(dir).some((name) => name.startsWith('.init-'))).toBe(false);
});

test('init refuses duplicate registrations, existing files, dangling symlinks and traversal', async () => {
  const dir = workspaceFixture('init-collisions');
  await initProject('taken', { install: false }, { root: dir });
  const registry = readFileSync(join(dir, 'workspace.json'), 'utf8');
  await expect(initProject('taken', { install: false }, { root: dir })).rejects.toThrow('拒绝覆盖');
  writeFileSync(join(dir, 'personal-file'), 'keep');
  await expect(initProject('personal-file', { install: false }, { root: dir })).rejects.toThrow(
    '拒绝覆盖',
  );
  symlinkSync(join(dir, 'does-not-exist'), join(dir, 'dangling'));
  await expect(initProject('dangling', { install: false }, { root: dir })).rejects.toThrow(
    '拒绝覆盖',
  );
  await expect(initProject('../escape', { install: false }, { root: dir })).rejects.toThrow(
    '工程 ID',
  );
  expect(readFileSync(join(dir, 'personal-file'), 'utf8')).toBe('keep');
  expect(readFileSync(join(dir, 'workspace.json'), 'utf8')).toBe(registry);
});

test('failed dependency setup rolls back staging and does not register an incomplete work', async () => {
  const dir = workspaceFixture('init-failure');
  const before = readFileSync(join(dir, 'workspace.json'), 'utf8');
  await expect(
    initProject(
      'broken',
      {},
      {
        root: dir,
        install: async () => {
          throw new Error('offline setup failed');
        },
      },
    ),
  ).rejects.toThrow('offline setup failed');
  expect(existsSync(join(dir, 'broken'))).toBe(false);
  expect(readdirSync(dir).some((name) => name.startsWith('.init-'))).toBe(false);
  expect(readFileSync(join(dir, 'workspace.json'), 'utf8')).toBe(before);
});

test('concurrent init calls preserve both registrations', async () => {
  const dir = workspaceFixture('init-concurrent');
  await Promise.all(
    ['first', 'second'].map((id) => initProject(id, { install: false }, { root: dir })),
  );
  expect(
    json<{ projects: { id: string }[] }>(join(dir, 'workspace.json'))
      .projects.map((entry: { id: string }) => entry.id)
      .sort(),
  ).toEqual(['first', 'second']);
});

test('init preserves registry edits made while dependencies are being installed', async () => {
  const dir = workspaceFixture('init-registry-update');
  await initProject(
    'new-project',
    {},
    {
      root: dir,
      install: async () => {
        atomicJSON(join(dir, 'workspace.json'), {
          version: 1,
          cacheBudgetGiB: 12,
          projects: [{ id: 'other-project', role: 'prototype' }],
          custom: 'updated',
        });
      },
    },
  );
  const registry = json<{ cacheBudgetGiB: number; custom: string; projects: { id: string }[] }>(
    join(dir, 'workspace.json'),
  );
  expect(registry.cacheBudgetGiB).toBe(12);
  expect(registry.custom).toBe('updated');
  expect(registry.projects.map((entry) => entry.id)).toEqual(['other-project', 'new-project']);
});

test('drafts cannot pass audio acceptance or render and measured timing cannot be silently replaced', async () => {
  const dir = workspaceFixture('draft-controls');
  const result = await initProject('draft-work', { install: false }, { root: dir });
  const current = project('draft-work', dir);
  await expect(audio(current, true)).rejects.toThrow('估算时间轴');
  await expect(render(current, current.work.targets[0])).rejects.toThrow('草稿');
  const content = readContent(current);
  content.paragraphs[0].lines[0].text += '延长草稿以检查依赖更新。';
  atomicJSON(join(result.path, 'content.json'), content);
  const before = current.work.targets[0].durationInFrames!;
  expect(writeDraft(current).durationInFrames).toBeGreaterThan(before);
  const timeline = json<{ draft: boolean; contentHash: string }>(
    join(result.path, current.config.audio!.timeline),
  );
  atomicJSON(join(result.path, current.config.audio!.timeline), { ...timeline, draft: false });
  expect(() => writeDraft(current)).toThrow('实测时间轴');
  expect(() => assertMeasured(current)).not.toThrow();
  content.paragraphs[0].lines[0].text += '再次修改口播。';
  atomicJSON(join(result.path, 'content.json'), content);
  expect(() => assertMeasured(current)).toThrow('已过期');
});

test('content validation rejects duplicate semantic IDs and unexplained long holds', async () => {
  const dir = workspaceFixture('content-validation');
  const result = await initProject('content-work', { install: false }, { root: dir });
  const current = project('content-work', dir);
  const content = json<Content>(join(result.path, 'content.json'));
  content.paragraphs[0].lines[0].id = content.paragraphs[0].id;
  atomicJSON(join(result.path, 'content.json'), content);
  expect(() => readContent(current)).toThrow('重复');
  content.paragraphs[0].lines[0].id = 'unique-caption';
  content.paragraphs[0].gapAfter = 0.8;
  atomicJSON(join(result.path, 'content.json'), content);
  expect(() => readContent(current)).toThrow('holdReason');
});
function fixture(name: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'public/audio'), { recursive: true });
  mkdirSync(join(dir, 'public/fonts'), { recursive: true });
  writeFileSync(join(dir, 'Scene.tsx'), 'import {value} from "./content"; export default value;');
  writeFileSync(join(dir, 'Cover.tsx'), 'export default "cover";');
  writeFileSync(join(dir, 'content.ts'), 'export const value=1;');
  writeFileSync(join(dir, 'public/audio/mix.flac'), 'master');
  writeFileSync(join(dir, 'public/audio/reference.wav'), 'private-reference');
  writeFileSync(join(dir, 'public/fonts/font.otf'), 'font');
  const t: Target = {
    id: 'main',
    runtime: 'remotion',
    entry: 'Scene.tsx',
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
  };
  const p: Project = {
    id: name,
    root: dir,
    role: 'active',
    work: { id: name, targets: [t] },
    config: {
      version: 1,
      privateAssets: ['audio/reference.wav'],
      targets: { main: { audio: 'audio/mix.flac' }, cover: {} },
    },
  };
  return { p, t, dir };
}
test('dependency keys ignore QA/docs, follow transitive source, isolate cover from narration', () => {
  const { p, t, dir } = fixture('identity');
  const cover = { ...t, id: 'cover', entry: 'Cover.tsx', durationInFrames: 1 };
  const key = targetIdentity(p, t).key;
  const coverKey = targetIdentity(p, cover).key;
  mkdirSync(join(dir, 'qa'));
  writeFileSync(join(dir, 'qa/result.json'), '{}');
  writeFileSync(join(dir, 'README.md'), 'new docs');
  expect(targetIdentity(p, t).key).toBe(key);
  writeFileSync(join(dir, 'content.ts'), 'export const value=2;');
  expect(targetIdentity(p, t).key).not.toBe(key);
  expect(targetIdentity(p, cover).key).toBe(coverKey);
  writeFileSync(join(dir, 'public/audio/mix.flac'), 'new master');
  expect(targetIdentity(p, cover).key).toBe(coverKey);
});
test('private reference audio is excluded even from a broad explicit asset selection', () => {
  const { p, t } = fixture('private');
  p.config.targets.main = { assets: ['audio', 'fonts'] };
  expect(assets(p, t).some((f) => f.endsWith('reference.wav'))).toBe(false);
  expect(assets(p, t).some((f) => f.endsWith('mix.flac'))).toBe(true);
});
test('output hashes reject corrupt or missing cached results', () => {
  const dir = join(root, 'integrity');
  mkdirSync(dir);
  const f = join(dir, 'video.mp4');
  writeFileSync(f, 'result');
  const map = fileMap(dir, [f]);
  expect(verifyMap(dir, map)).toBe(true);
  writeFileSync(f, 'corrupt');
  expect(verifyMap(dir, map)).toBe(false);
  rmSync(f);
  expect(verifyMap(dir, map)).toBe(false);
});
test('paths cannot escape using traversal or symlinks', () => {
  const dir = join(root, 'safe');
  mkdirSync(dir);
  symlinkSync('/etc', join(dir, 'outside'));
  expect(() => inside(dir, '../escape')).toThrow();
  expect(() => inside(dir, 'outside/passwd')).toThrow();
});
test('resource leases serialize competing work', async () => {
  const events: string[] = [];
  await Promise.all([
    locked('test-lease', async () => {
      events.push('a');
      await Bun.sleep(50);
      events.push('b');
    }),
    locked('test-lease', async () => {
      events.push('c');
    }),
  ]);
  expect(events).toEqual(['a', 'b', 'c']);
});
test('cache collection waits for live renders before changing files', async () => {
  const events: string[] = [];
  await Promise.all([
    locked('render:test-gc', async () => {
      events.push('render');
      await Bun.sleep(50);
      events.push('done');
    }),
    locked('cache-gc', async () => {
      events.push('gc');
    }),
  ]);
  expect(events).toEqual(['render', 'done', 'gc']);
});
test('automatic GC can defer immediately while preview is active', async () => {
  await locked('preview:test-defer', async () => {
    const start = performance.now();
    await expect(locked('cache-gc', async () => {}, 0)).rejects.toThrow('资源正在使用');
    expect(performance.now() - start).toBeLessThan(100);
  });
});
test('source Player preview does not prevent cache quota enforcement', async () => {
  await locked('preview-source:test', async () => {
    await locked('cache-gc', async () => {}, 0);
  });
});
test('orphan cleanup selects only owned, unregistered cache paths', () => {
  const dir = join(root, 'orphan-cache');
  mkdirSync(dir);
  const cached = join(dir, `bundle-${'a'.repeat(64)}`);
  const abandoned = join(dir, `frames-${'b'.repeat(64)}.123.tmp`);
  const unknown = join(dir, 'personal-data');
  for (const path of [cached, abandoned, unknown]) {
    mkdirSync(path);
  }
  expect(orphanPlan(dir, [cached])).toEqual([abandoned]);
  expect(existsSync(unknown)).toBe(true);
});
test('release copies have stable identity and failed private-asset checks preserve current', async () => {
  const { p, t, dir } = fixture('release-test');
  t.width = t.height = 64;
  t.durationInFrames = 2;
  const source = join(root, 'release-input');
  const base = join(root, 'releases');
  mkdirSync(source);
  writeFileSync(join(source, 'publish.txt'), 'accepted publication');
  await expect(release(p, source, base)).rejects.toThrow('完整 AV1');
  const clip = join(source, 'main.mp4');
  const encode = Bun.spawn(
    [
      'ffmpeg',
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:r=30',
      '-frames:v',
      '2',
      '-c:v',
      'libaom-av1',
      '-cpu-used',
      '8',
      clip,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const error = await new Response(encode.stderr).text();
  if (await encode.exited) {
    throw new Error(error);
  }
  const report = {
    project: p.id,
    target: t.id,
    status: 'succeeded',
    scope: 'sample',
    sha256: hashFile(clip),
    input: targetIdentity(p, t),
  };
  atomicJSON(`${clip}.json`, report);
  await expect(release(p, source, base)).rejects.toThrow('全片 AV1');
  report.scope = 'full';
  atomicJSON(`${clip}.json`, report);
  p.config.stage = 'draft';
  await expect(release(p, source, base)).rejects.toThrow('草稿');
  p.config.stage = 'production';
  const first = await release(p, source, base);
  expect(readlinkSync(first.current)).toBe(first.id);
  expect(readFileSync(join(first.path, 'files/publish.txt'), 'utf8')).toBe('accepted publication');
  const retry = await release(p, source, base);
  expect(retry.id).toBe(first.id);
  copyFileSync(join(dir, 'public/audio/reference.wav'), join(source, 'accidental.wav'));
  await expect(release(p, source, base)).rejects.toThrow('私有旁白');
  expect(readlinkSync(first.current)).toBe(first.id);
  rmSync(join(source, 'accidental.wav'));
  writeFileSync(join(dir, 'content.ts'), 'export const value=2;');
  await expect(release(p, source, base)).rejects.toThrow('当前源码身份');
  expect(readlinkSync(first.current)).toBe(first.id);
  writeFileSync(join(dir, 'content.ts'), 'export const value=1;');
  writeFileSync(join(source, 'publish.txt'), 'next publication');
  const second = await release(p, source, base);
  expect(readlinkSync(second.current)).toBe(second.id);
  expect(first.id).not.toBe(second.id);
  expect(readFileSync(join(first.path, 'files/publish.txt'), 'utf8')).toBe('accepted publication');
});
test('AV1 encoder policy requires a reason for CPU fallback and rejects H264', () => {
  expect(encodeOptions('av1_nvenc', 20)).toContain('av1_nvenc');
  expect(() => encodeOptions('libaom-av1', 20)).toThrow();
  expect(encodeOptions('libaom-av1', 20, 'GPU unavailable')).toContain('libaom-av1');
  expect(() => encodeOptions('h264', 20)).toThrow();
});
test('AV1 level follows dimensions and frame rate instead of NVENC maximum', () => {
  const target: Target = {
    id: 'main',
    runtime: 'remotion',
    entry: 'Scene.tsx',
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
  };
  expect(av1Level(target)).toBe('4.0');
  expect(av1Level({ ...target, fps: 60 })).toBe('4.1');
  expect(av1Level({ ...target, width: 3840, height: 2160 })).toBe('5.0');
  expect(() => av1Level({ ...target, width: 10000, height: 100 })).toThrow();
});
