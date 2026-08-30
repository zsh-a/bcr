import { describe, expect, it } from "vitest";
import { studio } from "../src/store";
import {
  cueCps,
  groupWordsToChunks,
  assignWords,
  wordJoin,
  type SubtitleCue,
} from "../src/subtitles";
import { toAss } from "../src/exporters";

const word = (start: number, end: number, text: string) => ({ start, end, text });

describe("store undo/redo（编辑历史）", () => {
  const cue = (text: string): SubtitleCue => ({ start: 0, end: 1, text });

  it("编辑进历史，undo/redo 对称", () => {
    studio.setSource(null);
    studio.setCues([cue("v1")], "demo");

    studio.patchCue(0, { text: "v2" });
    expect(studio.getSnapshot().cues[0]?.text).toBe("v2");
    expect(studio.getSnapshot().canUndo).toBe(true);

    studio.undo();
    expect(studio.getSnapshot().cues[0]?.text).toBe("v1");
    expect(studio.getSnapshot().canRedo).toBe(true);

    studio.redo();
    expect(studio.getSnapshot().cues[0]?.text).toBe("v2");

    // 新编辑截断 redo 分支
    studio.patchCue(0, { text: "v3" });
    expect(studio.getSnapshot().canRedo).toBe(false);
    studio.undo();
    studio.undo();
    expect(studio.getSnapshot().cues[0]?.text).toBe("v1");
    studio.setSource(null);
  });

  it("delete/split 同样可撤销；流水线产出重置历史", () => {
    studio.setSource(null);
    studio.setCues([cue("a"), cue("b")], "demo");
    studio.deleteCue(0);
    expect(studio.getSnapshot().cues).toHaveLength(1);
    studio.undo();
    expect(studio.getSnapshot().cues).toHaveLength(2);

    studio.splitCue(0, 0.5);
    expect(studio.getSnapshot().cues).toHaveLength(3);
    studio.undo();
    expect(studio.getSnapshot().cues).toHaveLength(2);

    studio.setCues([cue("fresh")], "whisper");
    expect(studio.getSnapshot().canUndo).toBe(false);
    studio.setSource(null);
  });
});

describe("CPS 超速检查", () => {
  it("含译文的显示速度", () => {
    expect(cueCps({ start: 0, end: 1, text: "hello world" })).toBeCloseTo(3, 5);
    // 译文计入
    expect(cueCps({ start: 0, end: 1, text: "hello world", translation: "你好世界" })).toBeCloseTo(
      7,
      5,
    );
    // 过短时长按下限 0.2s 保护
    expect(cueCps({ start: 0, end: 0.01, text: "abc def" })).toBeCloseTo(15, 5);
  });
});

describe("词级时间戳", () => {
  it("wordJoin：拉丁词加空格，CJK 相连", () => {
    expect(wordJoin([word(0, 0.2, "hello"), word(0.2, 0.4, "world")])).toBe("hello world");
    expect(wordJoin([word(0, 0.2, "你好"), word(0.2, 0.4, "世界")])).toBe("你好世界");
  });

  it("groupWordsToChunks：间隔超阈值断组，组内时长受限", () => {
    const words = [
      word(0, 0.3, "one"),
      word(0.3, 0.6, "two"),
      word(5.0, 5.3, "three"), // 间隔 4.4s → 新组
    ];
    const groups = groupWordsToChunks(words, 8, 0.8);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.text).toBe("one two");
    expect(groups[1]?.text).toBe("three");
    expect(groups[0]?.words).toHaveLength(2);
  });

  it("assignWords：词按起点归属 cue，区间外丢弃", () => {
    const cues: SubtitleCue[] = [
      { start: 0, end: 2, text: "first" },
      { start: 2, end: 4, text: "second" },
    ];
    const assigned = assignWords(cues, [
      word(0.1, 0.5, "one"),
      word(1.0, 1.5, "two"),
      word(2.2, 2.6, "three"),
      word(9, 9.5, "orphan"),
    ]);
    expect(assigned[0]?.words?.map((w) => w.text)).toEqual(["one", "two"]);
    expect(assigned[1]?.words?.map((w) => w.text)).toEqual(["three"]);
  });
});

describe("卡拉 OK ASS 导出", () => {
  it("带词的 cue 渲染 \\k 标签（厘秒），双语加 \\N 译文", () => {
    const cue: SubtitleCue = {
      start: 1,
      end: 2.5,
      text: "hello world",
      translation: "你好",
      words: [word(1, 1.6, "hello"), word(1.6, 2.4, "world")],
    };
    const ass = toAss([cue], "karaoke", { karaoke: true });
    expect(ass).toContain("{\\k60}hello {\\k80}world\\N你好");
  });

  it("无词 cue 忽略 karaoke 选项，退化为普通文本", () => {
    const cue: SubtitleCue = { start: 0, end: 1, text: "plain" };
    const ass = toAss([cue], "plain", { karaoke: true });
    expect(ass).toContain(",,plain");
    expect(ass).not.toContain("\\k");
  });
});
