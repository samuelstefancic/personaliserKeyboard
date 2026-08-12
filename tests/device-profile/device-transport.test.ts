import {describe, expect, test} from 'bun:test';
import {
  createGoldConnectionProfiles,
  hasViaRawHidCollection,
  resolveDeclaredTransport,
  suggestHostPlatform,
} from '../../src/utils/device-transport';

describe('declared EVO75 connection profiles', () => {
  test('encodes the Gold USB/Windows and wireless/macOS topology', () => {
    expect(createGoldConnectionProfiles()).toEqual({
      activeTransport: 'usb',
      profiles: {
        usb: {platform: 'windows', hostKeyboardLayout: 'keymap_french'},
        'receiver-2.4g': {
          platform: 'macos',
          hostKeyboardLayout: 'keymap_french_mac_iso',
        },
        bluetooth: {
          platform: 'macos',
          hostKeyboardLayout: 'keymap_french_mac_iso',
        },
      },
    });
  });

  test('suggests only the local host context, never a detected transport', () => {
    expect(suggestHostPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe(
      'windows',
    );
    expect(suggestHostPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(
      'macos',
    );
    expect(suggestHostPlatform('unknown')).toBe('other');
  });

  test('keeps transport as an explicit declaration even for identical devices', () => {
    expect(resolveDeclaredTransport('usb')).toBe('usb');
    expect(resolveDeclaredTransport('receiver-2.4g')).toBe('receiver-2.4g');
    expect(resolveDeclaredTransport('bluetooth')).toBe('bluetooth');
  });

  test('requires the VIA vendor collection for configurability', () => {
    expect(hasViaRawHidCollection([{usagePage: 0xff60, usage: 0x61}])).toBe(
      true,
    );
    expect(
      hasViaRawHidCollection([
        {usagePage: 0x01, usage: 0x06},
        {usagePage: 0xff31, usage: 0x74},
      ]),
    ).toBe(false);
  });
});
