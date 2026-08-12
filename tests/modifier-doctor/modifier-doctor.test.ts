import {describe, expect, test} from 'bun:test';
import {
  applyVerifiedKeyChange,
  classifyRightModifier,
  expectedAltGrText,
  rollbackVerifiedKeyChange,
  type KeycodeReadWriteAPI,
  type ModifierHostSample,
} from '../../src/utils/modifier-doctor';

const sample = (
  overrides: Partial<ModifierHostSample> = {},
): ModifierHostSample => ({
  type: 'keydown',
  code: 'AltRight',
  key: 'AltGraph',
  location: 2,
  ctrlKey: true,
  altKey: true,
  metaKey: false,
  shiftKey: false,
  altGraph: true,
  repeat: false,
  ...overrides,
});

class FakeKeycodeAPI implements KeycodeReadWriteAPI {
  value: number;
  calls: string[] = [];
  throwOnSet = false;
  setThenThrow = false;
  ignoreSet = false;
  throwOnGet = false;
  readOverrides: number[] = [];

  constructor(value: number) {
    this.value = value;
  }

  async getKey(layer: number, row: number, col: number) {
    this.calls.push(`get:${layer}:${row}:${col}`);
    if (this.throwOnGet) {
      this.throwOnGet = false;
      throw new Error('simulated read failure');
    }
    return this.readOverrides.length ? this.readOverrides.shift()! : this.value;
  }

  async setKey(layer: number, row: number, col: number, value: number) {
    this.calls.push(`set:${layer}:${row}:${col}:${value}`);
    if (!this.ignoreSet) {
      this.value = value;
    }
    if (this.throwOnSet || this.setThenThrow) {
      this.throwOnSet = false;
      this.setThenThrow = false;
      throw new Error('simulated write failure');
    }
    return value;
  }
}

const target = {layer: 0, row: 5, col: 10};
const KC_RGUI = 0x00e7;
const KC_RALT = 0x00e6;

describe('Windows modifier diagnosis', () => {
  test('distinguishes Right Alt from Right GUI and refuses mixed evidence', () => {
    expect(classifyRightModifier([sample()])).toBe('right-alt');
    expect(
      classifyRightModifier([
        sample({code: 'MetaRight', key: 'Meta', metaKey: true, altKey: false}),
      ]),
    ).toBe('right-gui');
    expect(
      classifyRightModifier([
        sample({
          code: 'MetaLeft',
          key: 'Meta',
          location: 1,
          metaKey: true,
          altKey: false,
        }),
      ]),
    ).toBe('right-gui');
    expect(
      classifyRightModifier([
        sample(),
        sample({code: 'MetaRight', key: 'Meta', metaKey: true}),
      ]),
    ).toBe('ambiguous');
    expect(classifyRightModifier([])).toBe('insufficient');
  });

  test('does not confuse the VIA label layout with every French layout', () => {
    expect(expectedAltGrText('keymap_french')).toBe('@');
    expect(expectedAltGrText('keymap_french_afnor')).toBeNull();
    expect(expectedAltGrText('keymap_us')).toBeNull();
  });
});

describe('verified one-key correction', () => {
  test('performs one guarded SET followed by readback', async () => {
    const api = new FakeKeycodeAPI(KC_RGUI);
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('applied');
    expect(api.value).toBe(KC_RALT);
    expect(api.calls).toEqual([
      'get:0:5:10',
      `set:0:5:10:${KC_RALT}`,
      'get:0:5:10',
    ]);
  });

  test('does not write when the precondition changed', async () => {
    const api = new FakeKeycodeAPI(0x1234);
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('precondition-failed');
    expect(api.calls).toEqual(['get:0:5:10']);
  });

  test('reconciles and rolls back when SET throws after changing the key', async () => {
    const api = new FakeKeycodeAPI(KC_RGUI);
    api.setThenThrow = true;
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('rolled-back');
    expect(api.value).toBe(KC_RGUI);
    expect(api.calls).toEqual([
      'get:0:5:10',
      `set:0:5:10:${KC_RALT}`,
      'get:0:5:10',
      `set:0:5:10:${KC_RGUI}`,
      'get:0:5:10',
    ]);
  });

  test('rolls back an unexpected third-value readback', async () => {
    const api = new FakeKeycodeAPI(KC_RGUI);
    api.readOverrides = [KC_RGUI, 0x1234];
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('rolled-back');
    expect(api.value).toBe(KC_RGUI);
    expect(api.calls).toEqual([
      'get:0:5:10',
      `set:0:5:10:${KC_RALT}`,
      'get:0:5:10',
      'get:0:5:10',
      `set:0:5:10:${KC_RGUI}`,
      'get:0:5:10',
    ]);
  });

  test('leaves a persistent concurrent value untouched', async () => {
    const api = new FakeKeycodeAPI(KC_RGUI);
    api.readOverrides = [KC_RGUI, 0x1234, 0x1234];
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('unsafe-state');
    expect(api.calls.filter((call) => call.startsWith('set:'))).toEqual([
      `set:0:5:10:${KC_RALT}`,
    ]);
  });

  test('fails closed when the precondition cannot be read', async () => {
    const api = new FakeKeycodeAPI(KC_RGUI);
    api.throwOnGet = true;
    const result = await applyVerifiedKeyChange(api, target, KC_RGUI, KC_RALT);

    expect(result.status).toBe('unsafe-state');
    expect(api.calls).toEqual(['get:0:5:10']);
  });

  test('provides a guarded manual rollback', async () => {
    const api = new FakeKeycodeAPI(KC_RALT);
    const result = await rollbackVerifiedKeyChange(
      api,
      target,
      KC_RALT,
      KC_RGUI,
    );

    expect(result.status).toBe('applied');
    expect(api.value).toBe(KC_RGUI);
    expect(api.calls.filter((call) => call.startsWith('set:'))).toEqual([
      `set:0:5:10:${KC_RGUI}`,
    ]);
  });
});
