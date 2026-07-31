import type {VIAKey} from '@the-via/reader';
import type {ReactiveLed} from './types';

export type MappingDiagnosticCode =
  | 'matrix-out-of-bounds'
  | 'missing-led-index'
  | 'invalid-led-index'
  | 'duplicate-matrix-position'
  | 'duplicate-led-index';

export type MappingDiagnostic = Readonly<{
  code: MappingDiagnosticCode;
  keyIndices: readonly number[];
  message: string;
}>;

export type ReactiveLedMapping = Readonly<{
  leds: readonly ReactiveLed[];
  byMatrixIndex: ReadonlyMap<number, ReactiveLed>;
  byLedIndex: ReadonlyMap<number, ReactiveLed>;
  diagnostics: readonly MappingDiagnostic[];
  eligibleKeyCount: number;
  isComplete: boolean;
}>;

export type VirtualPreviewLed = ReactiveLed &
  Readonly<{
    addressSpace: 'virtual-key-index';
  }>;

export type ReactivePreviewLedMapping = Readonly<{
  leds: readonly VirtualPreviewLed[];
  byMatrixIndex: ReadonlyMap<number, VirtualPreviewLed>;
  diagnostics: readonly MappingDiagnostic[];
  eligibleKeyCount: number;
  isComplete: boolean;
}>;

type KeyGeometry = Pick<
  VIAKey,
  'x' | 'y' | 'w' | 'h' | 'x2' | 'y2' | 'w2' | 'h2' | 'r' | 'rx' | 'ry'
>;

