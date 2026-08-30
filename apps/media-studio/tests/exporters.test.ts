import { describe, expect, it } from "vitest";
import {
  assTimestamp,
  exportSubtitles,
  srtTimestamp,
  toAss,
  toSrt,
  toVtt,
  vttTimestamp,
} from "../src/exporters";
import { alignTranslations, cueLength, normalizeCues, type SubtitleCue } from "../src/subtitles";

describe("时间戳格式化", () => {
  it("SRT 用逗号毫秒", () => {
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(3661.5)).toBe("01:01:01,500");
    expect(srtTimestamp(59.9994)).toBe("00:00:59,999");
    // 进位：59.9996 → 1,000ms → 秒进位
    expect(srtTimestamp(59.9996)).toBe("00:01:00,000");
    expect(srtTimestamp(-1)).toBe("00:00:00,000");
  });

  it("VTT 用点毫秒，ASS 用厘秒", () => {
    expect(vttTimestamp(3661.5)).toBe("01:01:01.500");
    expect(assTimestamp(3661.5)).toBe("1:01:01.50");
    expect(assTimestamp(0.999)).toBe("0:00:01.00");
    expect(assTimestamp(7.2)).toBe("0:00:07.20");
  });
});

describe("toSrt / toVtt / toAss", () => {
  const cues: SubtitleCue[] = [
    { start: 0, end: 1.5, text: "Hello world", translation: "你好，世界" },
    { start: 2, end: 4, text: "Second line" },
  ];

  it("SRT：序号 + 时间轴 + 空行分隔，双语第二行", () => {
    const srt = toSrt(cues);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello world\n你好，世界");
    expect(srt).toContain("2\n00:00:02,000 --> 00:00:04,000\nSecond line");
    expect(srt.endsWith("\n")).toBe(true);
  });

  it("VTT 带 WEBVTT 头", () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.500");
  });

  it("ASS：Dialogue 行字段完整，双语用 \\N", () => {
    const ass = toAss(cues, "demo");
    expect(ass).toContain("Title: demo");
    expect(ass).toContain(
      "Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Hello world\\N你好，世界",
    );
    expect(ass).toContain("Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,Second line");
  });

  it("exportSubtitles 统一分发", () => {
    expect(exportSubtitles([], "vtt")).toBe("WEBVTT\n\n");
    expect(exportSubtitles(cues, "srt")).toBe(toSrt(cues));
  });
});

describe("normalizeCues（subtitle.segment 核心）", () => {
  it("清洗空段与无效时间", () => {
    const cues = normalizeCues([
      { start: 0, end: 1, text: "  hi  " },
      { start: 2, end: 2, text: "invalid" },
      { start: 3, end: 4, text: "" },
    ]);
    expect(cues).toEqual([{ start: 0, end: 1, text: "hi" }]);
  });

  it("超长段按时长拆分，时间轴按比例切", () => {
    const cues = normalizeCues([{ start: 0, end: 10, text: "aaaa bbbb cccc dddd" }], {
      maxDurationS: 2.5,
      maxChars: 100,
    });
    expect(cues.length).toBe(4);
    expect(cues[0]?.start).toBe(0);
    expect(cues[1]?.start).toBeCloseTo(2.5, 5);
    expect(cues[3]?.end).toBe(10);
  });

  it("CJK 长文本按字符上限拆分", () => {
    const text = "这是一段特别长的中文台词需要被拆分成多条字幕"; // 22 个汉字
    const cues = normalizeCues([{ start: 0, end: 3, text }], { maxDurationS: 10, maxChars: 10 });
    expect(cues.length).toBeGreaterThanOrEqual(2);
    for (const cue of cues) {
      expect(cueLength(cue.text)).toBeLessThanOrEqual(10);
    }
  });

  it("过短碎片并入前一条", () => {
    const cues = normalizeCues(
      [
        { start: 0, end: 2, text: "hello there" },
        { start: 2, end: 2.5, text: "ok" },
      ],
      { maxDurationS: 5, maxChars: 30 },
    );
    expect(cues.length).toBe(1);
    expect(cues[0]?.text).toBe("hello there ok");
    expect(cues[0]?.end).toBe(2.5);
  });
});

describe("alignTranslations（双语对齐）", () => {
  it("按时间重叠回填译文", () => {
    const cues = normalizeCues([
      { start: 0, end: 2, text: "one" },
      { start: 2, end: 4, text: "two" },
    ]);
    const aligned = alignTranslations(cues, [
      { start: 0.5, end: 1.8, text: " eins " },
      { start: 2.5, end: 4, text: "zwei" },
    ]);
    expect(aligned[0]?.translation).toBe("eins");
    expect(aligned[1]?.translation).toBe("zwei");
  });

  it("无重叠时保持原样（无 translation 字段）", () => {
    const cues: SubtitleCue[] = [{ start: 0, end: 1, text: "solo" }];
    const aligned = alignTranslations(cues, [{ start: 10, end: 11, text: "far away" }]);
    expect(aligned[0]).not.toHaveProperty("translation");
  });
});
