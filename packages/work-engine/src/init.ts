import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { type Content, draftTimeline, type VoiceSettings } from './audio/content';
import { atomicJSON, inside, json, walk } from './lib/files';
import { dependencyPath, ROOT, TOOLS } from './lib/paths';
import { command } from './lib/process';
import { type Config, validateProjectId, type Work, workspace } from './project';
import { locked } from './state/lock';

export interface InitOptions {
  title?: string | undefined;
  install?: boolean | undefined;
}

interface InitContext {
  root?: string;
  install?: (path: string) => Promise<unknown>;
}

function pathExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

function templatePackage(id: string) {
  const manager = json<{
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    packageManager: string;
  }>(join(TOOLS, 'package.json'));
  const versions = { ...manager.dependencies, ...manager.devDependencies };
  const select = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, versions[name]]));
  const cli = 'bcr-work --root ..';
  return {
    name: id,
    private: true,
    type: 'module',
    packageManager: manager.packageManager,
    scripts: {
      typecheck: 'tsc --noEmit',
      lint: 'biome check .',
      format: 'biome check --write .',
      preview: `${cli} preview ${id}`,
      'preview:draft': `${cli} draft ${id}`,
      'audio:build': `${cli} audio ${id}`,
      'audio:check': `${cli} audio ${id} --check`,
      'production:check': `${cli} check ${id}`,
      'render:av1': `${cli} render ${id}`,
    },
    dependencies: select(['@remotion/player', 'react', 'react-dom', 'remotion']),
    devDependencies: select(['@biomejs/biome', '@types/react', '@types/react-dom', 'typescript']),
  };
}

function scaffold(root: string, id: string, title: string) {
  const source = join(TOOLS, 'templates/video');
  for (const file of walk(source)) {
    const name = relative(source, file);
    const destination = join(root, name === 'biome.template.json' ? 'biome.json' : name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
  for (const folder of ['public/audio', 'public/fonts', '.bcr/narration', 'qa']) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const content: Content = {
    title,
    subtitle: '写下本期要回答的具体问题',
    paragraphs: [
      {
        id: 'opening',
        gapAfter: 0,
        lines: [
          {
            id: 'opening-question',
            chapter: 'opening',
            text: '这里是口播草稿。先写清观众的问题，再用具体例子解释原因。',
            caption: '先写清观众的问题，\n再用具体例子解释原因。',
          },
        ],
      },
    ],
  };
  const timeline = draftTimeline(content, 30);
  const work: Work = {
    format: 'bcr-project-1',
    id,
    title,
    defaultTarget: 'main',
    targets: [
      {
        id: 'main',
        runtime: 'remotion',
        entry: 'src/Scene.tsx',
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: timeline.main.durationInFrames,
      },
      {
        id: 'cover',
        runtime: 'remotion',
        entry: 'src/Cover.tsx',
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 1,
      },
      {
        id: 'cover-4x3',
        runtime: 'remotion',
        entry: 'src/Cover.tsx',
        width: 1600,
        height: 1200,
        fps: 30,
        durationInFrames: 1,
      },
    ],
  };
  const config: Config = {
    version: 1,
    stage: 'draft',
    privateAssets: ['audio/reference.wav'],
    audio: {
      driver: 'standard',
      content: 'content.json',
      voice: 'voice.json',
      timeline: 'audio-timeline.json',
      plan: '.bcr/narration/plan.json',
      mastering: 'audio-mastering.json',
      quality: 'audio-quality.json',
      score: 'public/audio/score.flac',
    },
    targets: { main: { audio: 'audio/mix-main.flac' }, cover: {}, 'cover-4x3': {} },
  };
  const voice: VoiceSettings = {
    referenceTranscript: '',
    language: 'Chinese',
    endpoint: 'http://localhost:8000',
    model: 'Qwen3-TTS-12Hz-1.7B-Base',
    mastering: { loudnessLUFS: -16, truePeakDBTP: -1.5 },
    quality: {
      maxCaptionWidth: 24,
      maxCaptionCharactersPerSecond: 12,
      maxParagraphGapSeconds: 1.2,
      maxInternalSilenceSeconds: 0.8,
      maxCharactersPerMinute: 320,
    },
  };
  for (const [file, value] of Object.entries({
    'work.json': work,
    'production.json': config,
    'content.json': content,
    'voice.json': voice,
    'audio-timeline.json': timeline,
    'package.json': templatePackage(id),
  })) {
    atomicJSON(join(root, file), value);
  }
  writeFileSync(
    join(root, 'docs/brief.md'),
    `# ${title}\n\n- 观众：待填写\n- 核心问题：待填写\n- 主张与理由：待填写\n- 具体例子：待填写\n- 最强异议与边界：待填写\n\n当前内容和时间轴均为草稿，正式时长由实际旁白决定。\n`,
  );
}

/** Create an independent Work atomically, using the same template for every entry point. */
export async function createProject(
  destination: string,
  id: string,
  options: InitOptions = {},
  context: InitContext = {},
) {
  validateProjectId(id);
  const title = options.title?.trim() ?? id;
  if (!title || title.length > 200 || title.includes('\0')) {
    throw new Error('标题必须为 1–200 个字符且不能包含 NUL');
  }
  const root = dirname(destination);
  mkdirSync(root, { recursive: true });
  const install =
    context.install ??
    ((path: string) => command([process.execPath, 'install', '--ignore-scripts'], path, {}, true));
  return locked(`create:${destination}`, async () => {
    if (pathExists(destination)) {
      throw new Error(`工程 ID 或目录已存在，拒绝覆盖: ${id}`);
    }
    const stage = join(root, `.init-${id}-${randomUUID()}`);
    mkdirSync(stage);
    let published = false;
    try {
      scaffold(stage, id, title);
      // Format the generated JSON as well as template sources before users start editing.
      await command(
        [
          process.execPath,
          join(dependencyPath('@biomejs/biome'), 'bin/biome'),
          'check',
          '--write',
          '.',
        ],
        stage,
        {},
        true,
      );
      if (options.install !== false) {
        await install(stage);
      }
      if (pathExists(destination)) {
        throw new Error(`创建期间目录被占用: ${id}`);
      }
      renameSync(stage, destination);
      published = true;
      return {
        project: id,
        title,
        path: destination,
        stage: 'draft',
        dependenciesInstalled: options.install !== false,
        targets: ['main', 'cover', 'cover-4x3'],
      };
    } catch (error) {
      if (published) {
        rmSync(destination, { recursive: true, force: true });
      }
      throw error;
    } finally {
      if (existsSync(stage)) {
        rmSync(stage, { recursive: true, force: true });
      }
    }
  });
}

/** Register only a completely created Work; concurrent registry changes remain intact. */
export async function initProject(
  id: string,
  options: InitOptions = {},
  context: InitContext = {},
) {
  validateProjectId(id);
  const root = context.root ?? ROOT;
  return locked(`workspace-init:${root}`, async () => {
    if (workspace(root).projects.some((entry) => entry.id === id)) {
      throw new Error(`工程 ID 或目录已存在，拒绝覆盖: ${id}`);
    }
    const destination = inside(root, id);
    const result = await createProject(destination, id, options, context);
    try {
      const latest = workspace(root);
      if (latest.projects.some((entry) => entry.id === id)) {
        throw new Error(`创建期间 ID 已被登记: ${id}`);
      }
      atomicJSON(join(root, 'workspace.json'), {
        ...latest,
        projects: [...latest.projects, { id, role: 'active' }],
      });
      return result;
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  });
}
