import {describe, expect, test} from 'bun:test';
import type {VIAKey} from '@the-via/reader';
import {
  buildReactiveLedMapping,
  buildReactivePreviewLedMapping,
  calculatePhysicalKeyCenter,
} from '../../src/utils/reactive-lighting/mapping';

const key = (overrides: Partial<VIAKey>): VIAKey => ({
  a: 4,
  color: 'alpha' as VIAKey['color'],
  d: false,
  h: 1,
  w: 1,
  x: 0,
  y: 0,
  r: 0,
  rx: 0,
  ry: 0,
  row: 0,
  col: 0,
  li: 0,
  ...overrides,
});

describe('reactive LED mapping', () => {
  test('maps an active ISO key to li without equating it to matrixIndex', () => {
    const activeKeys = [
      key({row: 0, col: 0, li: 8, x: 0, y: 0}),
      key({
        row: 1,
        col: 13,
        li: 42,
        x: 13,
        y: 1,
        w: 1.25,
        h: 2,
        x2: -0.25,
        y2: 1,
        w2: 1.5,
        h2: 1,
      }),
    ];
    const mapping = buildReactiveLedMapping(activeKeys, {rows: 3, cols: 14});
    const iso = mapping.byMatrixIndex.get(27);

    expect(mapping.isComplete).toBe(true);
    expect(iso).toMatchObject({
      keyIndex: 1,
      matrixIndex: 27,
      row: 1,
      col: 13,
      ledIndex: 42,
    });
    expect(iso?.matrixIndex).not.toBe(iso?.ledIndex);
  });

  test('diagnoses and excludes duplicate matrix and LED identities', () => {
    const mapping = buildReactiveLedMapping(
      [
        key({row: 0, col: 0, li: 5}),
        key({row: 0, col: 0, li: 6}),
        key({row: 0, col: 2, li: 5}),
      ],
      {rows: 1, cols: 3},
    );

    expect(mapping.isComplete).toBe(false);
    expect(mapping.leds).toEqual([]);
    expect(mapping.diagnostics.map(({code}) => code)).toContain(
      'duplicate-matrix-position',
    );
    expect(mapping.diagnostics.map(({code}) => code)).toContain(
      'duplicate-led-index',
    );
  });

  test('rejects LED indexes that do not fit the understood HID byte', () => {
    const mapping = buildReactiveLedMapping([key({row: 0, col: 0, li: 256})], {
      rows: 1,
      cols: 1,
    });

    expect(mapping.isComplete).toBe(false);
    expect(mapping.leds).toEqual([]);
    expect(mapping.diagnostics).toEqual([
      expect.objectContaining({code: 'invalid-led-index'}),
    ]);
  });

  test('uses explicit virtual key indexes for preview when li is absent', () => {
    const activeKeys = [
      key({row: 0, col: 1, li: undefined, x: 1}),
      key({row: 1, col: 2, li: undefined, x: 2, y: 1}),
    ];
    const strictMapping = buildReactiveLedMapping(activeKeys, {
      rows: 2,
      cols: 3,
    });
    const previewMapping = buildReactivePreviewLedMapping(activeKeys, {
      rows: 2,
      cols: 3,
    });

    expect(strictMapping.isComplete).toBe(false);
    expect(previewMapping.isComplete).toBe(true);
    expect(previewMapping.leds.map(({ledIndex}) => ledIndex)).toEqual([0, 1]);
    expect(
      previewMapping.leds.every(
        ({addressSpace}) => addressSpace === 'virtual-key-index',
      ),
    ).toBe(true);
    expect(previewMapping.byMatrixIndex.get(5)).toMatchObject({
      keyIndex: 1,
      ledIndex: 1,
      addressSpace: 'virtual-key-index',
    });
  });

  test('skips decals and encoders without compressing renderer key indexes', () => {
    const activeKeys = [
      key({d: true, row: -1, col: -1, li: undefined}),
      key({ei: 0, row: -1, col: -1, li: undefined}),
      key({row: 0, col: 2, li: 9}),
    ];
    const strictMapping = buildReactiveLedMapping(activeKeys, {
      rows: 1,
      cols: 3,
    });
    const previewMapping = buildReactivePreviewLedMapping(activeKeys, {
      rows: 1,
      cols: 3,
    });

    expect(strictMapping).toMatchObject({
      eligibleKeyCount: 1,
      isComplete: true,
    });
    expect(previewMapping).toMatchObject({
      eligibleKeyCount: 1,
      isComplete: true,
    });
    expect(strictMapping.leds[0]).toMatchObject({
      keyIndex: 2,
      ledIndex: 9,
    });
    expect(previewMapping.leds[0]).toMatchObject({
      keyIndex: 2,
      ledIndex: 2,
      addressSpace: 'virtual-key-index',
    });
  });

  test('rotates the physical center around the VIA rotation origin', () => {
    const center = calculatePhysicalKeyCenter(
      key({x: 1, y: 0, r: 90, rx: 0, ry: 0}),
    );

    expect(center.x).toBeCloseTo(-0.5);
    expect(center.y).toBeCloseTo(1.5);
  });
});
