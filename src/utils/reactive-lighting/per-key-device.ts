import type {KeyboardAPI} from '../keyboard-api';
import {
  LightingLabCapabilities,
  LightingLabCapability,
  PerKeyRGBRuntimeEvidence,
  withPerKeyRuntimeEvidence,
} from './capabilities';

export type PerKeyHueSaturation = readonly [hue: number, saturation: number];

export type TemporaryPerKeyWrite = {
  ledIndex: number;
  hue: number;
  saturation: number;
};

export type RestorePerKeyRGBResult = {
  restoredLedCount: number;
  failedLedIndices: readonly number[];
};

export type TemporaryPerKeyRGBProbe = {
  session: PerKeyRGBDeviceSession;
  evidence: PerKeyRGBRuntimeEvidence;
  capabilities: LightingLabCapabilities;
};

const batchWriteUnknown: LightingLabCapability = {
  status: 'unknown',
  reason:
    'Batch count values greater than one are not proven and are never probed by Lighting Lab.',
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

const isByte = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 0xff;

const normalizeLedIndices = (ledIndices: readonly number[]): number[] => {
  const uniqueLedIndices = [...new Set(ledIndices)];
  if (
    uniqueLedIndices.length === 0 ||
    uniqueLedIndices.some((ledIndex) => !isByte(ledIndex))
  ) {
    throw new Error(
      'Temporary per-key RGB requires at least one distinct byte-sized LED index.',
    );
  }
  return uniqueLedIndices;
};

const validateColor = (
  color: readonly number[],
  ledIndex: number,
): PerKeyHueSaturation => {
  const [hue, saturation] = color;
  if (color.length !== 2 || !isByte(hue) || !isByte(saturation)) {
    throw new Error(
      `Per-key RGB returned an invalid hue/saturation pair for LED ${ledIndex}.`,
    );
  }
  return [hue, saturation];
};

/**
 * Owns one explicitly probed, reversible live-lighting session.
 *
 * Every writable LED must have been captured first. Writes use the existing
 * count=1 hue/saturation command and this class intentionally exposes no save
 * or batch operation.
 */
export class PerKeyRGBDeviceSession {
  private readonly capturedColors = new Map<number, PerKeyHueSaturation>();
  private readonly touchedLedIndices = new Set<number>();
  private readonly pendingWrites = new Set<Promise<number>>();
  private evidence?: PerKeyRGBRuntimeEvidence;
  private capturePromise?: Promise<PerKeyRGBRuntimeEvidence>;
  private closePromise?: Promise<RestorePerKeyRGBResult>;
  private restorePromise?: Promise<RestorePerKeyRGBResult>;
  private closed = false;

  constructor(private readonly api: KeyboardAPI) {}

  getCapturedColors(): ReadonlyMap<number, PerKeyHueSaturation> {
    return new Map(this.capturedColors);
  }

  getRuntimeEvidence(): PerKeyRGBRuntimeEvidence | undefined {
    return this.evidence;
  }

  async writeTemporary({
    ledIndex,
    hue,
    saturation,
  }: TemporaryPerKeyWrite): Promise<number> {
    if (this.closed) {
      throw new Error('The temporary per-key RGB session is closed.');
    }
    if (this.evidence?.write.status !== 'supported') {
      throw new Error(
        'Temporary per-key RGB writes have not been proven safe.',
      );
    }
    if (!this.capturedColors.has(ledIndex)) {
      throw new Error(
        `LED ${ledIndex} was not captured and cannot be restored safely.`,
      );
    }
    if (!isByte(hue) || !isByte(saturation)) {
      throw new Error('Hue and saturation must both be byte values.');
    }

    return this.trackTemporaryWrite(ledIndex, hue, saturation);
  }

  restore(): Promise<RestorePerKeyRGBResult> {
    if (!this.restorePromise) {
      this.restorePromise = (async () => {
        try {
          return await this.performRestore();
        } finally {
          this.restorePromise = undefined;
        }
      })();
    }
    return this.restorePromise;
  }

  private async performRestore(): Promise<RestorePerKeyRGBResult> {
    const failedLedIndices: number[] = [];
    let restoredLedCount = 0;
    const writes: {
      ledIndex: number;
      promise: Promise<unknown>;
    }[] = [];

    for (const ledIndex of [...this.touchedLedIndices]) {
      const originalColor = this.capturedColors.get(ledIndex);
      if (!originalColor) {
        failedLedIndices.push(ledIndex);
        continue;
      }

      try {
        writes.push({
          ledIndex,
          promise: this.api.setPerKeyRGBMatrix(
            ledIndex,
            originalColor[0],
            originalColor[1],
          ),
        });
      } catch {
        failedLedIndices.push(ledIndex);
      }
    }

    const results = await Promise.allSettled(
      writes.map(({promise}) => promise),
    );
    results.forEach((result, index) => {
      const {ledIndex} = writes[index];
      if (result.status === 'fulfilled') {
        this.touchedLedIndices.delete(ledIndex);
        restoredLedCount++;
      } else {
        // Best effort: one failed LED must not block the remaining restores.
        failedLedIndices.push(ledIndex);
      }
    });

    return {restoredLedCount, failedLedIndices};
  }

  close(): Promise<RestorePerKeyRGBResult> {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = (async () => {
        // Reserve all restore commands in VIA's shared queue immediately. Any
        // later user command is then enqueued after this session's teardown.
        const restoration = this.restore();
        await Promise.allSettled([
          ...(this.capturePromise ? [this.capturePromise] : []),
          ...this.pendingWrites,
          restoration,
        ]);
        return restoration;
      })();
    }
    return this.closePromise;
  }

  captureAndProbe(
    ledIndices: readonly number[],
  ): Promise<PerKeyRGBRuntimeEvidence> {
    if (this.closed) {
      return Promise.reject(
        new Error('The temporary per-key RGB session is closed.'),
      );
    }
    if (this.evidence) {
      return Promise.resolve(this.evidence);
    }
    if (!this.capturePromise) {
      this.capturePromise = this.performCaptureAndProbe(ledIndices).finally(
        () => {
          this.capturePromise = undefined;
        },
      );
    }
    return this.capturePromise;
  }

  private async performCaptureAndProbe(
    ledIndices: readonly number[],
  ): Promise<PerKeyRGBRuntimeEvidence> {
    let normalizedLedIndices: number[];
    try {
      normalizedLedIndices = normalizeLedIndices(ledIndices);
    } catch (error) {
      this.evidence = {
        read: {
          status: 'unsupported',
          reason: getErrorMessage(error),
        },
        write: {
          status: 'unknown',
          reason: 'No write was attempted because capture could not start.',
        },
        batchWrite: batchWriteUnknown,
        capturedLedCount: 0,
      };
      return this.evidence;
    }

    try {
      for (const ledIndex of normalizedLedIndices) {
        if (this.closed) {
          throw new Error('The temporary per-key RGB session was closed.');
        }
        const colors = await this.api.getPerKeyRGBMatrix([ledIndex]);
        if (this.closed) {
          throw new Error('The temporary per-key RGB session was closed.');
        }
        if (colors.length !== 1) {
          throw new Error(
            `Per-key RGB capture returned ${colors.length} colors for one LED.`,
          );
        }
        this.capturedColors.set(ledIndex, validateColor(colors[0], ledIndex));
      }
    } catch (error) {
      this.capturedColors.clear();
      this.evidence = {
        read: {
          status: 'unsupported',
          reason: `Per-key RGB capture failed: ${getErrorMessage(error)}`,
        },
        write: {
          status: 'unknown',
          reason: 'No write was attempted because capture failed.',
        },
        batchWrite: batchWriteUnknown,
        capturedLedCount: 0,
      };
      return this.evidence;
    }

    const probeLedIndex = normalizedLedIndices[0];
    const probeColor = this.capturedColors.get(probeLedIndex);
    if (!probeColor) {
      throw new Error('Captured probe color is unexpectedly missing.');
    }

    let measuredWriteLatencyMs: number | undefined;
    let write: LightingLabCapability;
    try {
      measuredWriteLatencyMs = await this.trackTemporaryWrite(
        probeLedIndex,
        probeColor[0],
        probeColor[1],
      );
      if (this.closed) {
        throw new Error('The temporary per-key RGB session was closed.');
      }
      const [verifiedColor] = await this.api.getPerKeyRGBMatrix([
        probeLedIndex,
      ]);
      if (this.closed) {
        throw new Error('The temporary per-key RGB session was closed.');
      }
      const validatedColor = validateColor(verifiedColor, probeLedIndex);
      if (
        validatedColor[0] !== probeColor[0] ||
        validatedColor[1] !== probeColor[1]
      ) {
        throw new Error(
          'Reading back the same-value probe did not return the captured color.',
        );
      }
      write = {
        status: 'supported',
        reason:
          'A count=1 same-value write completed and was read back without issuing a persistence command.',
      };
    } catch (error) {
      const restoreResult = await this.restore();
      const restoreFailure =
        restoreResult.failedLedIndices.length === 0
          ? ''
          : ` Restoration also failed for LED indexes ${restoreResult.failedLedIndices.join(
              ', ',
            )}.`;
      write = {
        status: 'unsupported',
        reason: `Temporary count=1 write verification failed: ${getErrorMessage(
          error,
        )}.${restoreFailure}`,
      };
    }

    this.evidence = {
      read: {
        status: 'supported',
        reason: `Captured ${this.capturedColors.size} per-key hue/saturation values.`,
      },
      write,
      batchWrite: batchWriteUnknown,
      ...(measuredWriteLatencyMs === undefined ? {} : {measuredWriteLatencyMs}),
      capturedLedCount: this.capturedColors.size,
    };
    return this.evidence;
  }

  private async issueTemporaryWrite(
    ledIndex: number,
    hue: number,
    saturation: number,
  ): Promise<number> {
    // Record before awaiting: even a rejected HID response may follow a write
    // that reached the keyboard, so restoration must still be attempted.
    this.touchedLedIndices.add(ledIndex);
    const startedAt = now();
    await this.api.setPerKeyRGBMatrix(ledIndex, hue, saturation);
    return Math.max(0, now() - startedAt);
  }

  private async trackTemporaryWrite(
    ledIndex: number,
    hue: number,
    saturation: number,
  ): Promise<number> {
    const write = this.issueTemporaryWrite(ledIndex, hue, saturation);
    this.pendingWrites.add(write);
    try {
      return await write;
    } finally {
      this.pendingWrites.delete(write);
    }
  }
}

/**
 * This function performs I/O and must only be called after an explicit user
 * request to start live output. Merely rendering the UI must use static
 * capabilities and must not call this probe.
 */
export const probeTemporaryPerKeyRGB = async (
  api: KeyboardAPI,
  ledIndices: readonly number[],
  staticCapabilities: LightingLabCapabilities,
  onSessionCreated?: (session: PerKeyRGBDeviceSession) => void,
): Promise<TemporaryPerKeyRGBProbe> => {
  if (
    staticCapabilities.matrixInput.status !== 'supported' ||
    staticCapabilities.activeKeyMapping.status !== 'supported' ||
    staticCapabilities.perKeyRead.status === 'unsupported' ||
    staticCapabilities.perKeyWrite.status === 'unsupported'
  ) {
    throw new Error(
      `Temporary per-key RGB probe blocked by static capabilities: ${staticCapabilities.reasons.join(
        ' ',
      )}`,
    );
  }
  const session = new PerKeyRGBDeviceSession(api);
  onSessionCreated?.(session);
  const evidence = await session.captureAndProbe(ledIndices);
  return {
    session,
    evidence,
    capabilities: withPerKeyRuntimeEvidence(staticCapabilities, evidence),
  };
};
