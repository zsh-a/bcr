import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, code128BValues, code128Svg, encodeCode128B } from "../src/barcode";
import { mulberry32 } from "../src/hash";
import { pseudoQrMatrix, pseudoQrSvg, PSEUDO_QR_SIZE } from "../src/pseudoqr";

/** 把码值序列按编码表展开为 0/1 模块序列（测试侧的独立展开，用于交叉验证） */
function expand(values: ReadonlyArray<number>): number[] {
  const modules: number[] = [];
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (pattern === undefined) throw new Error(`bad value ${value}`);
    let bit = 1;
    for (const ch of pattern) {
      for (let i = 0; i < Number(ch); i++) modules.push(bit);
      bit = 1 - bit;
    }
  }
  return modules;
}

describe("Code128B", () => {
  it("已知向量：\"HI\" → [StartB=104, 40, 41, checksum=20, Stop=106]", () => {
    // checksum = (104 + 40*1 + 41*2) mod 103 = 226 mod 103 = 20
    expect(code128BValues("HI")).toEqual([104, 40, 41, 20, 106]);
  });

  it("已知向量：单字符 \"P\"", () => {
    // "P" = 80-32 = 48；checksum = (104 + 48) mod 103 = 49
    expect(code128BValues("P")).toEqual([104, 48, 49, 106]);
  });

  it("模块序列 = 编码表展开", () => {
    expect(encodeCode128B("HI")).toEqual(expand([104, 40, 41, 20, 106]));
  });

  it("模块总数 = 11×(码值数-1) + 13", () => {
    const text = "NHW260948213";
    const values = code128BValues(text);
    expect(encodeCode128B(text)).toHaveLength(11 * (values.length - 1) + 13);
  });

  it("序列以 StartB 图案开头（11010010000）", () => {
    const modules = encodeCode128B("A");
    expect(modules.slice(0, 11).join("")).toBe("11010010000");
  });

  it("非 ASCII 输入抛错", () => {
    expect(() => encodeCode128B("中文")).toThrow();
  });

  it("SVG 输出含矩形条且自包含", () => {
    const svg = code128Svg("ITL260973164", { moduleWidth: 4, height: 150 });
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("href=");
    expect(svg).not.toContain("src=");
  });
});

describe("pseudoQr（装饰性，不可扫描）", () => {
  it("同 seed 同矩阵；异 seed 大概率不同", () => {
    expect(pseudoQrMatrix("a")).toEqual(pseudoQrMatrix("a"));
    expect(pseudoQrMatrix("a")).not.toEqual(pseudoQrMatrix("b"));
  });

  it("三个角的 7×7 定位图案存在", () => {
    const grid = pseudoQrMatrix("seed-x");
    const n = PSEUDO_QR_SIZE;
    const corners: Array<[number, number]> = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ];
    for (const [ox, oy] of corners) {
      // 外圈全亮、内圈全暗、3×3 核心全亮
      expect(grid[oy]?.[ox]).toBe(true);
      expect(grid[oy]?.[ox + 6]).toBe(true);
      expect(grid[oy + 6]?.[ox]).toBe(true);
      expect(grid[oy + 1]?.[ox + 1]).toBe(false);
      expect(grid[oy + 3]?.[ox + 3]).toBe(true);
    }
  });

  it("SVG 确定性且含定位格", () => {
    const a = pseudoQrSvg("seed-1", { module: 9 });
    expect(a).toBe(pseudoQrSvg("seed-1", { module: 9 }));
    expect(a).toContain("<rect");
  });

  it("rng 确定性（mulberry32）", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
