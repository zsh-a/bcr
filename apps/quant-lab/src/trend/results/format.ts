export const priceDigits = (tick: number) => {
  const [coefficient, exponent] = tick.toString().split("e");
  return Math.min(
    12,
    Math.max(0, (coefficient?.split(".")[1]?.length ?? 0) - Number(exponent ?? 0)),
  );
};
