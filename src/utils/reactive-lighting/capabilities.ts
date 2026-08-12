import {PROTOCOL_GAMMA} from '../via-protocol';

export type LightingLabCapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'unknown';

export type LightingLabCapability = {
  status: LightingLabCapabilityStatus;
  reason: string;
};

export type MatrixDimensions = {
  rows: number;
  cols: number;
};

/**
 * A small, renderer-independent summary of the active layout mapping.
 *
 * The capability layer deliberately consumes evidence instead of inferring
 * that matrix indexes and LED indexes are interchangeable.
 */
export type ActiveKeyMappingEvidence = {
  activeKeyCount: number;
  matrixMappedKeyCount: number;
  ledMappedKeyCount: number;
  duplicateMatrixPositions?: readonly number[];
  duplicateLedIndices?: readonly number[];
};

export type PerKeyRGBRuntimeEvidence = {
  read: LightingLabCapability;
  write: LightingLabCapability;
  batchWrite: LightingLabCapability;
  measuredWriteLatencyMs?: number;
  capturedLedCount: number;
};

export type LightingLabCapabilities = {
  matrixInput: LightingLabCapability;
  activeKeyMapping: LightingLabCapability;
  perKeyRead: LightingLabCapability;
  perKeyWrite: LightingLabCapability;
  perKeyBatchWrite: LightingLabCapability;
  colorChannels: {
    supported: readonly ['hue', 'saturation'];
    unsupported: readonly ['value'];
    reason: string;
  };
  persistentSave: {
    status: 'not-used';
    reason: string;
  };
  measuredWriteLatencyMs?: number;
  liveSafe: boolean;
  reasons: readonly string[];
};

const unknownPerKeyCapability = (operation: string): LightingLabCapability => ({
  status: 'unknown',
  reason: `${operation} has not been confirmed by an explicit, temporary runtime probe.`,
});

const getMatrixCapability = (
  protocol: number,
  {rows, cols}: MatrixDimensions,
): LightingLabCapability => {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows <= 0 ||
    cols <= 0 ||
    rows > 0x100
  ) {
    return {
      status: 'unsupported',
      reason:
        'The active definition has invalid or non-addressable matrix dimensions.',
    };
  }

  if (protocol < PROTOCOL_GAMMA) {
    return {
      status: 'unsupported',
      reason: `VIA protocol ${protocol} does not expose switch matrix state.`,
    };
  }

  const bytesPerRow = Math.ceil(cols / 8);
  if (bytesPerRow > 28) {
    return {
      status: 'unsupported',
      reason:
        'A single matrix row exceeds the understood 28-byte VIA response payload.',
    };
  }

  if (protocol < 12 && rows * bytesPerRow > 28) {
    return {
      status: 'unsupported',
      reason:
        'This matrix needs row-offset reads, which are only understood for VIA protocol 12 or newer.',
    };
  }

  return {
    status: 'supported',
    reason: 'Switch matrix state can be read with the understood VIA protocol.',
  };
};

const getMappingCapability = ({
  activeKeyCount,
  matrixMappedKeyCount,
  ledMappedKeyCount,
  duplicateMatrixPositions = [],
  duplicateLedIndices = [],
}: ActiveKeyMappingEvidence): LightingLabCapability => {
  if (!Number.isInteger(activeKeyCount) || activeKeyCount <= 0) {
    return {
      status: 'unsupported',
      reason: 'The active layout contains no keys to map.',
    };
  }

  if (
    matrixMappedKeyCount !== activeKeyCount ||
    ledMappedKeyCount !== activeKeyCount
  ) {
    return {
      status: 'unsupported',
      reason:
        `The active layout mapping is incomplete ` +
        `(${matrixMappedKeyCount}/${activeKeyCount} matrix positions, ` +
        `${ledMappedKeyCount}/${activeKeyCount} LED indexes).`,
    };
  }

  if (duplicateMatrixPositions.length > 0) {
    return {
      status: 'unsupported',
      reason: 'The active layout maps multiple keys to one matrix position.',
    };
  }

  if (duplicateLedIndices.length > 0) {
    return {
      status: 'unsupported',
      reason: 'The active layout maps multiple keys to one LED index.',
    };
  }

  return {
    status: 'supported',
    reason:
      'Every active key has distinct matrix and LED mappings; no index equivalence was assumed.',
  };
};

const getBlockingReasons = (
  capabilities: Omit<
    LightingLabCapabilities,
    'liveSafe' | 'reasons' | 'measuredWriteLatencyMs'
  >,
): string[] =>
  [
    capabilities.matrixInput,
    capabilities.activeKeyMapping,
    capabilities.perKeyRead,
    capabilities.perKeyWrite,
  ]
    .filter(({status}) => status !== 'supported')
    .map(({reason}) => reason);

export const getStaticLightingLabCapabilities = (
  protocol: number,
  matrix: MatrixDimensions,
  mapping: ActiveKeyMappingEvidence,
): LightingLabCapabilities => {
  const perKeyProtocolCapability =
    protocol >= 11
      ? unknownPerKeyCapability('Per-key RGB read')
      : ({
          status: 'unsupported',
          reason:
            'The understood per-key RGB custom-menu convention requires VIA protocol 11 or newer.',
        } satisfies LightingLabCapability);
  const capabilities = {
    matrixInput: getMatrixCapability(protocol, matrix),
    activeKeyMapping: getMappingCapability(mapping),
    perKeyRead: perKeyProtocolCapability,
    perKeyWrite:
      protocol >= 11
        ? unknownPerKeyCapability('Per-key RGB write')
        : perKeyProtocolCapability,
    perKeyBatchWrite: {
      status: 'unknown',
      reason:
        'Only count=1 is understood; Lighting Lab does not probe or issue batch writes.',
    } satisfies LightingLabCapability,
    colorChannels: {
      supported: ['hue', 'saturation'],
      unsupported: ['value'],
      reason:
        'The understood per-key custom-menu command carries hue and saturation only.',
    } as const,
    persistentSave: {
      status: 'not-used',
      reason:
        'Lighting Lab never calls CUSTOM_MENU_SAVE or another persistence command.',
    } as const,
  };

  return {
    ...capabilities,
    liveSafe: false,
    reasons: getBlockingReasons(capabilities),
  };
};

export const withPerKeyRuntimeEvidence = (
  staticCapabilities: LightingLabCapabilities,
  evidence: PerKeyRGBRuntimeEvidence,
): LightingLabCapabilities => {
  const capabilities = {
    matrixInput: staticCapabilities.matrixInput,
    activeKeyMapping: staticCapabilities.activeKeyMapping,
    perKeyRead:
      staticCapabilities.perKeyRead.status === 'unsupported'
        ? staticCapabilities.perKeyRead
        : evidence.read,
    perKeyWrite:
      staticCapabilities.perKeyWrite.status === 'unsupported'
        ? staticCapabilities.perKeyWrite
        : evidence.write,
    perKeyBatchWrite: evidence.batchWrite,
    colorChannels: staticCapabilities.colorChannels,
    persistentSave: staticCapabilities.persistentSave,
  };
  const reasons = getBlockingReasons(capabilities);

  return {
    ...capabilities,
    ...(evidence.measuredWriteLatencyMs === undefined
      ? {}
      : {measuredWriteLatencyMs: evidence.measuredWriteLatencyMs}),
    liveSafe: reasons.length === 0,
    reasons,
  };
};