export const calculatePhysicalKeyCenter = ({
  x,
  y,
  w,
  h,
  x2,
  y2,
  w2,
  h2,
  r,
  rx,
  ry,
}: KeyGeometry): Readonly<{x: number; y: number}> => {
  const hasSecondaryRectangle =
    x2 !== undefined ||
    y2 !== undefined ||
    w2 !== undefined ||
    h2 !== undefined;
  const secondaryX = x + (x2 ?? 0);
  const secondaryY = y + (y2 ?? 0);
  const minX = hasSecondaryRectangle ? Math.min(x, secondaryX) : x;
  const minY = hasSecondaryRectangle ? Math.min(y, secondaryY) : y;
  const maxX = hasSecondaryRectangle
    ? Math.max(x + w, secondaryX + (w2 ?? w))
    : x + w;
  const maxY = hasSecondaryRectangle
    ? Math.max(y + h, secondaryY + (h2 ?? h))
    : y + h;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radians = (r * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const offsetX = centerX - rx;
  const offsetY = centerY - ry;

  return {
    x: rx + offsetX * cos - offsetY * sin,
    y: ry + offsetX * sin + offsetY * cos,
  };
};

const groupKeyIndices = (
  candidates: readonly ReactiveLed[],
  getIdentity: (candidate: ReactiveLed) => number,
) => {
  const groups = new Map<number, number[]>();
  for (const candidate of candidates) {
    const identity = getIdentity(candidate);
    groups.set(identity, [...(groups.get(identity) ?? []), candidate.keyIndex]);
  }
  return groups;
};

export const isReactiveLightingKey = (key: VIAKey) =>
  !key.d && key.ei === undefined;

/**
 * Builds the explicit row/column -> active VIA key -> physical center -> `li`
 * association. Ambiguous entries are diagnosed and excluded from the usable
 * maps so callers cannot accidentally address an arbitrary LED.
 */
export const buildReactiveLedMapping = (
  activeKeys: readonly VIAKey[],
  matrix: Readonly<{rows: number; cols: number}>,
): ReactiveLedMapping => {
  const diagnostics: MappingDiagnostic[] = [];
  const candidates: ReactiveLed[] = [];
  const eligibleKeyCount = activeKeys.filter(isReactiveLightingKey).length;

  activeKeys.forEach((key, keyIndex) => {
    if (!isReactiveLightingKey(key)) {
      return;
    }

    if (
      !Number.isSafeInteger(key.row) ||
      !Number.isSafeInteger(key.col) ||
      key.row < 0 ||
      key.row >= matrix.rows ||
      key.col < 0 ||
      key.col >= matrix.cols
    ) {
      diagnostics.push({
        code: 'matrix-out-of-bounds',
        keyIndices: [keyIndex],
        message: `Key ${keyIndex} has matrix position ${key.row},${key.col} outside ${matrix.rows}x${matrix.cols}`,
      });
      return;
    }

    if (key.li === undefined) {
      diagnostics.push({
        code: 'missing-led-index',
        keyIndices: [keyIndex],
        message: `Key ${keyIndex} at ${key.row},${key.col} has no LED index`,
      });
      return;
    }

    if (!Number.isSafeInteger(key.li) || key.li < 0 || key.li > 0xff) {
      diagnostics.push({
        code: 'invalid-led-index',
        keyIndices: [keyIndex],
        message: `Key ${keyIndex} has invalid LED index ${key.li}`,
      });
      return;
    }

    const center = calculatePhysicalKeyCenter(key);
    candidates.push({
      keyIndex,
      matrixIndex: key.row * matrix.cols + key.col,
      row: key.row,
      col: key.col,
      ledIndex: key.li,
      x: center.x,
      y: center.y,
    });
  });

  const matrixGroups = groupKeyIndices(
    candidates,
    (candidate) => candidate.matrixIndex,
  );
  const ledGroups = groupKeyIndices(
    candidates,
    (candidate) => candidate.ledIndex,
  );

  for (const [matrixIndex, keyIndices] of matrixGroups) {
    if (keyIndices.length > 1) {
      diagnostics.push({
        code: 'duplicate-matrix-position',
        keyIndices,
        message: `Keys ${keyIndices.join(
          ', ',
        )} share matrix index ${matrixIndex}`,
      });
    }
  }
  for (const [ledIndex, keyIndices] of ledGroups) {
    if (keyIndices.length > 1) {
      diagnostics.push({
        code: 'duplicate-led-index',
        keyIndices,
        message: `Keys ${keyIndices.join(', ')} share LED index ${ledIndex}`,
      });
    }
  }

  const leds = candidates.filter(
    (candidate) =>
      matrixGroups.get(candidate.matrixIndex)?.length === 1 &&
      ledGroups.get(candidate.ledIndex)?.length === 1,
  );
  const byMatrixIndex = new Map(
    leds.map((led) => [led.matrixIndex, led] as const),
  );
  const byLedIndex = new Map(leds.map((led) => [led.ledIndex, led] as const));

  return {
    leds,
    byMatrixIndex,
    byLedIndex,
    diagnostics,
    eligibleKeyCount,
    isComplete: diagnostics.length === 0 && leds.length === eligibleKeyCount,
  };
};

/**
 * Builds a preview-only row/column -> active key -> physical center mapping.
 *
 * Its `ledIndex` is deliberately virtual and equals `keyIndex`, allowing the
 * renderer and pure engine to share their frame shape when the active
 * definition has no `li`. These indexes must never be sent to hardware.
 */
export const buildReactivePreviewLedMapping = (
  activeKeys: readonly VIAKey[],
  matrix: Readonly<{rows: number; cols: number}>,
): ReactivePreviewLedMapping => {
  const diagnostics: MappingDiagnostic[] = [];
  const candidates: VirtualPreviewLed[] = [];
  const eligibleKeyCount = activeKeys.filter(isReactiveLightingKey).length;

  activeKeys.forEach((key, keyIndex) => {
    if (!isReactiveLightingKey(key)) {
      return;
    }

    if (
      !Number.isSafeInteger(key.row) ||
      !Number.isSafeInteger(key.col) ||
      key.row < 0 ||
      key.row >= matrix.rows ||
      key.col < 0 ||
      key.col >= matrix.cols
    ) {
      diagnostics.push({
        code: 'matrix-out-of-bounds',
        keyIndices: [keyIndex],
        message: `Key ${keyIndex} has matrix position ${key.row},${key.col} outside ${matrix.rows}x${matrix.cols}`,
      });
      return;
    }

    const center = calculatePhysicalKeyCenter(key);
    candidates.push({
      addressSpace: 'virtual-key-index',
      keyIndex,
      matrixIndex: key.row * matrix.cols + key.col,
      row: key.row,
      col: key.col,
      ledIndex: keyIndex,
      x: center.x,
      y: center.y,
    });
  });

  const matrixGroups = groupKeyIndices(
    candidates,
    (candidate) => candidate.matrixIndex,
  );
  for (const [matrixIndex, keyIndices] of matrixGroups) {
    if (keyIndices.length > 1) {
      diagnostics.push({
        code: 'duplicate-matrix-position',
        keyIndices,
        message: `Keys ${keyIndices.join(
          ', ',
        )} share matrix index ${matrixIndex}`,
      });
    }
  }

  const leds = candidates.filter(
    (candidate) => matrixGroups.get(candidate.matrixIndex)?.length === 1,
  );
  return {
    leds,
    byMatrixIndex: new Map(leds.map((led) => [led.matrixIndex, led] as const)),
    diagnostics,
    eligibleKeyCount,
    isComplete: diagnostics.length === 0 && leds.length === eligibleKeyCount,
  };
};
