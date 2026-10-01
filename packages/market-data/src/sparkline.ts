function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** 仅供明确标记的演示 fixture 使用，不代表真实历史价格。 */
export function quoteSparkline(
  key: string,
  price: number,
  changePercent: number,
  points = 28,
): ReadonlyArray<number> {
  let seed = hashText(key);
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const previous = price / Math.max(0.05, 1 + changePercent / 100);
  const values = Array.from({ length: points }, (_, index) => {
    const progress = index / Math.max(1, points - 1);
    const bridge = previous + (price - previous) * progress;
    const taper = Math.sin(progress * Math.PI);
    return bridge * (1 + (random() - 0.5) * 0.009 * taper);
  });
  values[points - 1] = price;
  return values;
}
