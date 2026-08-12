import {describe, expect, test} from 'bun:test';
import {
  addRipple,
  createRipple,
  getRippleTiming,
  pruneExpiredRipples,
  renderRippleFrame,
} from '../../src/utils/reactive-lighting/engine';
import type {
  ReactiveLed,
  RippleInstance,
} from '../../src/utils/reactive-lighting/types';

const led: ReactiveLed = {
  keyIndex: 0,
  matrixIndex: 0,
  row: 0,
  col: 0,
  ledIndex: 7,
  x: 0,
  y: 0,
};

const ripple = (
  id: string,
  startedAt: number,
  durationMs = 900,
): RippleInstance =>
  createRipple({
    id,
    originLedIndex: led.ledIndex,
    originX: led.x,
    originY: led.y,
    startedAt,
    durationMs,
    color: {r: 160, g: 80, b: 40},
  });

describe('concurrent ripple engine', () => {
  test('keeps an independent elapsed time and progress for every ripple', () => {
    const ripples = [ripple('A', 0), ripple('B', 200)];

    expect(getRippleTiming(ripples[0], 300)).toMatchObject({
      elapsedMs: 300,
      progress: 1 / 3,
    });
    expect(getRippleTiming(ripples[1], 300)).toMatchObject({
      elapsedMs: 100,
      progress: 1 / 9,
    });
  });

  test('adding B does not reset or mutate A', () => {
    const originalA = ripple('A', 0);
    const before = getRippleTiming(originalA, 200);
    const first = addRipple([], originalA, 64, 0);
    const second = addRipple(first.ripples, ripple('B', 200), 64, 200);
    const retainedA = second.ripples[0];

    expect(second.accepted).toBe(true);
    expect(retainedA).toBe(originalA);
    expect(retainedA).toMatchObject({
      id: 'A',
      startedAt: 0,
      durationMs: 900,
    });
    expect(getRippleTiming(retainedA, 200)).toEqual(before);
  });

  test('keeps repeated presses on the same origin as independent instances', () => {
    const firstPress = ripple('same-key-1', 0);
    const secondPress = ripple('same-key-2', 200);
    const first = addRipple([], firstPress, 64, 0);
    const second = addRipple(first.ripples, secondPress, 64, 200);

    expect(second.ripples).toEqual([firstPress, secondPress]);
    expect(getRippleTiming(second.ripples[0], 300).elapsedMs).toBe(300);
    expect(getRippleTiming(second.ripples[1], 300).elapsedMs).toBe(100);
  });

  test('prunes each expired ripple without removing a younger one', () => {
    const expired = ripple('expired', 0, 100);
    const current = ripple('current', 75, 500);

    expect(pruneExpiredRipples([expired, current], 150)).toEqual([current]);
  });

  test('screen-blends overlapping ripples deterministically and within bounds', () => {
    const first = ripple('first', 0);
    const second = ripple('second', 0);
    const settings = {waveWidth: 1.5, intensity: 1};
    const frameA = renderRippleFrame([led], [first, second], settings, 0);
    const frameB = renderRippleFrame([led], [first, second], settings, 0);
    const color = frameA.get(led.ledIndex);

    expect(frameA).toEqual(frameB);
    expect(color).toBeDefined();
    expect(color?.r).toBeGreaterThan(first.color.r);
    expect(color?.r).toBeLessThanOrEqual(255);
    expect(color?.g).toBeGreaterThanOrEqual(0);
    expect(color?.g).toBeLessThanOrEqual(255);
    expect(color?.b).toBeGreaterThanOrEqual(0);
    expect(color?.b).toBeLessThanOrEqual(255);
  });

  test('interpolates from a white background toward the active color', () => {
    const active = createRipple({
      id: 'active',
      originLedIndex: led.ledIndex,
      originX: led.x,
      originY: led.y,
      startedAt: 0,
      color: {r: 255, g: 0, b: 0},
    });
    const frame = renderRippleFrame(
      [led],
      [active],
      {
        waveWidth: 1.5,
        intensity: 0.5,
        compositionMode: 'background-interpolation',
      },
      0,
      {r: 255, g: 255, b: 255},
    );

    expect(frame.get(led.ledIndex)).toEqual({
      r: 255,
      g: 127.5,
      b: 127.5,
    });
  });

  test('interpolation overlaps are order-independent, deterministic and bounded', () => {
    const red = createRipple({
      id: 'red',
      originLedIndex: led.ledIndex,
      originX: led.x,
      originY: led.y,
      startedAt: 0,
      color: {r: 255, g: 0, b: 0},
    });
    const blue = createRipple({
      id: 'blue',
      originLedIndex: led.ledIndex,
      originX: led.x,
      originY: led.y,
      startedAt: 0,
      color: {r: 0, g: 0, b: 255},
    });
    const settings = {
      waveWidth: 1.5,
      intensity: 0.8,
      compositionMode: 'background-interpolation' as const,
    };
    const forward = renderRippleFrame([led], [red, blue], settings, 0).get(
      led.ledIndex,
    );
    const reverse = renderRippleFrame([led], [blue, red], settings, 0).get(
      led.ledIndex,
    );

    expect(forward).toEqual(reverse);
    expect(forward).toBeDefined();
    Object.values(forward ?? {}).forEach((channel) => {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    });
  });

  test('rejects the newest ripple at the safety cap without evicting older ones', () => {
    const existing = Array.from({length: 64}, (_, index) =>
      ripple(`old-${index}`, index),
    );
    const result = addRipple(existing, ripple('new', 100), 1000, 100);

    expect(result.accepted).toBe(false);
    expect(result.ripples).toHaveLength(64);
    expect(result.ripples.map(({id}) => id)).toEqual(
      existing.map(({id}) => id),
    );
    existing.forEach((item, index) => {
      expect(result.ripples[index]).toBe(item);
    });
  });
});
