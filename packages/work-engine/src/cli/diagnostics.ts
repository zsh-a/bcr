import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO, audio } from '../audio';
import { contentHash, readContent } from '../audio/content';
import { type AudioTimeline, isAudioTrack } from '../audio/types';
import {
  assets,
  CACHE,
  command,
  json,
  project,
  ROOT,
  STATE,
  sourceGraph,
  workspace,
} from '../core';
import type { PackageManifest } from '../project';
export async function doctor(id?: string) {
  const ids = id ? [id] : workspace().projects.map((entry) => entry.id);
  const tools: Record<string, string | { error: string }> = {};
  for (const [name, cmd] of [
    ['bun', [process.execPath, '--version']],
    ['uv', ['uv', '--version']],
    ['ffmpeg', ['ffmpeg', '-version']],
    ['chromium', [process.env.BCR_WORK_BROWSER ?? '/usr/bin/chromium', '--version']],
  ] as [string, string[]][]) {
    try {
      tools[name] = (await command(cmd, ROOT, {}, true)).split('\n')[0] ?? '';
    } catch (error) {
      tools[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  const projects = ids.map((name: string) => {
    const p = project(name);
    const problems: string[] = [];
    const notes: string[] = [];
    const draft = p.config.stage === 'draft';
    if (draft) {
      notes.push('当前是草稿；缺少配音母带属于待制作事项，正式 render/release 尚不可用');
    }
    for (const t of p.work.targets) {
      if (!existsSync(join(p.root, t.entry))) {
        problems.push(`缺少入口: ${t.entry}`);
      }
      if (t.runtime === 'remotion') {
        try {
          sourceGraph(p.root, t.entry);
          assets(p, t);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
        if (
          ![t.width, t.height, t.fps, t.durationInFrames].every(
            (n) => typeof n === 'number' && Number.isInteger(n) && n > 0,
          )
        ) {
          problems.push(`目标参数错误: ${t.id}`);
        }
      }
      const audioFile = p.config.targets[t.id]?.audio;
      if (!draft && audioFile && !existsSync(join(p.root, 'public', audioFile))) {
        problems.push(`缺少母带: ${audioFile}`);
      }
    }
    if (p.config.audio) {
      try {
        const timeline = json<AudioTimeline>(join(p.root, p.config.audio.timeline));
        for (const t of p.work.targets.filter((t) => p.config.targets[t.id]?.audio)) {
          const track = timeline[t.id];
          if (
            !isAudioTrack(track) ||
            track.durationInFrames !== t.durationInFrames ||
            timeline.fps !== t.fps ||
            track.audioFile !== p.config.targets[t.id]?.audio
          ) {
            problems.push(`目标与实测时间轴不一致: ${t.id}`);
          }
        }
        if (
          p.config.audio.driver === 'standard' &&
          timeline.contentHash !== contentHash(readContent(p))
        ) {
          problems.push('内容与时间轴不一致；草稿执行 draft，正式制作执行 audio');
        }
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (existsSync(join(p.root, 'package.json'))) {
      const pkg = json<PackageManifest>(join(p.root, 'package.json'));
      if (!existsSync(join(p.root, 'bun.lock'))) {
        problems.push('缺少 Bun 锁文件');
      }
      for (const [name, version] of Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      })) {
        if ((name === 'remotion' || name.startsWith('@remotion/')) && version !== '4.0.532') {
          problems.push(`Remotion 版本不一致: ${name}`);
        }
      }
    }
    return {
      id: p.id,
      role: p.role,
      targets: p.work.targets.map((t) => t.id),
      stage: p.config.stage ?? (p.config.audio ? 'production' : 'prototype'),
      continuousMaster:
        !!p.config.audio &&
        !draft &&
        p.work.targets
          .filter((t) => p.config.targets[t.id]?.audio)
          .every((t) => existsSync(join(p.root, 'public', p.config.targets[t.id]!.audio!))),
      privateAssetsExcluded: p.config.privateAssets,
      problems,
      notes,
    };
  });
  const result = {
    tools,
    audioEnvironment: join(AUDIO, '.venv'),
    pythonIsolated:
      existsSync(join(AUDIO, '.venv/pyvenv.cfg')) &&
      !readFileSync(join(AUDIO, '.venv/pyvenv.cfg'), 'utf8').includes(
        'include-system-site-packages = true',
      ),
    cache: CACHE,
    state: STATE,
    projects,
  };

  if (
    projects.some((p) => p.problems.length) ||
    Object.values(tools).some((v) => typeof v !== 'string')
  ) {
    process.exitCode = 1;
  }
  return result;
}
export async function check(p: ReturnType<typeof project>) {
  if (existsSync(join(p.root, 'package.json'))) {
    await command([process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts'], p.root);
    const pkg = json<PackageManifest>(join(p.root, 'package.json'));
    for (const task of ['typecheck', 'lint', 'test']) {
      if (pkg.scripts?.[task]) {
        await command([process.execPath, 'run', task], p.root);
      }
    }
  }
  if (p.config.audio?.driver === 'standard') {
    readContent(p);
  }
  if (p.config.stage === 'draft') {
    console.log(
      `${p.id} draft structure/type/style checks passed; measured audio acceptance pending`,
    );
    return;
  }
  if (p.config.audio) {
    await audio(p, true);
  }
  console.log(`${p.id} automatic checks passed; human listening/viewing pending`);
}
