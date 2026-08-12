import {describe, expect, test} from 'bun:test';
import type {Settings} from '../../src/types/types';
import {createGoldConnectionProfiles} from '../../src/utils/device-transport';
import {migrateSettings} from '../../src/utils/settings-migration';

const mergedSettings = {
  hostKeyboardLayout: 'keymap_us',
  connectionProfiles: createGoldConnectionProfiles(),
} as Settings;

describe('connection profile settings migration', () => {
  test('keeps an existing user layout when adding profiles for the first time', () => {
    const migrated = migrateSettings(mergedSettings, {
      hostKeyboardLayout: 'keymap_us',
    });

    expect(migrated.hostKeyboardLayout).toBe('keymap_us');
    expect(migrated.connectionProfiles.profiles.usb.hostKeyboardLayout).toBe(
      'keymap_us',
    );
    expect(
      migrated.connectionProfiles.profiles['receiver-2.4g'].hostKeyboardLayout,
    ).toBe('keymap_french_mac_iso');
  });

  test('does not rewrite profiles that already exist', () => {
    const persistedProfiles = createGoldConnectionProfiles();
    persistedProfiles.profiles.usb.hostKeyboardLayout = 'keymap_bepo';
    const current = {...mergedSettings, connectionProfiles: persistedProfiles};

    expect(
      migrateSettings(current, {connectionProfiles: persistedProfiles})
        .connectionProfiles.profiles.usb.hostKeyboardLayout,
    ).toBe('keymap_bepo');
  });
});
