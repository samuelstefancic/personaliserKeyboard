export type MatrixTransition = Readonly<{
  matrixIndex: number;
  row: number;
  col: number;
  type: 'down' | 'up';
}>;

export type MatrixSnapshot = ReadonlyArray<number> | Uint8Array;

export type MatrixTransitionResult = Readonly<{
  snapshot: Uint8Array;
  transitions: readonly MatrixTransition[];
}>;

const validateDimensions = (rows: number, cols: number) => {
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(cols) ||
    rows <= 0 ||
    cols <= 0
  ) {
    throw new RangeError('Matrix rows and columns must be positive integers');
  }
};

const normalizeSnapshot = (
  snapshot: MatrixSnapshot,
  expectedLength: number,
) => {
  if (snapshot.length < expectedLength) {
    throw new RangeError(
      `Matrix snapshot has ${snapshot.length} bytes; expected ${expectedLength}`,
    );
  }
  return Uint8Array.from(
    Array.from(snapshot).slice(0, expectedLength),
    (value) => value & 0xff,
  );
};

const isKeyDown = (
  snapshot: Uint8Array,
  row: number,
  col: number,
  bytesPerRow: number,
) => {
  // VIA returns the high column group first within each packed matrix row.
  const byteInRow = bytesPerRow - 1 - Math.floor(col / 8);
  const byteIndex = row * bytesPerRow + byteInRow;
  return (snapshot[byteIndex] & (1 << col % 8)) !== 0;
};

/**
 * Treating a missing previous snapshot as a baseline prevents keys already
 * held when polling starts from being reported as new presses.
 */
export const diffMatrixTransitions = (
  previous: MatrixSnapshot | null,
  current: MatrixSnapshot,
  rows: number,
  cols: number,
): MatrixTransitionResult => {
  validateDimensions(rows, cols);
  const bytesPerRow = Math.ceil(cols / 8);
  const expectedLength = rows * bytesPerRow;
  const nextSnapshot = normalizeSnapshot(current, expectedLength);

  if (previous === null) {
    return {snapshot: nextSnapshot, transitions: []};
  }

  const previousSnapshot = normalizeSnapshot(previous, expectedLength);
  const transitions: MatrixTransition[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const wasDown = isKeyDown(previousSnapshot, row, col, bytesPerRow);
      const isDown = isKeyDown(nextSnapshot, row, col, bytesPerRow);
      if (wasDown !== isDown) {
        transitions.push({
          matrixIndex: row * cols + col,
          row,
          col,
          type: isDown ? 'down' : 'up',
        });
      }
    }
  }

  return {snapshot: nextSnapshot, transitions};
};
