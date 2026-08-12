import {afterEach, describe, expect, test} from 'bun:test';
import {HID} from '../../src/shims/node-hid';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('WebHID authorization policy', () => {
  test('never opens the native chooser during an automatic scan', async () => {
    let requestCount = 0;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        hid: {
          getDevices: async () => [],
          requestDevice: async () => {
            requestCount++;
            return [];
          },
        },
      },
    });

    expect(await HID.devices(false)).toEqual([]);
    expect(requestCount).toBe(0);

    expect(await HID.devices(true)).toEqual([]);
    expect(requestCount).toBe(1);
  });
});
