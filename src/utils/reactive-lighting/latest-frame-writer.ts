export type LatestFrameWriterState = Readonly<{
  stopped: boolean;
  inFlight: boolean;
  hasPending: boolean;
  submitted: number;
  written: number;
  dropped: number;
  lastError: unknown;
}>;

export type LatestFrameWriter<T> = Readonly<{
  enqueue: (frame: T) => boolean;
  drain: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => LatestFrameWriterState;
}>;

export type LatestFrameWriterOptions = Readonly<{
  onError?: (error: unknown) => void;
}>;

export type LatestFrameWriteContext = Readonly<{
  isLatest: () => boolean;
}>;

/**
 * Serializes writes while keeping at most one pending frame. A newer pending
 * frame replaces the obsolete one and immediately marks the active frame stale
 * so a cooperative write can stop between device commands. Stopping drops the
 * pending frame and waits only for the already-active command.
 */
export const createLatestFrameWriter = <T>(
  write: (
    frame: T,
    context: LatestFrameWriteContext,
  ) => Promise<boolean | void>,
  options: LatestFrameWriterOptions = {},
): LatestFrameWriter<T> => {
  type SequencedFrame = Readonly<{frame: T; sequence: number}>;

  let stopped = false;
  let inFlight = false;
  let pending: SequencedFrame | undefined;
  let submitted = 0;
  let written = 0;
  let dropped = 0;
  let lastError: unknown;
  const idleWaiters: (() => void)[] = [];

  const resolveIdleWaiters = () => {
    if (inFlight || pending !== undefined) {
      return;
    }
    idleWaiters.splice(0).forEach((resolve) => resolve());
  };

  const pump = (initialFrame: SequencedFrame) => {
    inFlight = true;
    void (async () => {
      let current: SequencedFrame | undefined = initialFrame;

      while (current !== undefined) {
        try {
          const sequence = current.sequence;
          const completed = await write(current.frame, {
            isLatest: () => !stopped && sequence === submitted,
          });
          if (completed === false) {
            dropped += 1;
          } else {
            written += 1;
          }
        } catch (error) {
          lastError = error;
          const shouldNotify = !stopped;
          stopped = true;
          if (pending !== undefined) {
            pending = undefined;
            dropped += 1;
          }
          if (shouldNotify) {
            try {
              options.onError?.(error);
            } catch {
              // Consumer callbacks cannot prevent the writer from becoming idle.
            }
          }
          break;
        }

        if (stopped) {
          if (pending !== undefined) {
            pending = undefined;
            dropped += 1;
          }
          break;
        }

        current = pending;
        pending = undefined;
      }

      inFlight = false;
      resolveIdleWaiters();
    })();
  };

  const drain = () => {
    if (!inFlight && pending === undefined) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  return {
    enqueue: (frame) => {
      if (stopped) {
        return false;
      }
      submitted += 1;
      const sequencedFrame = {frame, sequence: submitted};
      if (inFlight) {
        if (pending !== undefined) {
          dropped += 1;
        }
        pending = sequencedFrame;
      } else {
        pump(sequencedFrame);
      }
      return true;
    },
    drain,
    stop: () => {
      if (!stopped) {
        stopped = true;
        if (pending !== undefined) {
          pending = undefined;
          dropped += 1;
        }
        resolveIdleWaiters();
      }
      return drain();
    },
    getState: () => ({
      stopped,
      inFlight,
      hasPending: pending !== undefined,
      submitted,
      written,
      dropped,
      lastError,
    }),
  };
};
