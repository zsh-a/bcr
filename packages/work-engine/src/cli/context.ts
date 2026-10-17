import { existsSync, readFileSync, statSync } from 'node:fs';
import { hashFile, inside } from '../lib/files';
import { targetScope, timingStatus } from '../pipeline/scope';
import { type Project, targetOf } from '../project';
import { reviewStatus } from '../review';
import { contextActions } from './context-actions';
import { contentDetails } from './context-details';
import { statusExcerpt } from './context-status';
import { summarizeData } from './context-summary';

export const contextTasks = [
  'resume',
  'review',
  'write',
  'model',
  'audio',
  'visual',
  'cover',
  'chapters',
  'deliver',
] as const;
export type ContextTask = (typeof contextTasks)[number];
type Read = { path: string; role: string; select?: string };
const file = (path: string, role: string, select?: string): Read => ({
  path,
  role,
  ...(select ? { select } : {}),
});

export function workContext(
  p: Project,
  task: string = 'resume',
  target?: string,
  segment?: string,
) {
  if (!contextTasks.includes(task as ContextTask)) {
    throw new Error(`--task 需要 ${contextTasks.join('|')}`);
  }
  const existing = (paths: string[]) =>
    paths.find((path) => {
      const absolute = inside(p.root, path);
      return existsSync(absolute) && statSync(absolute).isFile();
    });
  const coverTarget =
    p.work.targets.find((item) => item.id === 'cover') ??
    p.work.targets.find((item) => item.id === 'cover-4x3');
  if (task === 'cover' && !target && !coverTarget) {
    throw new Error('工程未声明 cover 或 cover-4x3 封面目标；自定义封面请显式指定 --target ID');
  }
  const t = targetOf(p, target ?? (task === 'cover' ? coverTarget!.id : undefined));
  const content = file(
    p.config.audio?.content ?? 'content.json',
    '正式标题与旁白',
    task === 'cover' ? 'title, subtitle' : '与当前修改相关的段落',
  );
  const brief = file(
    existing(['docs/brief.md', 'brief.md']) ?? 'docs/brief.md',
    '本期目标、受众、范围与约束',
  );
  const modelInputs = existing(['model-inputs.json']);
  const modelImplementation = existing([
    'src/model.ts',
    'model.js',
    'scripts/model.py',
    'src/model.js',
  ]);
  const brandAssets = existing(['video-assets.lock.json']);
  const sources = file('sources.json', '主张与来源', '与当前主张相关的记录');
  const storyboard = file('docs/storyboard.md', '解释链与正式镜头设计', '本轮镜头与相邻交接');
  const entry = file(t.entry, '当前目标画面入口');
  const required: Read[] = [];
  const onDemand: Read[] = [];
  switch (task as ContextTask) {
    case 'resume':
      required.push(brief);
      onDemand.push(content, storyboard, sources);
      break;
    case 'review':
      required.push(
        brief,
        {
          ...content,
          select: '通读完整文稿、论证和段落交接；指定语义段的局部核查不能替代回归通读',
        },
        sources,
      );
      onDemand.push(file('docs/argument-review.md', '论证边界与已知问题'), storyboard);
      if (modelInputs) {
        onDemand.push(file(modelInputs, '教学模型参数'));
      }
      break;
    case 'write':
      required.push(brief, content, sources);
      onDemand.push(file('docs/argument-review.md', '论证边界与已知问题'), storyboard);
      if (modelInputs) {
        onDemand.push(file(modelInputs, '教学模型参数'));
      }
      break;
    case 'model':
      if (modelInputs) {
        required.push(file(modelInputs, '教学模型参数'));
      }
      if (modelImplementation) {
        required.push(file(modelImplementation, '本期模型实现'));
      }
      required.push(sources);
      onDemand.push(
        file(
          'data.json',
          '原始数据；先看 dataSummary，再按路径查询',
          '仅查询待核查记录，禁止默认整文件读入',
        ),
        file('scripts/check-model.ts', '业务模型校验'),
        file('docs/argument-review.md', '主张与模型边界'),
      );
      break;
    case 'audio':
      required.push(
        content,
        file(p.config.audio?.voice ?? 'voice.json', '声音、生成与验收配置；参考音频为私有输入'),
      );
      if (p.config.audio) {
        onDemand.push(
          file(p.config.audio.plan, '生成、对齐与段落缓存记录', '变动段落'),
          file(p.config.audio.quality, '实测音频验收报告'),
        );
      }
      break;
    case 'visual':
      required.push(storyboard, entry);
      if (brandAssets) {
        required.push(file(brandAssets, '本期视觉资产与品牌选择', '当前目标使用的资产'));
      }
      if (p.config.runtime) {
        required.push(file(p.config.runtime.cues, '语义动作锚点', '本轮镜头'));
        onDemand.push(
          file(p.config.runtime.timing, '派生时序，只读', '本轮镜头相关片段'),
          file(p.config.runtime.events, '派生事件，只读', '本轮镜头相关动作'),
        );
      }
      if (p.config.scenes) {
        required.push(file(p.config.scenes.catalog, '镜头依赖与交接', '本轮镜头与相邻交接'));
      }
      onDemand.push(content);
      break;
    case 'cover':
      required.push(content, entry);
      if (brandAssets) {
        required.push(file(brandAssets, '本期视觉资产与品牌选择', '当前目标使用的资产'));
      }
      onDemand.push(file('docs/platform-description.md', '封面文案与平台标题'));
      break;
    case 'chapters':
      required.push(content, file('docs/platform-description.md', '平台章节与简介'));
      if (p.config.audio) {
        required.push(
          file(
            p.config.audio.timeline,
            '正式章节起点必须来自实测时间轴',
            'draft 标记、章节对应的段落起点',
          ),
        );
      }
      break;
    case 'deliver':
      required.push(file('docs/platform-description.md', '平台简介、章节与交付文案'));
      onDemand.push(
        file('.bcr/build/validation.json', '自动验收身份与报告'),
        file('.bcr/build/frozen.json', '冻结身份及人工审阅状态'),
      );
      break;
  }
  const describe = (item: Read, fingerprint = false) => {
    const path = inside(p.root, item.path);
    const exists = existsSync(path) && statSync(path).isFile();
    return {
      ...item,
      exists,
      bytes: exists ? statSync(path).size : null,
      ...(fingerprint ? { sha256: exists ? hashFile(path) : null } : {}),
    };
  };
  const dataPath = inside(p.root, 'data.json');
  let dataSummary: unknown;
  if (task === 'model' && existsSync(dataPath)) {
    const text = readFileSync(dataPath, 'utf8');
    try {
      dataSummary = {
        path: 'data.json',
        bytes: statSync(dataPath).size,
        characters: text.length,
        ...summarizeData(JSON.parse(text)),
      };
    } catch {
      dataSummary = {
        path: 'data.json',
        bytes: statSync(dataPath).size,
        characters: text.length,
        $omitted: true,
        reason: 'invalid-json; inspect and fix only the relevant source',
      };
    }
  }
  const timing = timingStatus(p);
  return {
    version: 1,
    project: p.id,
    title: p.work.title ?? p.id,
    root: p.root,
    stage: p.config.stage ?? 'unspecified',
    task,
    target: {
      id: t.id,
      entry: t.entry,
      width: t.width,
      height: t.height,
      durationInFrames: t.durationInFrames,
    },
    timing,
    scope: targetScope(p, t),
    status: statusExcerpt(p.root),
    ...contentDetails(p, task, segment),
    ...contextActions(p, t, task, timing.mode === 'measured'),
    reviews: reviewStatus(p, t),
    ...(task === 'review'
      ? {
          readingRequirement: {
            scope: 'full-script',
            required: true,
            note: '定向语义段只用于局部检查，回归审稿仍需通读完整文稿。',
          },
        }
      : {}),
    reads: {
      required: required.map((item) => describe(item, true)),
      onDemand: onDemand.map((item) => describe(item)),
      configuration: [
        file('work.json', '目标与作品身份，当前关键字段已在本交接中'),
        file('production.json', '制作声明，修改相关配置时再读'),
        ...(!required.some((item) => item.path === 'video-assets.lock.json')
          ? [file('video-assets.lock.json', '本期视觉资产与品牌选择；不存在时不要猜测其他锁文件名')]
          : []),
      ].map((item) => describe(item)),
    },
    ...(dataSummary ? { dataSummary } : {}),
    policy:
      'Read only the files and selections needed for this task. Missing optional files are not production blockers. STATUS/storyboard remain authoritative; model/type checks and fresh timing do not establish final visual or human review readiness. Never use draft timing for final delivery or chapters. Private voice/media stay local; do not load audio or raw data records into agent context.',
  };
}
