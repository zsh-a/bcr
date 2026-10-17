import { dirname } from 'node:path';
import type { Project, Target } from '../project';

export function contextActions(p: Project, t: Target, task: string, measured: boolean) {
  const action = (
    id: string,
    command: string,
    reason: string,
    args: string[] = [],
    target = false,
  ) => ({
    id,
    argv: [
      'bcr-work',
      '--root',
      dirname(p.root),
      command,
      p.id,
      ...(target ? ['--target', t.id] : []),
      ...args,
    ],
    cwd: p.root,
    reason,
  });
  const blockers =
    task === 'chapters' && !measured
      ? [
          {
            code: 'measured-timing-required',
            message:
              '当前时序为草稿或缺失，不能编写正式章节时码；先完成已获授权的旁白、对齐及实测时序。',
          },
        ]
      : [];
  const actions =
    task === 'cover' || task === 'visual'
      ? [
          action('preview', 'preview', '查看当前目标画面', [], true),
          action(
            'capture',
            'capture',
            '捕获当前目标代表帧；封面默认第 0 帧',
            ['--frame', '0'],
            true,
          ),
        ]
      : task === 'chapters' && !measured
        ? [
            action(
              'audio-context',
              'context',
              '先查看正式音频所需输入与当前工作范围',
              ['--task', 'audio'],
              true,
            ),
          ]
        : [action('plan', 'plan', '检查当前目标技术依赖；不执行制作', [], true)];
  return { actions, blockers };
}
