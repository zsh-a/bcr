import type { Vector3 } from "./types";

export const dot = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (p: Vector3): Vector3 => {
  const length = Math.hypot(...p);
  if (length < 1e-8)
    throw new RangeError("Camera direction and up must be nonzero and not parallel");
  return [p[0] / length, p[1] / length, p[2] / length];
};

/** Perspective fit in camera space, including depth; usable without Three.js or DOM. */
export function fitCamera(
  points: readonly Vector3[],
  target: Vector3,
  direction: Vector3,
  worldUp: Vector3,
  fov: number,
  aspect: number,
  padding: number,
) {
  const forward = unit(direction);
  const right = unit(cross(worldUp, forward));
  const up = cross(forward, right);
  const tanY = Math.tan((fov * Math.PI) / 360) * (1 - padding);
  const tanX = tanY * aspect;
  let distance = 0.01;
  for (const point of points) {
    const p: Vector3 = [point[0] - target[0], point[1] - target[1], point[2] - target[2]];
    distance = Math.max(
      distance,
      Math.abs(dot(p, right)) / tanX + dot(p, forward),
      Math.abs(dot(p, up)) / tanY + dot(p, forward),
    );
  }
  const position: Vector3 = [
    target[0] + forward[0] * distance,
    target[1] + forward[1] * distance,
    target[2] + forward[2] * distance,
  ];
  return { position, direction: forward, right, up, distance };
}
