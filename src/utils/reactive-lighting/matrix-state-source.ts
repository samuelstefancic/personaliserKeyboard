import type {KeyboardAPI} from '../keyboard-api';
import {KeyboardValue} from '../keyboard-values';
import {PROTOCOL_GAMMA} from '../via-protocol';
import {diffMatrixTransitions, MatrixSnapshot} from './matrix-transitions';

export const MATRIX_STATE_POLL_INTERVAL_MS = 20;
const MAX_MATRIX_RESPONSE_BYTES = 28;

export type MatrixKeyTransition = {
  matrixIndex: number;
  row: number;
  col: number;
  state: 'down' | 'up';
  timestamp: number;
};

export type MatrixStateSnapshot = {
  pressed: readonly boolean[];
  raw: readonly number[];
  timestamp: number;
};

export type MatrixStateCallbacks = {
  onTransitions?: (transitions: readonly MatrixKeyTransition[]) => void;
  onSnapshot?: (snapshot: MatrixStateSnapshot) => void;
  onError?: (error: Error) => void;
};

export type MatrixStateSourceHandle = {
  subscribe: (callbacks: MatrixStateCallbacks) => () => void;
  getSnapshot: () => MatrixStateSnapshot | undefined;
  release: () => void;
};

type MatrixSourceConfig = {
  rows: number;
  cols: number;
  protocol: number;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const validateConfig = ({rows, cols, protocol}: MatrixSourceConfig): void => {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows <= 0 ||
    cols <= 0 ||
    rows > 0x100
  ) {
    throw new Error(
      'Matrix rows and columns must be positive, addressable integers.',
    );
  }
  if (protocol < PROTOCOL_GAMMA) {
    throw new Error(
      `VIA protocol ${protocol} does not expose switch matrix state.`,
    );
  }

  const bytesPerRow = Math.ceil(cols / 8);
  if (bytesPerRow > MAX_MATRIX_RESPONSE_BYTES) {
    throw new Error(
      'A matrix row exceeds the understood 28-byte VIA response payload.',
    );
  }
  if (protocol < 12 && rows * bytesPerRow > MAX_MATRIX_RESPONSE_BYTES) {
    throw new Error(
      'This matrix requires row-offset reads, which are not understood before VIA protocol 12.',
    );
  }
};

const getPressedState = (
  raw: MatrixSnapshot,
  rows: number,
  cols: number,
): boolean[] => {
  const bytesPerRow = Math.ceil(cols / 8);
  const pressed = Array(rows * cols).fill(false) as boolean[];
  const downTransitions = diffMatrixTransitions(
    new Uint8Array(rows * bytesPerRow),
    raw,
    rows,
    cols,
  ).transitions;
  for (const transition of downTransitions) {
    pressed[transition.matrixIndex] = transition.type === 'down';
  }
  return pressed;
};

class SharedMatrixStateSource {
  readonly config: MatrixSourceConfig;
  private readonly listeners = new Set<MatrixStateCallbacks>();
  private snapshot?: MatrixStateSnapshot;
  private previousRaw: MatrixSnapshot | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private generation = 0;

  constructor(
    private readonly api: KeyboardAPI,
    rows: number,
    cols: number,
    protocol: number,
  ) {
    this.config = {rows, cols, protocol};
    validateConfig(this.config);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const generation = ++this.generation;
    void this.poll(generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.listeners.clear();
    this.snapshot = undefined;
    this.previousRaw = null;
  }

  subscribe(callbacks: MatrixStateCallbacks): () => void {
    this.listeners.add(callbacks);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.listeners.delete(callbacks);
    };
  }

  getSnapshot(): MatrixStateSnapshot | undefined {
    return this.snapshot;
  }

  private async readRawMatrix(): Promise<number[]> {
    const {rows, cols, protocol} = this.config;
    const bytesPerRow = Math.ceil(cols / 8);
    const rowsPerQuery = Math.floor(MAX_MATRIX_RESPONSE_BYTES / bytesPerRow);
    const raw: number[] = [];

    for (let offset = 0; offset < rows; offset += rowsPerQuery) {
      const rowCount = Math.min(rowsPerQuery, rows - offset);
      const querySize = rowCount * bytesPerRow;
      const response = await this.api.getKeyboardValue(
        KeyboardValue.SWITCH_MATRIX_STATE,
        protocol >= 12 ? [offset] : [],
        querySize,
      );
      if (response.length !== querySize) {
        throw new Error(
          `Matrix state returned ${response.length} bytes; expected ${querySize}.`,
        );
      }
      raw.push(...response);
    }

    return raw;
  }

