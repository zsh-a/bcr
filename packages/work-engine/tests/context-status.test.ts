import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusExcerpt } from '../src/cli/context-status';
import { hashFile } from '../src/lib/files';

const root = mkdtempSync(join(tmpdir(), 'bcr-status-excerpt-'));
mkdirSync(join(root, 'docs'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('bounded status retains current, next, recovery and tail with exact source ranges and SHA', () => {
  const text = `# 创作状态\n${'过去的制作记录。\n'.repeat(500)}## 当前状态\n镜头尚未实现，模型检查已经通过。\n${'当前部分的历史补充。\n'.repeat(100)}## 下一步\n仅修改 opening 段落的转场。\n${'待办部分的详细背景。\n'.repeat(100)}## 恢复入口\n从 content opening 和 docs/storyboard.md 接续。\n${'恢复部分的背景记录。\n'.repeat(100)}## 历史\n${'旧记录。\n'.repeat(200)}最后确认：保留现有声线。\n`;
  writeFileSync(join(root, 'docs/STATUS.md'), text);
  const result = statusExcerpt(root);
  expect(result.text).toContain('镜头尚未实现');
  expect(result.text).toContain('仅修改 opening');
  expect(result.text).toContain('docs/storyboard.md 接续');
  expect(result.text).toContain('最后确认：保留现有声线');
  expect(result.text).toContain('omitted STATUS');
  expect(result.truncated).toBe(true);
  expect(result.includedCharacters).toBeLessThanOrEqual(2400);
  expect(result.text.length).toBeLessThanOrEqual(2400);
  expect(result.includedCharacters + result.omittedCharacters).toBe(text.length);
  expect(result.sha256).toBe(hashFile(join(root, 'docs/STATUS.md')));
  for (const fragment of result.fragments) {
    expect(result.text.slice(fragment.outputStartCharacter, fragment.outputEndCharacter)).toBe(
      text.slice(fragment.startCharacter, fragment.endCharacter),
    );
    expect(fragment.startLine).toBe(text.slice(0, fragment.startCharacter).split('\n').length);
    expect(fragment.endLine).toBe(text.slice(0, fragment.endCharacter - 1).split('\n').length);
  }
});

test('short status is complete and absent status is explicitly missing', () => {
  const text = '# 当前\n短交接。\n';
  writeFileSync(join(root, 'docs/STATUS.md'), text);
  const result = statusExcerpt(root);
  expect(result.text).toBe(text);
  expect(result.truncated).toBe(false);
  expect(result.omittedCharacters).toBe(0);
  rmSync(join(root, 'docs/STATUS.md'));
  expect(statusExcerpt(root).exists).toBe(false);
  expect(statusExcerpt(root).sha256).toBe(null);
});
