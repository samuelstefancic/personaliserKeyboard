import type {
  ConnectionProfilesSettings,
  HostPlatform,
  KeyboardTransport,
} from '../types/types';

export const KEYBOARD_TRANSPORTS: readonly KeyboardTransport[] = [
  'usb',
  'receiver-2.4g',
  'bluetooth',
];

export const HOST_PLATFORMS: readonly HostPlatform[] = [
  'windows',
  'macos',
  'other',
];

export const TRANSPORT_LABELS: Record<KeyboardTransport, string> = {
  usb: 'USB',
  'receiver-2.4g': 'Récepteur 2,4 GHz',
  bluetooth: 'Bluetooth',
};

export const PLATFORM_LABELS: Record<HostPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  other: 'Autre',
};

export const createGoldConnectionProfiles = (): ConnectionProfilesSettings => ({
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

export const suggestHostPlatform = (userAgent: string): HostPlatform => {
  const normalized = userAgent.toLowerCase();
  if (normalized.includes('windows')) {
    return 'windows';
  }
  if (normalized.includes('macintosh') || normalized.includes('mac os')) {
    return 'macos';
  }
  return 'other';
};

export const hasViaRawHidCollection = (
  collections: readonly Pick<HIDCollectionInfo, 'usage' | 'usagePage'>[],
): boolean =>
  collections.some(
    ({usage, usagePage}) => usage === 0x61 && usagePage === 0xff60,
  );

/**
 * WebHID does not expose the physical transport. This helper deliberately
 * preserves the user's declared context instead of inferring it from a path,
 * VID/PID or product name.
 */
export const resolveDeclaredTransport = (
  declaredTransport: KeyboardTransport,
): KeyboardTransport => declaredTransport;
