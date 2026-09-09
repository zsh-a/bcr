/**
 * 原生 Code128B 编码器（无任何外部依赖）。
 * 输入 ASCII（可打印区间 32–126），输出 0/1 模块序列（1 = 黑条，0 = 空白），
 * 另附一个把模块序列画成内联 SVG 的 helper（供账单 HTML 直接嵌入）。
 *
 * 编码表 / 校验位（mod 103）按 Code 128 标准实现。
 */

/** 每个值（0–105）的条空宽度序列（条、空交替，共 6 段）；106 为终止符（7 段，含末尾 2 宽条） */
export const CODE128_PATTERNS: ReadonlyArray<string> = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

/** 返回完整的码值序列：[StartB, ...data, checksum, Stop] */
export function code128BValues(text: string): number[] {
  const values: number[] = [START_B];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error(`Code128B only supports printable ASCII, got char code ${code}`);
    }
    values.push(code - 32);
  }
  let checksum = START_B;
  for (let i = 0; i < text.length; i++) {
    checksum += (text.charCodeAt(i) - 32) * (i + 1);
  }
  values.push(checksum % 103);
  values.push(STOP);
  return values;
}

/** 编码为 0/1 模块序列（1 = 条，0 = 空） */
export function encodeCode128B(text: string): number[] {
  const modules: number[] = [];
  for (const value of code128BValues(text)) {
    const pattern = CODE128_PATTERNS[value];
    if (pattern === undefined) throw new Error(`missing pattern for value ${value}`);
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern.charCodeAt(i) - 48;
      const bit = i % 2 === 0 ? 1 : 0;
      for (let w = 0; w < width; w++) modules.push(bit);
    }
  }
  return modules;
}

export interface Code128SvgOptions {
  /** 单个模块宽度 px（账单画布下建议 3–4） */
  readonly moduleWidth: number;
  readonly height: number;
  /** 两侧静区（模块数），标准 ≥10 */
  readonly quietZone?: number;
  readonly color?: string;
}

/** 把 payload 渲染为内联 SVG 字符串（自包含，无外部资源） */
export function code128Svg(text: string, opts: Code128SvgOptions): string {
  const modules = encodeCode128B(text);
  const quiet = opts.quietZone ?? 10;
  const mw = opts.moduleWidth;
  const totalWidth = (modules.length + quiet * 2) * mw;
  const color = opts.color ?? "#101418";
  const rects: string[] = [];
  let run = -1;
  for (let i = 0; i <= modules.length; i++) {
    const bit = modules[i] ?? 0;
    if (bit === 1 && run < 0) run = i;
    if (bit === 0 && run >= 0) {
      rects.push(
        `<rect x="${(run + quiet) * mw}" y="0" width="${(i - run) * mw}" height="${opts.height}" fill="${color}"/>`,
      );
      run = -1;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${opts.height}" ` +
    `viewBox="0 0 ${totalWidth} ${opts.height}" role="img" aria-label="barcode">` +
    rects.join("") +
    `</svg>`
  );
}
