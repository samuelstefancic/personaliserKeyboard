import {describe, expect, test} from 'bun:test';
import {createAsyncTaskGate} from '../../src/utils/reactive-lighting/async-task-gate';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
};

describe('async task gate', () => {
  test('coalesces concurrent stops and makes a restart wait for cleanup', async () => {
    const cleanup = deferred();
    const events: string[] = [];
    const gate = createAsyncTaskGate();
    const firstStop = gate.run(async () => {
      events.push('cleanup-started');
      await cleanup.promise;
      events.push('cleanup-finished');
    });
    const secondStop = gate.run(async () => {
      events.push('duplicate-cleanup');
    });
    const restart = (async () => {
      await gate.wait();
      events.push('restart');
    })();

    await Promise.resolve();
    expect(firstStop).toBe(secondStop);
    expect(gate.isRunning()).toBe(true);
    expect(events).toEqual(['cleanup-started']);

    cleanup.resolve();
    await Promise.all([firstStop, secondStop, restart]);

    expect(gate.isRunning()).toBe(false);
    expect(events).toEqual(['cleanup-started', 'cleanup-finished', 'restart']);
  });
});
