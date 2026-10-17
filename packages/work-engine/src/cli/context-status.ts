import { existsSync, readFileSync } from 'node:fs';
import { hashFile, inside } from '../lib/files';

const LIMIT = 2400;
const GAP = '\n[… omitted STATUS lines …]\n';
interface Range {
  start: number;
  end: number;
  roles: string[];
}

/** Preserve current decisions and recovery instructions without pretending this is the full log. */
export function statusExcerpt(root: string) {
  const path = 'docs/STATUS.md';
  const absolute = inside(root, path);
  const exists = existsSync(absolute);
  const text = exists ? readFileSync(absolute, 'utf8') : '';
  const lines = [...text.matchAll(/[^\n]*\n|[^\n]+$/g)].map((match) => ({
    text: match[0],
    start: match.index!,
    end: match.index! + match[0].length,
  }));
  const selected: Range[] = [];
  if (text.length <= LIMIT) {
    if (text.length) {
      selected.push({ start: 0, end: text.length, roles: ['complete'] });
    }
  } else {
    for (const [role, pattern, budget] of [
      ['current', /当前(?:状态|阶段|决定|输入)?|现状|current|latest/i, 550],
      ['next', /下一步|待办|接下来|next(?: steps?)?|todo/i, 600],
      ['resume', /恢复入口|制作接续|接续|恢复|resume|handoff|restart/i, 500],
    ] as const) {
      const matches = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => pattern.test(line.text));
      const headings = matches.filter(({ line }) => /^\s*#{1,6}\s/.test(line.text));
      const match = (headings.length ? headings : matches).at(-1);
      if (!match) {
        continue;
      }
      const following = lines.slice(match.index + 1).find((line) => /^\s*#{1,6}\s/.test(line.text));
      const end = Math.min(following?.start ?? text.length, match.line.start + budget);
      selected.push({ start: match.line.start, end, roles: [role] });
    }
    selected.push({ start: text.length - 500, end: text.length, roles: ['tail'] });
    const used = selected.reduce((sum, range) => sum + range.end - range.start, 0);
    selected.push({
      start: 0,
      end: Math.max(0, LIMIT - 4 * GAP.length - used),
      roles: ['opening'],
    });
  }
  const merged: Range[] = [];
  for (const range of selected.sort((a, b) => a.start - b.start)) {
    if (range.end <= range.start) {
      continue;
    }
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.roles.push(...range.roles);
    } else {
      merged.push({ ...range, roles: [...range.roles] });
    }
  }
  let excerpt = '';
  const fragments = merged.map((range, index) => {
    if (index) {
      excerpt += GAP;
    }
    const outputStartCharacter = excerpt.length;
    excerpt += text.slice(range.start, range.end);
    const start = lines.findIndex((line) => line.end > range.start);
    const end = lines.findIndex((line) => line.end >= range.end);
    return {
      startLine: start + 1,
      endLine: end + 1,
      startCharacter: range.start,
      endCharacter: range.end,
      partialStart: lines[start]?.start !== range.start,
      partialEnd: lines[end]?.end !== range.end,
      roles: [...new Set(range.roles)],
      outputStartCharacter,
      outputEndCharacter: excerpt.length,
    };
  });
  const includedCharacters = merged.reduce((sum, part) => sum + part.end - part.start, 0);
  return {
    path,
    exists,
    sha256: exists ? hashFile(absolute) : null,
    text: excerpt,
    characters: text.length,
    includedCharacters,
    omittedCharacters: text.length - includedCharacters,
    truncated: includedCharacters < text.length,
    limitCharacters: LIMIT,
    fragments,
  };
}