  private async poll(generation: number): Promise<void> {
    try {
      const raw = await this.readRawMatrix();
      if (!this.running || generation !== this.generation) {
        return;
      }

      const {rows, cols} = this.config;
      const timestamp = Date.now();
      const matrixDiff = diffMatrixTransitions(
        this.previousRaw,
        raw,
        rows,
        cols,
      );
      this.previousRaw = matrixDiff.snapshot;
      const nextSnapshot: MatrixStateSnapshot = {
        pressed: getPressedState(matrixDiff.snapshot, rows, cols),
        raw: Array.from(matrixDiff.snapshot),
        timestamp,
      };
      this.snapshot = nextSnapshot;

      this.emitSnapshot(nextSnapshot);
      if (matrixDiff.transitions.length > 0) {
        const transitions = matrixDiff.transitions.map(
          ({matrixIndex, row, col, type}): MatrixKeyTransition => ({
            matrixIndex,
            row,
            col,
            state: type,
            timestamp,
          }),
        );
        if (transitions.length > 0) {
          this.emitTransitions(transitions);
        }
      }

      if (this.running && generation === this.generation) {
        this.timer = setTimeout(
          () => void this.poll(generation),
          MATRIX_STATE_POLL_INTERVAL_MS,
        );
      }
    } catch (error) {
      if (!this.running || generation !== this.generation) {
        return;
      }
      this.running = false;
      this.timer = undefined;
      this.snapshot = undefined;
      this.previousRaw = null;
      this.emitError(toError(error));
    }
  }

  private emitSnapshot(snapshot: MatrixStateSnapshot): void {
    [...this.listeners].forEach(({onSnapshot}) => {
      try {
        onSnapshot?.(snapshot);
      } catch {
        // A consumer exception must not stop matrix polling for other users.
      }
    });
  }

  private emitTransitions(transitions: readonly MatrixKeyTransition[]): void {
    [...this.listeners].forEach(({onTransitions}) => {
      try {
        onTransitions?.(transitions);
      } catch {
        // A consumer exception must not stop matrix polling for other users.
      }
    });
  }

  private emitError(error: Error): void {
    [...this.listeners].forEach(({onError}) => {
      try {
        onError?.(error);
      } catch {
        // Keep notifying the remaining consumers.
      }
    });
  }
}

type SharedMatrixSourceRecord = {
  source: SharedMatrixStateSource;
  referenceCount: number;
};

const sharedMatrixSources = new Map<string, SharedMatrixSourceRecord>();

const hasSameConfig = (
  left: MatrixSourceConfig,
  right: MatrixSourceConfig,
): boolean =>
  left.rows === right.rows &&
  left.cols === right.cols &&
  left.protocol === right.protocol;

/**
 * Acquires the one polling loop for a keyboard address.
 *
 * The first successful read establishes a baseline and emits only a snapshot.
 * Key transitions begin with the following read, so an already-held key does
 * not become a synthetic key-down event.
 */
export const acquireMatrixStateSource = (
  api: KeyboardAPI,
  rows: number,
  cols: number,
  protocol: number,
  callbacks?: MatrixStateCallbacks,
): MatrixStateSourceHandle => {
  const config = {rows, cols, protocol};
  validateConfig(config);

  let record = sharedMatrixSources.get(api.kbAddr);
  if (record && !hasSameConfig(record.source.config, config)) {
    throw new Error(
      'The same keyboard address was acquired with conflicting matrix definitions.',
    );
  }
  if (!record) {
    record = {
      source: new SharedMatrixStateSource(api, rows, cols, protocol),
      referenceCount: 0,
    };
    sharedMatrixSources.set(api.kbAddr, record);
  }

  record.referenceCount++;
  const source = record.source;
  const ownedSubscriptions = new Set<() => void>();
  let released = false;

  const subscribe = (nextCallbacks: MatrixStateCallbacks): (() => void) => {
    if (released) {
      throw new Error('The matrix state source handle has been released.');
    }
    const unsubscribeSource = source.subscribe(nextCallbacks);
    let subscribed = true;
    const unsubscribe = () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      ownedSubscriptions.delete(unsubscribe);
      unsubscribeSource();
    };
    ownedSubscriptions.add(unsubscribe);
    return unsubscribe;
  };

  if (callbacks) {
    subscribe(callbacks);
  }
  source.start();

  return {
    subscribe,
    getSnapshot: () => source.getSnapshot(),
    release: () => {
      if (released) {
        return;
      }
      released = true;
      [...ownedSubscriptions].forEach((unsubscribe) => unsubscribe());

      const currentRecord = sharedMatrixSources.get(api.kbAddr);
      if (!currentRecord || currentRecord.source !== source) {
        return;
      }
      currentRecord.referenceCount--;
      if (currentRecord.referenceCount === 0) {
        currentRecord.source.stop();
        sharedMatrixSources.delete(api.kbAddr);
      }
    },
  };
};
