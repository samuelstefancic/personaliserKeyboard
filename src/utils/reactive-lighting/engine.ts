import {
  LedFrame,
  ReactiveLed,
  RGBColor,
  RippleInstance,
  RippleRenderSettings,
  RippleSettings,
  RippleTiming,
} from './types';

export const MAX_CONCURRENT_RIPPLES = 64;

export const DEFAULT_RIPPLE_SETTINGS: RippleSettings = Object.freeze({
  durationMs: 900,
  waveWidth: 1.5,
  intensity: 1,
  maxConcurrentRipples: MAX_CONCURRENT_RIPPLES,
});

export const BLACK: RGBColor = Object.freeze({r: 0, g: 0, b: 0});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clampRGBColor = (color: RGBColor): RGBColor => ({
  r: clamp(Number.isFinite(color.r) ? color.r : 0, 0, 255),
  g: clamp(Number.isFinite(color.g) ? color.g : 0, 0, 255),
  b: clamp(Number.isFinite(color.b) ? color.b : 0, 0, 255),
});

const smoothstep = (edge0: number, edge1: number, value: number) => {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

const screenChannel = (background: number, foreground: number) =>
  255 - ((255 - background) * (255 - foreground)) / 255;

const screen = (background: RGBColor, foreground: RGBColor): RGBColor => ({
  r: clamp(screenChannel(background.r, foreground.r), 0, 255),
  g: clamp(screenChannel(background.g, foreground.g), 0, 255),
  b: clamp(screenChannel(background.b, foreground.b), 0, 255),
});

const interpolateColor = (
  background: RGBColor,
  active: RGBColor,
  amount: number,
): RGBColor => ({
  r: background.r + (active.r - background.r) * amount,
  g: background.g + (active.g - background.g) * amount,
  b: background.b + (active.b - background.b) * amount,
});

export const createRipple = (
  ripple: Omit<RippleInstance, 'durationMs'> & {durationMs?: number},
  settings: Pick<RippleSettings, 'durationMs'> = DEFAULT_RIPPLE_SETTINGS,
): RippleInstance => {
  const requestedDuration = ripple.durationMs ?? settings.durationMs;
  return Object.freeze({
    ...ripple,
    durationMs:
      Number.isFinite(requestedDuration) && requestedDuration > 0
        ? requestedDuration
        : DEFAULT_RIPPLE_SETTINGS.durationMs,
    color: Object.freeze(clampRGBColor(ripple.color)),
  });
};

export const getRippleTiming = (
  ripple: RippleInstance,
  now: number,
): RippleTiming => {
  const rawElapsedMs = now - ripple.startedAt;
  const durationMs = Math.max(1, ripple.durationMs);
  return {
    elapsedMs: Math.max(0, rawElapsedMs),
    progress: clamp(rawElapsedMs / durationMs, 0, 1),
    hasStarted: rawElapsedMs >= 0,
    finished: rawElapsedMs >= durationMs,
  };
};

export const pruneExpiredRipples = (
  ripples: readonly RippleInstance[],
  now: number,
): readonly RippleInstance[] =>
  ripples.filter((ripple) => !getRippleTiming(ripple, now).finished);

export type AddRippleResult = Readonly<{
  ripples: readonly RippleInstance[];
  accepted: boolean;
}>;

/**
 * Expired instances are pruned individually before applying the safety cap.
 * When the cap is full, the newest ripple is rejected so an existing ripple is
 * never reset or evicted before its own end time.
 */
export const addRipple = (
  ripples: readonly RippleInstance[],
  ripple: RippleInstance,
  maxConcurrentRipples = DEFAULT_RIPPLE_SETTINGS.maxConcurrentRipples,
  now = ripple.startedAt,
): AddRippleResult => {
  const activeRipples = pruneExpiredRipples(ripples, now);
  const configuredLimit = Number.isFinite(maxConcurrentRipples)
    ? Math.floor(maxConcurrentRipples)
    : MAX_CONCURRENT_RIPPLES;
  const safeLimit = clamp(configuredLimit, 0, MAX_CONCURRENT_RIPPLES);
  if (activeRipples.length >= safeLimit) {
    return {ripples: activeRipples, accepted: false};
  }
  return {ripples: [...activeRipples, ripple], accepted: true};
};

const getKeyboardDiagonal = (leds: readonly ReactiveLed[]) => {
  if (leds.length < 2) {
    return 1;
  }
  const xs = leds.map(({x}) => x);
  const ys = leds.map(({y}) => y);
  return (
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ) || 1
  );
};

