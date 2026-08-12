export type ModifierHostSample = Readonly<{
  type: 'keydown' | 'keyup';
  code: string;
  key: string;
  location: number;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altGraph: boolean;
  repeat: boolean;
}>;

export type ModifierHostVerdict =
  | 'right-alt'
  | 'right-gui'
  | 'ambiguous'
  | 'insufficient';

const DOM_KEY_LOCATION_RIGHT = 2;

export const classifyRightModifier = (
  samples: readonly ModifierHostSample[],
): ModifierHostVerdict => {
  const keyDownSamples = samples.filter(
    ({type, repeat}) => type === 'keydown' && !repeat,
  );
  const sawRightGui = keyDownSamples.some(
    ({code, metaKey, location}) =>
      code === 'MetaRight' ||
      code === 'MetaLeft' ||
      code === 'OSRight' ||
      code === 'OSLeft' ||
      (metaKey && (location === DOM_KEY_LOCATION_RIGHT || location === 1)),
  );
  const sawRightAlt = keyDownSamples.some(
    ({code, metaKey}) => code === 'AltRight' && !metaKey,
  );

  if (sawRightGui && sawRightAlt) {
    return 'ambiguous';
  }
  if (sawRightGui) {
    return 'right-gui';
  }
  if (sawRightAlt) {
    return 'right-alt';
  }
  return keyDownSamples.length ? 'ambiguous' : 'insufficient';
};

export const expectedAltGrText = (hostKeyboardLayout: string): string | null =>
  hostKeyboardLayout === 'keymap_french' ? '@' : null;

export type ModifierKeyTarget = Readonly<{
  layer: number;
  row: number;
  col: number;
}>;

export type KeycodeReadWriteAPI = Pick<
  import('./keyboard-api').KeyboardAPI,
  'getKey' | 'setKey'
>;

export type VerifiedKeyChangeResult =
  | Readonly<{
      status: 'applied';
      original: number;
      target: number;
      readback: number;
    }>
  | Readonly<{
      status: 'precondition-failed' | 'write-not-applied';
      original: number;
      target: number;
      readback: number;
    }>
  | Readonly<{
      status: 'rolled-back';
      original: number;
      target: number;
      readback: number;
      reason: string;
    }>
  | Readonly<{
      status: 'unsafe-state';
      original: number;
      target: number;
      readback?: number;
      reason: string;
    }>;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const readKey = (api: KeycodeReadWriteAPI, target: ModifierKeyTarget) =>
  api.getKey(target.layer, target.row, target.col);

const writeKey = (
  api: KeycodeReadWriteAPI,
  target: ModifierKeyTarget,
  value: number,
) => api.setKey(target.layer, target.row, target.col, value);

const restoreAfterUncertainWrite = async (
  api: KeycodeReadWriteAPI,
  keyTarget: ModifierKeyTarget,
  original: number,
  target: number,
  reason: string,
): Promise<VerifiedKeyChangeResult> => {
  try {
    const reconciled = await readKey(api, keyTarget);
    if (reconciled === original) {
      return {
        status: 'write-not-applied',
        original,
        target,
        readback: reconciled,
      };
    }
    if (reconciled !== target) {
      return {
        status: 'unsafe-state',
        original,
        target,
        readback: reconciled,
        reason,
      };
    }

    await writeKey(api, keyTarget, original);
    const rollbackReadback = await readKey(api, keyTarget);
    if (rollbackReadback === original) {
      return {
        status: 'rolled-back',
        original,
        target,
        readback: rollbackReadback,
        reason,
      };
    }
    return {
      status: 'unsafe-state',
      original,
      target,
      readback: rollbackReadback,
      reason: `${reason}; rollback readback mismatch`,
    };
  } catch (rollbackError) {
    return {
      status: 'unsafe-state',
      original,
      target,
      reason: `${reason}; rollback failed: ${describeError(rollbackError)}`,
    };
  }
};

