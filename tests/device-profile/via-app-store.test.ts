import {afterEach, describe, expect, test} from 'bun:test';
import {Store} from '../../src/shims/via-app-store';
import type {StoreData} from '../../src/types/types';
import {createGoldConnectionProfiles} from '../../src/utils/device-transport';

const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe('via app store migration snapshot', () => {
  test('does not mutate the persisted pre-profile settings while adding defaults', () => {
    const persisted = {
      settings: {hostKeyboardLayout: 'keymap_us'},
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => JSON.stringify(persisted),
        setItem: () => undefined,
      },
    });
    const defaults = {
      settings: {
        hostKeyboardLayout: 'keymap_french',
        connectionProfiles: createGoldConnectionProfiles(),
      },
    } as StoreData;

    const store = new Store(defaults);

    expect(store.persistedStore?.settings?.connectionProfiles).toBeUndefined();
    expect(store.get('settings').connectionProfiles).toBeDefined();
    expect(store.persistedStore).not.toBe(store.store);
  });
});