const getBackgroundColor = (
  background: LedFrame | RGBColor,
  ledIndex: number,
): RGBColor =>
  background instanceof Map
    ? background.get(ledIndex) ?? BLACK
    : (background as RGBColor);

const getRippleContribution = (
  led: ReactiveLed,
  ripple: RippleInstance,
  diagonal: number,
  normalizedWaveWidth: number,
  intensity: number,
  now: number,
) => {
  const timing = getRippleTiming(ripple, now);
  if (!timing.hasStarted || timing.finished) {
    return 0;
  }

  const normalizedDistance =
    Math.hypot(led.x - ripple.originX, led.y - ripple.originY) / diagonal;
  const distanceFromFront = Math.abs(normalizedDistance - timing.progress);
  const wave = 1 - smoothstep(0, normalizedWaveWidth, distanceFromFront);
  const endFade = 1 - smoothstep(0.7, 1, timing.progress);
  return clamp(wave * endFade * intensity, 0, 1);
};

/**
 * Produces a time-derived frame. No state is advanced by rendering, so a frame
 * is independent of the number or cadence of previous calls.
 */
export const renderRippleFrame = (
  leds: readonly ReactiveLed[],
  ripples: readonly RippleInstance[],
  settings: RippleRenderSettings,
  now: number,
  background: LedFrame | RGBColor = BLACK,
): LedFrame => {
  const diagonal = getKeyboardDiagonal(leds);
  const normalizedWaveWidth = Math.max(
    Number.EPSILON,
    Math.max(0, Number.isFinite(settings.waveWidth) ? settings.waveWidth : 0) /
      diagonal,
  );
  const intensity = clamp(
    Number.isFinite(settings.intensity) ? settings.intensity : 0,
    0,
    1,
  );
  const frame = new Map<number, RGBColor>();

  for (const led of leds) {
    const backgroundColor = clampRGBColor(
      getBackgroundColor(background, led.ledIndex),
    );

    if (settings.compositionMode === 'background-interpolation') {
      let combinedTransparency = 1;
      let totalContribution = 0;
      let weightedRed = 0;
      let weightedGreen = 0;
      let weightedBlue = 0;

      for (const ripple of ripples) {
        const contribution = getRippleContribution(
          led,
          ripple,
          diagonal,
          normalizedWaveWidth,
          intensity,
          now,
        );
        if (contribution <= 0) {
          continue;
        }

        const rippleColor = clampRGBColor(ripple.color);
        combinedTransparency *= 1 - contribution;
        totalContribution += contribution;
        weightedRed += rippleColor.r * contribution;
        weightedGreen += rippleColor.g * contribution;
        weightedBlue += rippleColor.b * contribution;
      }

      if (totalContribution === 0) {
        frame.set(led.ledIndex, backgroundColor);
        continue;
      }

      const activeColor = {
        r: weightedRed / totalContribution,
        g: weightedGreen / totalContribution,
        b: weightedBlue / totalContribution,
      };
      frame.set(
        led.ledIndex,
        clampRGBColor(
          interpolateColor(
            backgroundColor,
            activeColor,
            1 - combinedTransparency,
          ),
        ),
      );
      continue;
    }

    let color = backgroundColor;
    for (const ripple of ripples) {
      const contribution = getRippleContribution(
        led,
        ripple,
        diagonal,
        normalizedWaveWidth,
        intensity,
        now,
      );

      if (contribution > 0) {
        const rippleColor = clampRGBColor(ripple.color);
        color = screen(color, {
          r: rippleColor.r * contribution,
          g: rippleColor.g * contribution,
          b: rippleColor.b * contribution,
        });
      }
    }

    frame.set(led.ledIndex, color);
  }

  return frame;
};
