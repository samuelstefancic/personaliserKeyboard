import {describe, expect, test} from 'bun:test';
import {
  calculateSafeDeviceUpdateCadence,
  MAX_DEVICE_UPDATE_FPS,
} from '../../src/utils/reactive-lighting/cadence';

describe('safe device update cadence', () => {
  test('keeps the requested FPS when measured writes fit with margin', () => {
    const cadence = calculateSafeDeviceUpdateCadence({
      targetFps: 15,
      measuredCommandLatencyMs: 2,
      estimatedMaxLedWritesPerFrame: 10,
      safetyMargin: 1.5,
    });

    expect(cadence).toMatchObject({
      canStream: true,
      targetFps: 15,
      safeFps: 15,
      safetyMargin: 1.5,
      limitedByLatency: false,
    });
    expect(cadence.updateIntervalMs).toBeCloseTo(1000 / 15);
  });

  test('reduces cadence from latency, rounded-up writes and explicit margin', () => {
    const fitting = calculateSafeDeviceUpdateCadence({
      targetFps: 15,
      measuredCommandLatencyMs: 8,
      estimatedMaxLedWritesPerFrame: 4.2,
      safetyMargin: 1.5,
    });

    expect(fitting).toMatchObject({
      canStream: true,
      estimatedMaxLedWritesPerFrame: 5,
      maxLedWritesAtTargetFps: 5,
      limitedByLatency: false,
      safeFps: 15,
    });

    const limited = calculateSafeDeviceUpdateCadence({
      targetFps: 15,
      measuredCommandLatencyMs: 8,
      estimatedMaxLedWritesPerFrame: 10,
      safetyMargin: 1.5,
    });
    expect(limited).toMatchObject({
      canStream: true,
      updateIntervalMs: 120,
      maxLedWritesAtTargetFps: 5,
      limitedByLatency: true,
    });
    expect(limited.safeFps).toBeCloseTo(1000 / 120);
  });

  test('clamps target, latency and sub-unit margin conservatively', () => {
    const cadence = calculateSafeDeviceUpdateCadence({
      targetFps: 120,
      measuredCommandLatencyMs: 0.01,
      estimatedMaxLedWritesPerFrame: 1.1,
      safetyMargin: 0.5,
    });

    expect(cadence).toMatchObject({
      canStream: true,
      targetFps: MAX_DEVICE_UPDATE_FPS,
      measuredCommandLatencyMs: 0.1,
      estimatedMaxLedWritesPerFrame: 2,
      safetyMargin: 1,
      safeFps: MAX_DEVICE_UPDATE_FPS,
    });
  });

  test('disables cadence for invalid or overflowing measurements', () => {
    const invalidLatency = calculateSafeDeviceUpdateCadence({
      targetFps: Number.NaN,
      measuredCommandLatencyMs: Number.NaN,
      estimatedMaxLedWritesPerFrame: 10,
      safetyMargin: 1.5,
    });
    const invalidWrites = calculateSafeDeviceUpdateCadence({
      targetFps: 15,
      measuredCommandLatencyMs: 2,
      estimatedMaxLedWritesPerFrame: 0,
      safetyMargin: 1.5,
    });
    const overflowing = calculateSafeDeviceUpdateCadence({
      targetFps: 15,
      measuredCommandLatencyMs: 2,
      estimatedMaxLedWritesPerFrame: Number.MAX_VALUE,
      safetyMargin: 2,
    });

    expect(invalidLatency).toMatchObject({
      canStream: false,
      targetFps: 15,
      safeFps: 0,
      updateIntervalMs: null,
    });
    expect(invalidWrites.canStream).toBe(false);
    expect(overflowing.canStream).toBe(false);
  });
});
