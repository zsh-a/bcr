import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { audioCppInputFiles, audioCppSettings } from './audio/audiocpp';
import type { VoiceSettings } from './audio/content';
import { contentHash, readContent } from './audio/content';
import { dramaSettings } from './audio/drama';
import { AUDIO, audioEnvironmentPath, ensureAudio } from './audio/environment';
import { musicInputFiles } from './audio/music';
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
} from './core';
import { dependencyIdentity } from './lib/dependencies';
import { prepareRuntime } from './pipeline/runtime';

export { AUDIO, ensureAudio } from './audio/environment';
export function audioEnv(p: Project): Record<string, string> {
  return {
    ...p.config.audio?.env,
    PYTHONPATH: '',
    PYTHONNOUSERSITE: '1',
    VIRTUAL_ENV: audioEnvironmentPath(),
  };
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
function musicStem(p: Project) {
  const cfg = p.config.audio!;
  const voice = cfg.voice ? json<VoiceSettings>(inside(p.root, cfg.voice)) : undefined;
  return cfg.driver === 'standard' && voice?.music
    ? [inside(p.root, `${cfg.directory ?? '.bcr/narration'}/music-ducked.wav`)]
    : [];
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
    const cached = join(p.root, p.config.audio!.directory ?? '.bcr/narration', t.narrationFile);
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
    cfg.driver === 'standard' || stage === 'align'
      ? []
      : stage === 'voiceover' || stage === 'soundtrack' || stage === 'master'
        ? sourceGraph(p.root, script)
        : [script];
  const add = (...names: string[]) => files.push(...names.map((n) => inside(p.root, n)));
  if (stage === 'voiceover') {
    const voice = p.config.audio?.voice
      ? json<VoiceSettings>(inside(p.root, p.config.audio.voice))
      : undefined;
    add(voice?.referenceFile ?? 'public/audio/reference.wav');
  }
  if (cfg.driver === 'standard') {
    add(cfg.content!);
  }
  add(cfg.voice!);
  if (stage === 'voiceover') {
    files.push(...audioCppInputFiles(p.root, json<VoiceSettings>(inside(p.root, cfg.voice!))));
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
  if (cfg.driver === 'standard' && stage === 'soundtrack') {
    files.push(...musicInputFiles(p.root, json<VoiceSettings>(inside(p.root, cfg.voice!))));
  }
  if (['master', 'check'].includes(stage)) {
    files.push(...narrationFiles(p));
    add(cfg.score);
  }
  if (stage === 'check') {
    files.push(...musicStem(p));
    add(cfg.mastering, 'work.json');
    files.push(...tracks(p).map((t) => inside(p.root, `public/${t.audioFile}`)));
  }
  add('package.json', 'bun.lock');
  const toolFiles =
    cfg.driver === 'standard'
      ? [
          'src/audio/standard.ts',
          'src/audio/content.ts',
          'src/audio/audiocpp.ts',
          'src/audio/recorded.ts',
          'src/audio/align.ts',
          'src/audio/drama.ts',
          'src/audio/music.ts',
        ].map((file) => join(TOOLS, file))
      : sourceGraph(TOOLS, 'src/audio.ts');
  toolFiles.push(join(AUDIO, 'uv.lock'));
  if (cfg.driver === 'standard' && ['assemble', 'check'].includes(stage)) {
    toolFiles.push(join(AUDIO, 'scripts', scripts[stage]));
  }
  const tool = fileMap(TOOLS, toolFiles);
  const hashes = fileMap(p.root, files);
  delete hashes['package.json'];
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
      files: hashes,
      dependencies: dependencyIdentity(p),
      tool,
      env: cfg.env,
      work,
      native: ['voiceover', 'align'].includes(stage)
        ? nativeIdentity(json<VoiceSettings>(inside(p.root, cfg.voice!)), stage === 'align')
        : undefined,
    }),
  );
}
function nativeIdentity(voice: VoiceSettings, alignment: boolean) {
  return voice.backend === 'drama-rs' && !alignment
    ? dramaSettings(voice)
    : audioCppSettings(voice, alignment);
}
function outputs(p: Project, stage: Stage): string[] {
  const cfg = p.config.audio!;
  const path = (n: string) => inside(p.root, n);
  if (stage === 'voiceover') {
    const plan = json<{ groups: { generation?: string }[] }>(path(cfg.plan));
    return [
      path(cfg.plan),
      ...rawFiles(p),
      ...plan.groups.flatMap((group) => (group.generation ? [path(group.generation)] : [])),
    ];
  }
  if (stage === 'align') {
    return rawFiles(p, true);
  }
  if (stage === 'assemble') {
    return [
      path(cfg.timeline),
      path('work.json'),
      ...narrationFiles(p),
      ...tracks(p).map((t) =>
        path(`${cfg.subtitlesDirectory ? `${cfg.subtitlesDirectory}/` : ''}subtitles-${t.id}.srt`),
      ),
    ];
  }
  if (stage === 'soundtrack') {
    return [path(cfg.score)];
  }
  if (stage === 'master') {
    return [
      path(cfg.mastering),
      ...tracks(p).map((t) => path(`public/${t.audioFile}`)),
      ...musicStem(p),
    ];
  }
  return [path(cfg.quality)];
}
export async function audio(p: Project, checkOnly = false, force = false) {
  if (!p.config.audio) {
    throw new Error('原型没有连续母带制作流程；请使用 capture，保留原型配音方式。');
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
    for (const path of [cfg.timeline, cfg.mastering, cfg.quality]) {
      mkdirSync(dirname(inside(p.root, path)), { recursive: true });
    }
    if (cfg.subtitlesDirectory) {
      mkdirSync(inside(p.root, cfg.subtitlesDirectory), { recursive: true });
    }
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
        cfg.driver === 'standard' || stage === 'align'
          ? [
              scripts[stage].endsWith('.py') && stage !== 'align' ? python : process.execPath,
              scripts[stage].endsWith('.py') && stage !== 'align'
                ? join(AUDIO, 'scripts', scripts[stage])
                : join(TOOLS, 'src/audio/standard.ts'),
              ...(!scripts[stage].endsWith('.py') || stage === 'align' ? [stage] : []),
              p.root,
              ...(stage === 'check' ? ['--require-raw'] : []),
            ]
          : [
              scripts[stage].endsWith('.py') ? python : process.execPath,
              `scripts/${scripts[stage]}`,
              ...(stage === 'check' ? ['--require-raw'] : []),
            ];
      console.log(`${p.id} audio:${stage}`);
      if (stage === 'voiceover' || stage === 'align') {
        // Both TTS backends share the GPU; one lock keeps their models from loading together.
        await locked('shared-audio-cpp', () => command(cmd, p.root, audioEnv(p)));
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
    if (cfg.driver === 'standard' && !checkOnly) {
      p.config.stage = 'production';
      atomicJSON(join(p.root, 'production.json'), p.config);
      prepareRuntime(p);
    }
    return results;
  });
}

export function assertMeasured(p: Project) {
  if (p.config.audio?.driver !== 'standard') {
    return;
  }
  if (p.frozen && p.config.runtime) {
    const timing = json<{ draft?: boolean }>(inside(p.root, p.config.runtime.timing));
    if (timing.draft) {
      throw new Error('源码快照仍是估算时间轴');
    }
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

export function audioStageStatus(p: Project) {
  if (!p.config.audio) {
    return [];
  }
  const db = database();
  try {
    return stages.map((stage) => {
      try {
        const key = inputs(p, stage);
        const previous = db
          .query('SELECT key,outputs FROM stages WHERE project=? AND stage=?')
          .get(p.id, stage) as { key: string; outputs: string } | null;
        const fresh = previous?.key === key && verifyMap(p.root, JSON.parse(previous.outputs));
        return { stage, key, fresh, reason: fresh ? undefined : '输入、工具或产物身份需要更新' };
      } catch (error) {
        return {
          stage,
          fresh: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
  } finally {
    db.close();
  }
}
