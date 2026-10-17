import { existsSync } from 'node:fs';
import { type Content, type Paragraph, readContent } from '../audio/content';
import { hashFile, inside, json } from '../lib/files';
import type { Project } from '../project';

const bounded = (value: string, limit = 320) => ({
  value: value.slice(0, limit),
  characters: value.length,
  truncated: value.length > limit,
  omittedCharacters: Math.max(0, value.length - limit),
});
interface Details {
  selectedSegment?: {
    id: string;
    path: string;
    sha256: string;
    complete: true;
    paragraph: Paragraph;
  };
  copy?: {
    path: string;
    exists: boolean;
    sha256?: string;
    title?: ReturnType<typeof bounded>;
    subtitle?: ReturnType<typeof bounded>;
  };
}

export function contentDetails(p: Project, task: string, segment?: string): Details {
  const path = p.config.audio?.content ?? 'content.json';
  const absolute = inside(p.root, path);
  const details: Details = {};
  if (segment) {
    const content = readContent(p);
    const paragraph = content.paragraphs.find((item) => item.id === segment);
    if (!paragraph) {
      throw new Error(
        `找不到语义段 ${segment}；--segment 使用 content.paragraphs[].id，不接受字幕行 ID`,
      );
    }
    if (JSON.stringify(paragraph).length > 24_000) {
      throw new Error(
        `语义段 ${segment} 超过 24000 字符交接上限；请先拆分过长语义段，本次没有截断返回`,
      );
    }
    details.selectedSegment = {
      id: segment,
      path,
      sha256: hashFile(absolute),
      complete: true,
      paragraph,
    };
  }
  if (task === 'cover') {
    if (!existsSync(absolute)) {
      return { ...details, copy: { path, exists: false } };
    }
    const content = json<Partial<Content>>(absolute);
    details.copy = {
      path,
      exists: true,
      sha256: hashFile(absolute),
      title: bounded(typeof content.title === 'string' ? content.title : ''),
      subtitle: bounded(typeof content.subtitle === 'string' ? content.subtitle : ''),
    };
  }
  return details;
}
