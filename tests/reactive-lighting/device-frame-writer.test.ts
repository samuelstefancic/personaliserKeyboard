import {describe, expect, test} from 'bun:test';
import {writeChangedLedFrame} from '../../src/utils/reactive-lighting/device-frame-writer';
import {createLatestFrameWriter} from '../../src/utils/reactive-lighting/latest-frame-writer';
import type {LedFrame} from '../../src/utils/reactive-lighting/types';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
};

describe('cooperative device frame writer', () => {
  test('does not start another LED command after stop during an active write', async () => {
    const activeWrite = deferred();
    const previous: LedFrame = new Map([
      [1, {r: 0, g: 0, b: 0}],
      [2, {r: 0, g: 0, b: 0}],
    ]);
    const next: LedFrame = new Map([
      [1, {r: 200, g: 10, b: 10}],
      [2, {r: 10, g: 200, b: 10}],
    ]);
    const calls: number[] = [];
    let active = true;
    const writing = writeChangedLedFrame(
      previous,
      next,
      0,
      async ({ledIndex}) => {
        calls.push(ledIndex);
        await activeWrite.promise;
        return 3;
      },
      () => active,
    );

    await Promise.resolve();
    active = false;
    activeWrite.resolve();
    const result = await writing;

    expect(calls).toEqual([1]);
    expect(result).toMatchObject({
      aborted: true,
      ledWrites: 1,
      totalCommandLatencyMs: 3,
    });
    expect(result.appliedFrame.get(1)).toEqual(next.get(1));
    expect(result.appliedFrame.get(2)).toEqual(previous.get(2));
  });

  test('abandons the rest of an obsolete frame before writing the latest one', async () => {
    const activeCommand = deferred();
    let appliedFrame: LedFrame = new Map([
      [1, {r: 0, g: 0, b: 0}],
      [2, {r: 0, g: 0, b: 0}],
    ]);
    const firstFrame: LedFrame = new Map([
      [1, {r: 200, g: 10, b: 10}],
      [2, {r: 10, g: 200, b: 10}],
    ]);
    const latestFrame: LedFrame = new Map([
      [1, {r: 20, g: 20, b: 220}],
      [2, {r: 30, g: 210, b: 30}],
    ]);
    const calls: string[] = [];
    let isFirstCommand = true;
    const writer = createLatestFrameWriter<LedFrame>(
      async (frame, {isLatest}) => {
        const result = await writeChangedLedFrame(
          appliedFrame,
          frame,
          0,
          async ({ledIndex, color}) => {
            calls.push(`${ledIndex}:${color.r}`);
            if (isFirstCommand) {
              isFirstCommand = false;
              await activeCommand.promise;
            }
            return 2;
          },
          isLatest,
        );
        appliedFrame = result.appliedFrame;
        return !result.aborted;
      },
    );

    writer.enqueue(firstFrame);
    await Promise.resolve();
    writer.enqueue(latestFrame);
    activeCommand.resolve();
    await writer.drain();

    expect(calls).toEqual(['1:200', '1:20', '2:30']);
    expect(appliedFrame).toEqual(latestFrame);
  });
});
