import {ChangedLed, diffLedFrames} from './frame-diff';
import type {LedFrame, RGBColor} from './types';

export type ChangedLedWrite = (change: ChangedLed) => Promise<number | null>;

export type DeviceFrameWriteResult = Readonly<{
  appliedFrame: LedFrame;
  aborted: boolean;
  ledWrites: number;
  totalCommandLatencyMs: number;
}>;

/**
 * Applies a diff cooperatively. A stop can allow the one command already in
 * flight to finish, but the activity check prevents every subsequent command
 * in the same frame from starting.
 */
export const writeChangedLedFrame = async (
  previous: LedFrame | null,
  next: LedFrame,
  threshold: number,
  write: ChangedLedWrite,
  isActive: () => boolean,
): Promise<DeviceFrameWriteResult> => {
  const appliedFrame = new Map<number, RGBColor>(previous ?? []);
  let ledWrites = 0;
  let totalCommandLatencyMs = 0;

  for (const change of diffLedFrames(previous, next, threshold)) {
    if (!isActive()) {
      return {
        appliedFrame,
        aborted: true,
        ledWrites,
        totalCommandLatencyMs,
      };
    }

    const latency = await write(change);
    appliedFrame.set(change.ledIndex, change.color);
    if (latency !== null) {
      ledWrites += 1;
      totalCommandLatencyMs += latency;
    }
  }

  return {
    appliedFrame,
    aborted: !isActive(),
    ledWrites,
    totalCommandLatencyMs,
  };
};
