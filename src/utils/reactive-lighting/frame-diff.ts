import {BLACK, clampRGBColor} from './engine';
import type {LedFrame, RGBColor} from './types';

export type ChangedLed = Readonly<{
  ledIndex: number;
  color: RGBColor;
}>;

export type ChangedLedRange = Readonly<{
  startLedIndex: number;
  colors: readonly RGBColor[];
}>;

export const hasMeaningfulColorDifference = (
  previous: RGBColor,
  next: RGBColor,
  threshold = 0,
) =>
  Math.max(
    Math.abs(previous.r - next.r),
    Math.abs(previous.g - next.g),
    Math.abs(previous.b - next.b),
  ) > Math.max(0, threshold);

export const diffLedFrames = (
  previous: LedFrame | null,
  next: LedFrame,
  threshold = 0,
): readonly ChangedLed[] => {
  if (previous === null) {
    return [...next.entries()]
      .sort(([left], [right]) => left - right)
      .map(([ledIndex, color]) => ({
        ledIndex,
        color: clampRGBColor(color),
      }));
  }

  const ledIndices = new Set([...previous.keys(), ...next.keys()]);
  return [...ledIndices]
    .sort((left, right) => left - right)
    .flatMap((ledIndex): ChangedLed[] => {
      const previousColor = clampRGBColor(previous.get(ledIndex) ?? BLACK);
      const nextColor = clampRGBColor(next.get(ledIndex) ?? BLACK);
      return hasMeaningfulColorDifference(previousColor, nextColor, threshold)
        ? [{ledIndex, color: nextColor}]
        : [];
    });
};

export const groupContiguousLedChanges = (
  changes: readonly ChangedLed[],
  maxRangeLength = Number.POSITIVE_INFINITY,
): readonly ChangedLedRange[] => {
  const safeMaxRangeLength =
    Number.isFinite(maxRangeLength) && maxRangeLength > 0
      ? Math.max(1, Math.floor(maxRangeLength))
      : Number.POSITIVE_INFINITY;
  const sorted = [...changes].sort(
    (left, right) => left.ledIndex - right.ledIndex,
  );
  const ranges: {startLedIndex: number; colors: RGBColor[]}[] = [];

  for (const change of sorted) {
    const current = ranges[ranges.length - 1];
    const expectedLedIndex = current
      ? current.startLedIndex + current.colors.length
      : -1;
    if (
      !current ||
      change.ledIndex !== expectedLedIndex ||
      current.colors.length >= safeMaxRangeLength
    ) {
      ranges.push({
        startLedIndex: change.ledIndex,
        colors: [change.color],
      });
    } else {
      current.colors.push(change.color);
    }
  }

  return ranges;
};

export const diffLedFrameRanges = (
  previous: LedFrame | null,
  next: LedFrame,
  threshold = 0,
  maxRangeLength = Number.POSITIVE_INFINITY,
) =>
  groupContiguousLedChanges(
    diffLedFrames(previous, next, threshold),
    maxRangeLength,
  );