const restoreAfterUnexpectedReadback = async (
  api: KeycodeReadWriteAPI,
  keyTarget: ModifierKeyTarget,
  original: number,
  target: number,
  unexpectedReadback: number,
): Promise<VerifiedKeyChangeResult> => {
  try {
    const reconciled = await readKey(api, keyTarget);
    if (reconciled === original) {
      return {
        status: 'rolled-back',
        original,
        target,
        readback: reconciled,
        reason: `write readback returned unexpected value ${unexpectedReadback}; original value observed during reconciliation`,
      };
    }
    if (reconciled !== target) {
      return {
        status: 'unsafe-state',
        original,
        target,
        readback: reconciled,
        reason: `write readback returned unexpected value ${unexpectedReadback}; concurrent value ${reconciled} left untouched`,
      };
    }

    await writeKey(api, keyTarget, original);
    const rollbackReadback = await readKey(api, keyTarget);
    if (rollbackReadback === original) {
      return {
        status: 'rolled-back',
        original,
        target,
        readback: rollbackReadback,
        reason: `write readback returned unexpected value ${unexpectedReadback}`,
      };
    }
    return {
      status: 'unsafe-state',
      original,
      target,
      readback: rollbackReadback,
      reason: 'unexpected write readback and rollback readback mismatch',
    };
  } catch (error) {
    return {
      status: 'unsafe-state',
      original,
      target,
      readback: unexpectedReadback,
      reason: `unexpected write readback; rollback failed: ${describeError(
        error,
      )}`,
    };
  }
};

/**
 * Performs one guarded keycode write. It never writes a whole keymap, saves a
 * custom menu, resets EEPROM or enters the bootloader.
 */
export const applyVerifiedKeyChange = async (
  api: KeycodeReadWriteAPI,
  keyTarget: ModifierKeyTarget,
  expectedOriginal: number,
  targetKeycode: number,
): Promise<VerifiedKeyChangeResult> => {
  let before: number;
  try {
    before = await readKey(api, keyTarget);
  } catch (error) {
    return {
      status: 'unsafe-state',
      original: expectedOriginal,
      target: targetKeycode,
      reason: `precondition read failed: ${describeError(error)}`,
    };
  }
  if (before !== expectedOriginal) {
    return {
      status: 'precondition-failed',
      original: expectedOriginal,
      target: targetKeycode,
      readback: before,
    };
  }

  try {
    await writeKey(api, keyTarget, targetKeycode);
    const after = await readKey(api, keyTarget);
    if (after === targetKeycode) {
      return {
        status: 'applied',
        original: expectedOriginal,
        target: targetKeycode,
        readback: after,
      };
    }
    if (after === expectedOriginal) {
      return {
        status: 'write-not-applied',
        original: expectedOriginal,
        target: targetKeycode,
        readback: after,
      };
    }
    return restoreAfterUnexpectedReadback(
      api,
      keyTarget,
      expectedOriginal,
      targetKeycode,
      after,
    );
  } catch (error) {
    return restoreAfterUncertainWrite(
      api,
      keyTarget,
      expectedOriginal,
      targetKeycode,
      `write failed: ${describeError(error)}`,
    );
  }
};

export const rollbackVerifiedKeyChange = async (
  api: KeycodeReadWriteAPI,
  keyTarget: ModifierKeyTarget,
  expectedCurrent: number,
  original: number,
): Promise<VerifiedKeyChangeResult> => {
  let before: number;
  try {
    before = await readKey(api, keyTarget);
  } catch (error) {
    return {
      status: 'unsafe-state',
      original: expectedCurrent,
      target: original,
      reason: `rollback precondition read failed: ${describeError(error)}`,
    };
  }
  if (before !== expectedCurrent) {
    return {
      status: 'precondition-failed',
      original: expectedCurrent,
      target: original,
      readback: before,
    };
  }

  return applyVerifiedKeyChange(api, keyTarget, expectedCurrent, original);
};
