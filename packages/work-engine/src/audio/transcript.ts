import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { inside } from '../lib/files';
import { assertWritableOutput } from '../lib/output';
import type { Project } from '../project';
import { readContent } from './content';

export function transcript(p: Project, output?: string) {
  const content = readContent(p);
  const text = `${[
    '# 正式旁白',
    content.title,
    ...content.paragraphs.flatMap((paragraph) => [
      `### ${paragraph.id}`,
      paragraph.lines.map((line) => line.text).join(''),
    ]),
  ].join('\n\n')}\n`;
  const path = assertWritableOutput(inside(p.root, output ?? '.bcr/build/text/narration.md'));
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
    writeFileSync(path, text);
  }
  return { project: p.id, path, paragraphs: content.paragraphs.length };
}
