import {describe, expect, test} from 'bun:test';
import type {KeyboardAPI} from '../../src/utils/keyboard-api';
import {getStaticLightingLabCapabilities} from '../../src/utils/reactive-lighting/capabilities';
import {
  PerKeyRGBDeviceSession,
  probeTemporaryPerKeyRGB,
} from '../../src/utils/reactive-lighting/per-key-device';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
};

describe('temporary per-key device session', () => {
  test('publishes the session before I/O and stops capture after the active read', async () => {
    const firstRead = deferred<number[][]>();
    const readLedIndices: number[][] = [];
    const writes: number[][] = [];
    const api = {
      getPerKeyRGBMatrix: async (ledIndices: number[]) => {
        readLedIndices.push(ledIndices);
        return firstRead.promise;
      },
      setPerKeyRGBMatrix: async (
        ledIndex: number,
        hue: number,
        saturation: number,
      ) => {
        writes.push([ledIndex, hue, saturation]);
      },
    } as unknown as KeyboardAPI;
    const capabilities = getStaticLightingLabCapabilities(
      11,
      {rows: 1, cols: 2},
      {
        activeKeyCount: 2,
        matrixMappedKeyCount: 2,
        ledMappedKeyCount: 2,
      },
    );
    let session: PerKeyRGBDeviceSession | undefined;
    const probe = probeTemporaryPerKeyRGB(
      api,
      [4, 9],
      capabilities,
      (createdSession) => {
        session = createdSession;
      },
    );

    await Promise.resolve();
    expect(session).toBeDefined();
    expect(readLedIndices).toEqual([[4]]);

    let closeFinished = false;
    const close = session!.close().then((result) => {
      closeFinished = true;
      return result;
    });
    await Promise.resolve();
    expect(closeFinished).toBe(false);

    firstRead.resolve([[20, 200]]);
    const [probeResult, closeResult] = await Promise.all([probe, close]);

    expect(probeResult.capabilities.liveSafe).toBe(false);
    expect(readLedIndices).toEqual([[4]]);
    expect(writes).toEqual([]);
    expect(closeResult).toEqual({
      restoredLedCount: 0,
      failedLedIndices: [],
    });
  });

  test('reserves every restore before a later user command', async () => {
    const activeWrite = deferred<void>();
    const writes: number[][] = [];
    let blockNextWrite = false;
    const originalColors = new Map([
      [4, [20, 200]],
      [9, [30, 210]],
    ]);
    const api = {
      getPerKeyRGBMatrix: async ([ledIndex]: number[]) => [
        originalColors.get(ledIndex)!,
      ],
      setPerKeyRGBMatrix: async (
        ledIndex: number,
        hue: number,
        saturation: number,
      ) => {
        writes.push([ledIndex, hue, saturation]);
        if (blockNextWrite) {
          blockNextWrite = false;
          await activeWrite.promise;
        }
      },
    } as unknown as KeyboardAPI;
    const session = new PerKeyRGBDeviceSession(api);
    const evidence = await session.captureAndProbe([4, 9]);
    expect(evidence.write.status).toBe('supported');
    await session.writeTemporary({ledIndex: 9, hue: 80, saturation: 220});
    writes.length = 0;

    blockNextWrite = true;
    const active = session.writeTemporary({
      ledIndex: 4,
      hue: 90,
      saturation: 230,
    });
    const closing = session.close();
    const laterUserCommand = api.setPerKeyRGBMatrix(99, 1, 2);

    expect(writes).toEqual([
      [4, 90, 230],
      [4, 20, 200],
      [9, 30, 210],
      [99, 1, 2],
    ]);

    activeWrite.resolve();
    const [, restoration] = await Promise.all([
      active,
      closing,
      laterUserCommand,
    ]);
    expect(restoration).toEqual({
      restoredLedCount: 2,
      failedLedIndices: [],
    });
  });
});
