/** Keep calculations deterministic and independent from the visual components. */
export function result({ value }) {
  return { value: Number(value), doubled: Number(value) * 2 };
}
