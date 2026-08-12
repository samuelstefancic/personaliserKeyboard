export const DEFAULT_DEVICE_UPDATE_FPS = 15;
export const MIN_DEVICE_UPDATE_FPS = 1;
export const MAX_DEVICE_UPDATE_FPS = 20;
export const MIN_MEASURED_COMMAND_LATENCY_MS = 0.1;

export type SafeDeviceUpdateCadenceInput = Readonly<{
  targetFps: number;
  measuredCommandLatencyMs: number;
  estimatedMaxLedWritesPerFrame: number;
  safetyMargin: number;
}>;

export type SafeDeviceUpdateCadence = Readonly<{
  canStream: boolean;
  targetFps: number;
  safeFps: number;
  updateIntervalMs: number | null;
  measuredCommandLatencyMs: number | null;
  estimatedMaxLedWritesPerFrame: number | null;
  safetyMargin: number | null;
  maxLedWritesAtTargetFps: number;
  limitedByLatency: boolean;
  reason: string;
}>;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeTargetFps = (targetFps: number) =>
  clamp(
    Number.isFinite(targetFps) ? targetFps : DEFAULT_DEVICE_UPDATE_FPS,
    MIN_DEVICE_UPDATE_FPS,
    MAX_DEVICE_UPDATE_FPS,
  );

/**
 * Calculates a conservative hardware cadence for count=1 LED writes.
 * `safetyMargin` is a multiplier (1.5 reserves 50% beyond measured work).
 * Invalid measurement inputs disable streaming instead of inventing a rate.
 */
export const calculateSafeDeviceUpdateCadence = ({
  targetFps: requestedTargetFps,
  measuredCommandLatencyMs: requestedLatencyMs,
  estimatedMaxLedWritesPerFrame: requestedLedWrites,
  safetyMargin: requestedSafetyMargin,
}: SafeDeviceUpdateCadenceInput): SafeDeviceUpdateCadence => {
  const targetFps = normalizeTargetFps(requestedTargetFps);
  const invalidReason =
    !Number.isFinite(requestedLatencyMs) || requestedLatencyMs <= 0
      ? 'A positive measured command latency is required.'
      : !Number.isFinite(requestedLedWrites) || requestedLedWrites <= 0
      ? 'A positive estimated maximum LED write count is required.'
      : !Number.isFinite(requestedSafetyMargin) || requestedSafetyMargin <= 0
      ? 'A positive safety margin is required.'
      : undefined;

  if (invalidReason) {
    return {
      canStream: false,
      targetFps,
      safeFps: 0,
      updateIntervalMs: null,
      measuredCommandLatencyMs: null,
      estimatedMaxLedWritesPerFrame: null,
      safetyMargin: null,
      maxLedWritesAtTargetFps: 0,
      limitedByLatency: false,
      reason: invalidReason,
    };
  }

  // Rounding writes upward and margins up to at least 1 is conservative.
  const measuredCommandLatencyMs = Math.max(
    MIN_MEASURED_COMMAND_LATENCY_MS,
    requestedLatencyMs,
  );
  const estimatedMaxLedWritesPerFrame = Math.max(
    1,
    Math.ceil(requestedLedWrites),
  );
  const safetyMargin = Math.max(1, requestedSafetyMargin);
  const protectedCommandLatencyMs = measuredCommandLatencyMs * safetyMargin;
  const protectedFrameWriteMs =
    protectedCommandLatencyMs * estimatedMaxLedWritesPerFrame;

  if (!Number.isFinite(protectedFrameWriteMs)) {
    return {
      canStream: false,
      targetFps,
      safeFps: 0,
      updateIntervalMs: null,
      measuredCommandLatencyMs,
      estimatedMaxLedWritesPerFrame,
      safetyMargin,
      maxLedWritesAtTargetFps: 0,
      limitedByLatency: true,
      reason: 'The protected LED write duration exceeds a finite timer range.',
    };
  }

  const targetIntervalMs = 1000 / targetFps;
  const updateIntervalMs = Math.max(targetIntervalMs, protectedFrameWriteMs);
  const maxLedWritesAtTargetFps = Math.max(
    0,
    Math.floor(targetIntervalMs / protectedCommandLatencyMs),
  );
  const limitedByLatency = protectedFrameWriteMs > targetIntervalMs;
  const safeFps = limitedByLatency ? 1000 / updateIntervalMs : targetFps;

  return {
    canStream: true,
    targetFps,
    safeFps,
    updateIntervalMs,
    measuredCommandLatencyMs,
    estimatedMaxLedWritesPerFrame,
    safetyMargin,
    maxLedWritesAtTargetFps,
    limitedByLatency,
    reason: limitedByLatency
      ? 'The update rate was reduced to fit measured writes plus the safety margin.'
      : 'The requested update rate fits measured writes plus the safety margin.',
  };
};
