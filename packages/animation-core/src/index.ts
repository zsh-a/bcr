export type Keyframe = readonly [frame: number, value: number];
export type Keyframes = readonly Keyframe[];
export type Interpolation = 'smooth' | 'linear' | 'step';
export type NumericPose = Record<string, number>;

export function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothStep(value: number): number {
  const t = clamp(finite(value, 'progress'));
  return t * t * (3 - 2 * t);
}

export function progress(frame: number, start: number, durationFrames = 24): number {
  finite(frame, 'frame');
  finite(start, 'start');
  if (finite(durationFrames, 'durationFrames') <= 0) {
    throw new Error('durationFrames must be positive');
  }
  return smoothStep((frame - start) / durationFrames);
}

/** Compile once; samples hold boundary values and never depend on the previous frame. */
export function compileTrack(keys: Keyframes, interpolation: Interpolation = 'smooth') {
  if (!keys.length) {
    throw new Error('A track needs at least one keyframe');
  }
  if (!['smooth', 'linear', 'step'].includes(interpolation)) {
    throw new Error(`Unknown interpolation: ${interpolation}`);
  }
  const points = keys.map(([frame, value], index) => {
    finite(frame, 'keyframe');
    finite(value, 'value');
    if (index && frame <= keys[index - 1][0]) {
      throw new Error('Keyframes must have strictly increasing frames');
    }
    return [frame, value] as const;
  });
  return (frame: number): number => {
    finite(frame, 'frame');
    if (frame <= points[0][0]) {
      return points[0][1];
    }
    for (let i = 1; i < points.length; i++) {
      const [end, b] = points[i];
      const [start, a] = points[i - 1];
      if (frame <= end) {
        if (interpolation === 'step') {
          return frame === end ? b : a;
        }
        const t = (frame - start) / (end - start);
        return a + (b - a) * (interpolation === 'smooth' ? smoothStep(t) : t);
      }
    }
    return points[points.length - 1][1];
  };
}

export function gaussianPulse(frame: number, center: number, widthFrames = 2.3): number {
  finite(frame, 'frame');
  finite(center, 'center');
  if (finite(widthFrames, 'widthFrames') <= 0) {
    throw new Error('widthFrames must be positive');
  }
  return Math.exp(-(((frame - center) / widthFrames) ** 2));
}

export type AnimationLayer<T extends NumericPose> = {
  id: string;
  start: number;
  durationFrames: number;
  tracks: Partial<Record<keyof T, Keyframes>>;
  interpolation?: Interpolation;
  priority?: number;
  mode?: 'replace' | 'add';
  weight?: Keyframes;
  /** Keep the final sample until another layer replaces it. Defaults to true. */
  hold?: boolean;
};

/** Scalar-channel mixing shared by SVG, 3D adapters and offline scene builders. */
export function compileAnimation<T extends NumericPose>(
  base: T,
  layers: readonly AnimationLayer<T>[],
): (frame: number) => T {
  const initial = { ...base };
  for (const [channel, value] of Object.entries(initial)) {
    finite(value, channel);
  }
  const ids = new Set<string>();
  const compiled = layers
    .map((layer, order) => {
      if (!layer.id || ids.has(layer.id)) {
        throw new Error('Animation layer IDs must be nonempty and unique');
      }
      ids.add(layer.id);
      finite(layer.start, 'start');
      if (finite(layer.durationFrames, 'durationFrames') <= 0) {
        throw new Error('durationFrames must be positive');
      }
      finite(layer.priority ?? 0, 'priority');
      const tracks = Object.entries(layer.tracks).map(([channel, keys]) => {
        if (!Object.hasOwn(initial, channel)) {
          throw new Error(`Unknown animation channel: ${channel}`);
        }
        return [channel as keyof T, compileTrack(keys as Keyframes, layer.interpolation)] as const;
      });
      return {
        start: layer.start,
        durationFrames: layer.durationFrames,
        priority: layer.priority ?? 0,
        mode: layer.mode ?? 'replace',
        hold: layer.hold ?? true,
        order,
        tracks,
        weight: layer.weight ? compileTrack(layer.weight, 'linear') : () => 1,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.start - b.start || a.order - b.order);

  return (frame: number): T => {
    finite(frame, 'frame');
    const pose = { ...initial };
    for (const layer of compiled) {
      const local = frame - layer.start;
      if (local < 0 || (!layer.hold && local >= layer.durationFrames)) {
        continue;
      }
      const sample = Math.min(local, layer.durationFrames);
      const weight = clamp(layer.weight(sample));
      for (const [channel, track] of layer.tracks) {
        const value = track(sample);
        pose[channel] = (
          layer.mode === 'add'
            ? pose[channel] + value * weight
            : pose[channel] + (value - pose[channel]) * weight
        ) as T[keyof T];
      }
    }
    return pose;
  };
}
