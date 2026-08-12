import {describe, expect, test} from 'bun:test';
import {createLatestFrameWriter} from '../../src/utils/reactive-lighting/latest-frame-writer';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
};

describe('latest-frame writer', () => {
  test('allows one write in flight and replaces an obsolete pending frame', async () => {
    const firstWrite = deferred();
    const calls: number[] = [];
    const writer = createLatestFrameWriter(async (frame: number) => {
      calls.push(frame);
      if (frame === 1) {
        await firstWrite.promise;
      }
    });

    writer.enqueue(1);
    writer.enqueue(2);
    writer.enqueue(3);
    expect(calls).toEqual([1]);
    expect(writer.getState()).toMatchObject({
      inFlight: true,
      hasPending: true,
      dropped: 1,
    });

    firstWrite.resolve();
    await writer.drain();

    expect(calls).toEqual([1, 3]);
    expect(writer.getState()).toMatchObject({
      inFlight: false,
      hasPending: false,
      submitted: 3,
      written: 2,
      dropped: 1,
    });
  });

  test('stops without starting a pending write or firing callbacks afterward', async () => {
    const activeWrite = deferred();
    const calls: number[] = [];
    const errors: unknown[] = [];
    const writer = createLatestFrameWriter(
      async (frame: number) => {
        calls.push(frame);
        await activeWrite.promise;
        throw new Error('late failure');
      },
      {onError: (error) => errors.push(error)},
    );

    writer.enqueue(1);
    writer.enqueue(2);
    const stopped = writer.stop();
    activeWrite.resolve();
    await stopped;

    expect(writer.enqueue(3)).toBe(false);
    expect(calls).toEqual([1]);
    expect(errors).toEqual([]);
    expect(writer.getState()).toMatchObject({
      stopped: true,
      inFlight: false,
      hasPending: false,
      dropped: 1,
    });
  });

  test('marks an active frame stale as soon as a newer frame is submitted', async () => {
    const activeCommand = deferred();
    const calls: string[] = [];
    const writer = createLatestFrameWriter(
      async (frame: number, {isLatest}) => {
        calls.push(`${frame}:first`);
        if (frame === 1) {
          await activeCommand.promise;
        }
        if (isLatest()) {
          calls.push(`${frame}:second`);
        }
        return isLatest();
      },
    );

    writer.enqueue(1);
    writer.enqueue(2);
    activeCommand.resolve();
    await writer.drain();

    expect(calls).toEqual(['1:first', '2:first', '2:second']);
    expect(writer.getState()).toMatchObject({
      submitted: 2,
      written: 1,
      dropped: 1,
    });
  });
});
