import { describe, expect, test } from 'bun:test';
import { compileAnimation, compileTrack, gaussianPulse, progress } from '../src/index.js';

describe('frame-driven animation', () => {
  test('tracks hold boundaries and reject malformed keyframes', () => {
    const sample = compileTrack([
      [0, 10],
      [10, 30],
    ]);
    expect([sample(-20), sample(5), sample(90)]).toEqual([10, 20, 30]);
    expect(() => compileTrack([])).toThrow();
    expect(() =>
      compileTrack([
        [0, 1],
        [0, 2],
      ]),
    ).toThrow();
    expect(() => compileTrack([[0, Number.NaN]])).toThrow();
    expect(() => sample(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => progress(1, 0, 0)).toThrow();
  });

  test('linear and step interpolation preserve exact keyframe boundaries', () => {
    expect(
      compileTrack(
        [
          [0, 0],
          [10, 20],
        ],
        'linear',
      )(2),
    ).toBe(4);
    const step = compileTrack(
      [
        [0, 0],
        [10, 20],
      ],
      'step',
    );
    expect(step(9)).toBe(0);
    expect(step(10)).toBe(20);
    expect(gaussianPulse(10, 10)).toBe(1);
    expect(() => gaussianPulse(10, 10, 0)).toThrow();
  });

  test('overlapping weighted and additive layers seek independently', () => {
    const base = { x: 0, gaze: 0 };
    const sample = compileAnimation(base, [
      {
        id: 'walk',
        start: 0,
        durationFrames: 10,
        tracks: {
          x: [
            [0, 0],
            [10, 100],
          ],
        },
      },
      {
        id: 'look',
        start: 2,
        durationFrames: 8,
        tracks: {
          gaze: [
            [0, 0],
            [8, 1],
          ],
        },
      },
      {
        id: 'interrupt',
        start: 10,
        durationFrames: 10,
        priority: 1,
        tracks: { x: [[0, 200]] },
        weight: [
          [0, 0],
          [10, 1],
        ],
      },
      {
        id: 'offset',
        start: 10,
        durationFrames: 10,
        priority: 2,
        mode: 'add',
        tracks: { x: [[0, 5]] },
      },
    ]);
    expect(sample(15)).toEqual({ x: 155, gaze: 1 });
    sample(100);
    expect(sample(15)).toEqual({ x: 155, gaze: 1 });
    expect(sample(10).x).toBe(105);
    expect(sample(-1)).toEqual(base);
    expect(base).toEqual({ x: 0, gaze: 0 });
  });

  test('temporary layers expire and compiled tracks do not retain mutable input', () => {
    const keys: [number, number][] = [[0, 5]];
    const sample = compileAnimation({ x: 0 }, [
      { id: 'temporary', start: 5, durationFrames: 5, hold: false, tracks: { x: keys } },
    ]);
    keys[0][1] = 99;
    expect(sample(9).x).toBe(5);
    expect(sample(10).x).toBe(0);
    expect(() =>
      compileAnimation({ x: 0 }, [{ id: 'bad', start: 0, durationFrames: 0, tracks: {} }]),
    ).toThrow();
  });
});
