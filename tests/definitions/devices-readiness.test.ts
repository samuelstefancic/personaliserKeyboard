import {describe, expect, mock, test} from 'bun:test';

mock.module('src/utils/keyboard-api', () => ({
  KeyboardAPI: class {},
}));

const {
  default: devicesReducer,
  getDefinitionsReady,
  getForceAuthorize,
  setForceAuthorize,
  setDefinitionsReady,
} = await import('../../src/store/devicesSlice');
const {canRequestDeviceAuthorization} = await import(
  '../../src/utils/device-authorization'
);
mock.restore();

describe('definition loading readiness', () => {
  test('blocks device scans until all definition sources are loaded', () => {
    const initialState = devicesReducer(undefined, {type: 'test/init'});
    const rootState = {devices: initialState} as Parameters<
      typeof getDefinitionsReady
    >[0];

    expect(getDefinitionsReady(rootState)).toBe(false);

    const readyState = devicesReducer(initialState, setDefinitionsReady(true));
    expect(
      getDefinitionsReady({devices: readyState} as Parameters<
        typeof getDefinitionsReady
      >[0]),
    ).toBe(true);
  });

  test('keeps the native chooser as an explicit one-shot request', () => {
    const initialState = devicesReducer(undefined, {type: 'test/init'});
    const requested = devicesReducer(initialState, setForceAuthorize(true));
    const consumed = devicesReducer(requested, setForceAuthorize(false));

    expect(
      getForceAuthorize({devices: requested} as Parameters<
        typeof getForceAuthorize
      >[0]),
    ).toBe(true);
    expect(
      getForceAuthorize({devices: consumed} as Parameters<
        typeof getForceAuthorize
      >[0]),
    ).toBe(false);
  });

  test('does not defer an authorization click made before definitions are ready', () => {
    const initialState = devicesReducer(undefined, {type: 'test/init'});
    const prematurelyArmed = devicesReducer(
      initialState,
      setForceAuthorize(true),
    );
    const chooserAllowed = canRequestDeviceAuthorization(
      getDefinitionsReady({devices: initialState} as any),
    );
    const cancelled = devicesReducer(
      prematurelyArmed,
      setForceAuthorize(chooserAllowed),
    );

    expect(chooserAllowed).toBe(false);
    expect(getForceAuthorize({devices: cancelled} as any)).toBe(false);
  });
});
