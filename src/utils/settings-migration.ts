import type {Settings} from '../types/types';

export const migrateSettings = (
  settings: Settings,
  persistedSettings?: Partial<Settings>,
): Settings => {
  const activeTransport = settings.connectionProfiles.activeTransport;
  const activeProfile = settings.connectionProfiles.profiles[activeTransport];
  if (!persistedSettings || persistedSettings.connectionProfiles) {
    return settings;
  }

  return {
    ...settings,
    connectionProfiles: {
      ...settings.connectionProfiles,
      profiles: {
        ...settings.connectionProfiles.profiles,
        [activeTransport]: {
          ...activeProfile,
          hostKeyboardLayout: settings.hostKeyboardLayout,
        },
      },
    },
  };
};
