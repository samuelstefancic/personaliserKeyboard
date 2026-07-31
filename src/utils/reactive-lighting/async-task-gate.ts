export type AsyncTaskGate = Readonly<{
  run: (task: () => Promise<void>) => Promise<void>;
  wait: () => Promise<void>;
  isRunning: () => boolean;
}>;

/**
 * Coalesces concurrent cleanup requests. Consumers awaiting `wait()` cannot
 * start a replacement resource set until the current task has fully settled.
 */
export const createAsyncTaskGate = (): AsyncTaskGate => {
  let current: Promise<void> | undefined;

  const clear = (completed: Promise<void>) => {
    if (current === completed) {
      current = undefined;
    }
  };

  return {
    run: (task) => {
      if (current) {
        return current;
      }
      const operation = Promise.resolve().then(task);
      current = operation;
      operation.then(
        () => clear(operation),
        () => clear(operation),
      );
      return operation;
    },
    wait: () => current ?? Promise.resolve(),
    isRunning: () => current !== undefined,
  };
};
