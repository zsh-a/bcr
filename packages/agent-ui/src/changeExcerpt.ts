/** Linear-time changed range: trim equal outer lines, retaining every changed line. */
export function changeExcerpt(before: string, after: string) {
  const original = before.split("\n"),
    replacement = after.split("\n");
  let start = 0,
    end = 0;
  while (
    start < original.length &&
    start < replacement.length &&
    original[start] === replacement[start]
  )
    start++;
  while (
    end < original.length - start &&
    end < replacement.length - start &&
    original[original.length - 1 - end] === replacement[replacement.length - 1 - end]
  )
    end++;
  return {
    before: original.slice(start, original.length - end).join("\n"),
    after: replacement.slice(start, replacement.length - end).join("\n"),
    unchanged: before === after,
    omitted: start + end,
  };
}
