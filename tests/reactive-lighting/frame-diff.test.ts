import {describe, expect, test} from 'bun:test';
import {
  diffLedFrames,
  groupContiguousLedChanges,
} from '../../src/utils/reactive-lighting/frame-diff';

describe('LED frame diff', () => {
  test('omits unchanged LEDs and changes below the configured threshold', () => {
    const previous = new Map([
      [1, {r: 10, g: 20, b: 30}],
      [2, {r: 100, g: 100, b: 100}],
      [3, {r: 0, g: 0, b: 0}],
    ]);
    const next = new Map([
      [1, {r: 10, g: 20, b: 30}],
      [2, {r: 101, g: 99, b: 100}],
      [3, {r: 0, g: 0, b: 8}],
    ]);

    expect(diffLedFrames(previous, next, 2)).toEqual([
      {ledIndex: 3, color: {r: 0, g: 0, b: 8}},
    ]);
  });

  test('groups only contiguous LED changes and respects batch size', () => {
    const ranges = groupContiguousLedChanges(
      [
        {ledIndex: 4, color: {r: 4, g: 0, b: 0}},
        {ledIndex: 2, color: {r: 2, g: 0, b: 0}},
        {ledIndex: 3, color: {r: 3, g: 0, b: 0}},
        {ledIndex: 8, color: {r: 8, g: 0, b: 0}},
      ],
      2,
    );

    expect(
      ranges.map(({startLedIndex, colors}) => [startLedIndex, colors.length]),
    ).toEqual([
      [2, 2],
      [4, 1],
      [8, 1],
    ]);
  });
});
