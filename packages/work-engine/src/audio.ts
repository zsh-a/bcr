import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, readContent } from './audio/content';
import { requireVoice } from './audio/standard';
import { type AudioTimeline, type AudioTrack, isAudioTrack } from './audio/types';
import {
  atomicJSON,
  command,
  database,
  fileMap,
  inside,
  json,
  locked,
  type Project,
  sha,
  sourceGraph,
  stable,
  TOOLS,
  verifyMap,
  walk,
} from './core';

export const AUDIO = join(TOOLS, 'audio');
export function audioEnv(p: Project): Record<string, string> {
  return {
    ...p.config.audio?.env,
    PYTHONPATH: '',
    PYTHONNOUSERSITE: '1',
    VIRTUAL_ENV: join(AUDIO, '.venv'),
  };
}
export async function ensureAudio() {
  if (!existsSync(join(AUDIO, 'uv.lock'))) {
    throw new Error('缺少音频依赖锁，请先运行 bcr-work env');
  }
  await locked('audio-environment', () =>
    command(['uv', 'sync', '--locked', '--python', '3.14.2'], AUDIO, {
      PYTHONPATH: '',
      PYTHONNOUSERSITE: '1',
    }),
  );
  return join(AUDIO, '.venv/bin/python');
}
function rawFiles(p: Project, aligned = false) {
  const config = p.config.audio!;
  if (!existsSync(join(p.root, config.plan))) {
    return [];
  }
  const plan = json<{ groups: { raw: string }[] }>(join(p.root, config.plan));
  return plan.groups.map((g) =>
    inside(p.root, aligned ? g.raw.replace(/\.wav$/, '.alignment.json') : g.raw),
  );
}
function tracks(p: Project): (AudioTrack & { id: string })[] {
  if (!existsSync(join(p.root, p.config.audio!.timeline))) {
    return [];
  }
  const timeline = json<AudioTimeline>(join(p.root, p.config.audio!.timeline));
  return Object.entries(timeline).flatMap(([id, track]) =>
    isAudioTrack(track) ? [{ id, ...track }] : [],
  );
}
function narrationFiles(p: Project) {
  return tracks(p).map((t) => {
    const cached = join(p.root, '.bcr/narration', t.narrationFile);
    return existsSync(cached) ? cached : inside(p.root, `public/${t.narrationFile}`);
  });
}
const stages = ['voiceover', 'align', 'assemble', 'soundtrack', 'master', 'check'] as const;
type Stage = (typeof stages)[number];
const scripts: Record<Stage, string> = {
  voiceover: 'voiceover.ts',
  align: 'align-narration.py',
  assemble: 'assemble-narration.py',
  soundtrack: 'soundtrack.ts',
  master: 'master-audio.ts',
  check: 'check-audio.py',
};
function inputs(p: Project, stage: Stage) {
  const cfg = p.config.audio!;
  const script = join(p.root, 'scripts', scripts[stage]);
  const files =
    cfg.driver === 'standard'
      ? []
      : stage === 'voiceover' || stage === 'soundtrack' || stage === 'master'
        ? sourceGraph(p.root, script)
        : [script];
  const add = (...names: string[]) => files.push(...names.map((n) => inside(p.root, n)));
  if (stage === 'voiceover') {
    add('public/audio/reference.wav');
    for (const optional of ['scripts/voiceover-reference.txt', 'voice-config.json']) {
      if (existsSync(join(p.root, optional))) {
        add(optional);
      }
    }
  }
  if (cfg.driver === 'standard') {
    add(cfg.content!, cfg.voice!);
  }
  if (['align', 'assemble', 'check'].includes(stage)) {
    add(cfg.plan);
    files.push(...rawFiles(p));
  }
  if (['assemble', 'check'].includes(stage)) {
    files.push(...rawFiles(p, true));
  }
  if (['soundtrack', 'master', 'check'].includes(stage)) {
    add(cfg.timeline);
  }
  if (['master', 'check'].includes(stage)) {
    files.push(...narrationFiles(p));
    add(cfg.score);
  }
  if (stage === 'check') {
    add(cfg.mastering, 'work.json');
    files.push(...tracks(p).map((t) => inside(p.root, `public/${t.audioFile}`)));
  }
  add('package.json', 'bun.lock');
  const toolFiles = sourceGraph(TOOLS, 'src/audio.ts');
  toolFiles.push(join(AUDIO, 'uv.lock'));
  if (cfg.driver === 'standard') {
    toolFiles.push(...walk(join(AUDIO, 'scripts')));
  }
  const tool = fileMap(TOOLS, toolFiles);
  const work =
    stage === 'assemble'
      ? {
          ...p.work,
          targets: p.work.targets.map((t) => ({ ...t, durationInFrames: undefined })),
        }
      : undefined;
  return sha(
    stable({
      stage,
      files: fileMap(p.root, files),
      tool,
      env: cfg.env,
      work,
      endpoint:
        stage === 'voiceover'
          ? (process.env.GRADIO_ENDPOINT ?? 'http://localhost:8000')
          : undefined,
      device: process.env.ALIGN_DEVICE ?? 'cuda:0',
    }),
  );
}
function outputs(p: Project, stage: Stage): string[] {
  const cfg = p.config.audio!;
  const path = (n: string) => inside(p.root, n);
  if (stage === 'voiceover') {
    return [path(cfg.plan), ...rawFiles(p)];
  }
  if (stage === 'align') {
    return rawFiles(p, true);
  }
  if (stage === 'assemble') {
    return [
      path(cfg.timeline),
      path('work.json'),
      ...narrationFiles(p),
      ...tracks(p).map((t) => path(`subtitles-${t.id}.srt`)),
    ];
  }
  if (stage === 'soundtrack') {
    return [path(cfg.score)];
  }
  if (stage === 'master') {
    return [path(cfg.mastering), ...tracks(p).map((t) => path(`public/${t.audioFile}`))];
  }
  return [path(cfg.quality)];
}
export async function audio(p: Project, checkOnly = false, force = false) {
  if (!p.config.audio) {
    throw new Error('原型没有连续母带制作流程；请使用 preview/capture，保留原型配音方式。');
  }
  return locked(`audio:${p.id}`, async () => {
    if (p.config.audio!.driver === 'standard') {
      if (checkOnly) {
        assertMeasured(p);
      } else {
        requireVoice(p);
        p.config.stage = 'draft';
        atomicJSON(join(p.root, 'production.json'), p.config);
      }
    }
    const python = await ensureAudio();
    const cfg = p.config.audio!;
    const results: { stage: Stage; cached: boolean; outputs?: string[] }[] = [];
    mkdirSync(join(p.root, 'qa'), { recursive: true });
    if (!checkOnly && cfg.prepare) {
      await command([process.execPath, ...cfg.prepare], p.root, audioEnv(p));
    }
    for (const stage of checkOnly ? (['check'] as Stage[]) : stages) {
      const key = inputs(p, stage);
      const db = database();
      const old = db
        .query('SELECT key,outputs FROM stages WHERE project=? AND stage=?')
        .get(p.id, stage) as { key: string; outputs: string } | null;
      db.close();
      if (!force && old?.key === key && verifyMap(p.root, JSON.parse(old.outputs))) {
        console.log(`${p.id} audio:${stage} cache hit`);
        results.push({ stage, cached: true });
        continue;
      }
      const cmd =
        cfg.driver === 'standard'
          ? [
              scripts[stage].endsWith('.py') ? python : process.execPath,
              scripts[stage].endsWith('.py')
                ? join(AUDIO, 'scripts', scripts[stage])
                : join(TOOLS, 'src/audio/standard.ts'),
              ...(!scripts[stage].endsWith('.py') ? [stage] : []),
              p.root,
              ...(stage === 'check' ? ['--require-raw'] : []),
            ]
          : [
              scripts[stage].endsWith('.py') ? python : process.execPath,
              `scripts/${scripts[stage]}`,
              ...(stage === 'check' ? ['--require-raw'] : []),
            ];
      console.log(`${p.id} audio:${stage}`);
      if (stage === 'voiceover') {
        await locked('shared-tts', () => command(cmd, p.root, audioEnv(p)));
      } else if (stage === 'align') {
        await locked('shared-gpu', () => command(cmd, p.root, audioEnv(p)));
      } else {
        await command(cmd, p.root, audioEnv(p));
      }
      const outputFiles = outputs(p, stage);
      if (!outputFiles.length || outputFiles.some((f) => !existsSync(f))) {
        throw new Error(`阶段没有完整产物: ${stage}`);
      }
      const out = fileMap(p.root, outputFiles);
      const next = database();
      next
        .query('INSERT OR REPLACE INTO stages VALUES (?,?,?,?,?)')
        .run(p.id, stage, key, JSON.stringify(out), Date.now());
      next.close();
      results.push({ stage, cached: false, outputs: Object.keys(out) });
    }
    if (cfg.driver === 'standard') {
      p.config.stage = 'production';
      atomicJSON(join(p.root, 'production.json'), p.config);
    }
    return results;
  });
}

export function assertMeasured(p: Project) {
  if (p.config.audio?.driver !== 'standard') {
    return;
  }
  const timeline = json<AudioTimeline>(inside(p.root, p.config.audio.timeline));
  if (timeline.draft) {
    throw new Error('当前为估算时间轴，请先执行 audio 完成配音、强制对齐与母带验收');
  }
  if (timeline.contentHash !== contentHash(readContent(p))) {
    throw new Error('口播已修改，实测时间轴已过期，请重新执行 audio');
  }
}
