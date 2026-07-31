import {describe, expect, test} from 'bun:test';
import {createRipple} from '../../src/utils/reactive-lighting/engine';
import {diffMatrixTransitions} from '../../src/utils/reactive-lighting/matrix-transitions';

describe('matrix transitions', () => {
  test('uses the first snapshot as a baseline', () => {
    const result = diffMatrixTransitions(null, [1], 1, 1);

    expect(result.transitions).toEqual([]);
    expect([...result.snapshot]).toEqual([1]);
  });

  test('allows a second down on the same key only after an up', () => {
    let snapshot = diffMatrixTransitions(null, [0], 1, 1).snapshot;
    const firstDown = diffMatrixTransitions(snapshot, [1], 1, 1);
    snapshot = firstDown.snapshot;
    const up = diffMatrixTransitions(snapshot, [0], 1, 1);
    snapshot = up.snapshot;
    const secondDown = diffMatrixTransitions(snapshot, [1], 1, 1);

    expect(firstDown.transitions).toEqual([
      {matrixIndex: 0, row: 0, col: 0, type: 'down'},
    ]);
    expect(up.transitions[0]?.type).toBe('up');
    expect(secondDown.transitions).toEqual([
      {matrixIndex: 0, row: 0, col: 0, type: 'down'},
    ]);

    const instances = [
      createRipple({
        id: 'same-key-1',
        originLedIndex: 7,
        originX: 0,
        originY: 0,
        startedAt: 10,
        color: {r: 255, g: 0, b: 0},
      }),
      createRipple({
        id: 'same-key-2',
        originLedIndex: 7,
        originX: 0,
        originY: 0,
        startedAt: 30,
        color: {r: 255, g: 0, b: 0},
      }),
    ];
    expect(instances).toHaveLength(2);
    expect(instances[0].originLedIndex).toBe(instances[1].originLedIndex);
    expect(instances[0].id).not.toBe(instances[1].id);
    expect(instances[0].startedAt).not.toBe(instances[1].startedAt);
  });

  test('does not repeat a down transition while a key is held', () => {
    const baseline = diffMatrixTransitions(null, [0], 1, 1).snapshot;
    const pressed = diffMatrixTransitions(baseline, [1], 1, 1);
    const held = diffMatrixTransitions(pressed.snapshot, [1], 1, 1);

    expect(pressed.transitions).toHaveLength(1);
    expect(held.transitions).toEqual([]);
  });

  test('decodes VIA packed columns in matrix order', () => {
    const baseline = diffMatrixTransitions(null, [0, 0], 1, 10).snapshot;
    const lowColumn = diffMatrixTransitions(baseline, [0, 1], 1, 10);
    const highColumn = diffMatrixTransitions(lowColumn.snapshot, [2, 1], 1, 10);

    expect(lowColumn.transitions[0]).toMatchObject({
      matrixIndex: 0,
      col: 0,
      type: 'down',
    });
    expect(highColumn.transitions[0]).toMatchObject({
      matrixIndex: 9,
      col: 9,
      type: 'down',
    });
  });
});
