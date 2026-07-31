import type {VIAKey} from '@the-via/reader';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {AccentButton} from '../../../../inputs/accent-button';
import {AccentRange} from '../../../../inputs/accent-range';
import {AccentSelect} from '../../../../inputs/accent-select';
import {AccentSlider} from '../../../../inputs/accent-slider';
import {ColorPicker} from '../../../../inputs/color-picker';
import {ControlRow, Detail, Label} from '../../../grid';
import {KeyboardCanvas} from 'src/components/two-string/keyboard-canvas';
import {
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {
  getIsSelectedDeviceReady,
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeymap} from 'src/store/keymapSlice';
import {DisplayMode, KeyColorPair} from 'src/types/keyboard-rendering';
import {
  getStaticLightingLabCapabilities,
  LightingLabCapabilities,
  LightingLabCapability,
} from 'src/utils/reactive-lighting/capabilities';
import {createAsyncTaskGate} from 'src/utils/reactive-lighting/async-task-gate';
import {
  calculateSafeDeviceUpdateCadence,
  SafeDeviceUpdateCadence,
} from 'src/utils/reactive-lighting/cadence';
import {writeChangedLedFrame} from 'src/utils/reactive-lighting/device-frame-writer';
import {
  addRipple,
  BLACK,
  createRipple,
  DEFAULT_RIPPLE_SETTINGS,
  pruneExpiredRipples,
  renderRippleFrame,
} from 'src/utils/reactive-lighting/engine';
import {diffLedFrames} from 'src/utils/reactive-lighting/frame-diff';
import {
  createLatestFrameWriter,
  LatestFrameWriter,
} from 'src/utils/reactive-lighting/latest-frame-writer';
import {
  buildReactiveLedMapping,
  buildReactivePreviewLedMapping,
  MappingDiagnostic,
  VirtualPreviewLed,
} from 'src/utils/reactive-lighting/mapping';
import {
  acquireMatrixStateSource,
  MatrixStateSourceHandle,
} from 'src/utils/reactive-lighting/matrix-state-source';
import {
  PerKeyHueSaturation,
  PerKeyRGBDeviceSession,
  probeTemporaryPerKeyRGB,
} from 'src/utils/reactive-lighting/per-key-device';
import type {
  LedFrame,
  RGBColor,
  RippleInstance,
  RippleSettings,
} from 'src/utils/reactive-lighting/types';

const EFFECT_OPTION = {
  label: 'Concurrent Reactive Ripple',
  value: 'concurrent-reactive-ripple',
};
const EMPTY_KEYMAP: number[] = [];
const FRAME_DIFF_THRESHOLD = 4;
const DEVICE_CADENCE_SAFETY_MARGIN = 1.5;

type LabRunState =
  | 'idle'
  | 'starting'
  | 'preview'
  | 'awaiting-confirmation'
  | 'live'
  | 'stopping'
  | 'error';

type LabSettings = RippleSettings & {
  deviceUpdateRate: number;
};

type DeviceMetrics = {
  startedAt: number;
  writeFrames: number;
  ledWrites: number;
  totalCommandLatencyMs: number;
};

const DEFAULT_SETTINGS: LabSettings = {
  ...DEFAULT_RIPPLE_SETTINGS,
  deviceUpdateRate: 15,
};

const EMPTY_METRICS: DeviceMetrics = {
  startedAt: 0,
  writeFrames: 0,
  ledWrites: 0,
  totalCommandLatencyMs: 0,
};

const LabContainer = styled.div`
  width: 100%;
  max-width: 960px;
  padding: 18px 5px 40px;
  box-sizing: border-box;
`;

const Heading = styled.div`
  border-bottom: 1px solid var(--border_color_cell);
  padding: 0 5px 16px;

  h2 {
    color: var(--color_label-highlighted);
    font-size: 26px;
    font-weight: 400;
    margin: 8px 0;
  }

  p {
    color: var(--color_label);
    line-height: 1.45;
    margin: 0;
  }
`;

const ExperimentalBadge = styled.span`
  border: 1px solid var(--color_accent);
  border-radius: 12px;
  color: var(--color_accent);
  display: inline-block;
  font-size: 13px;
  line-height: 22px;
  padding: 0 10px;
  text-transform: uppercase;
`;

const InlineValue = styled.span`
  color: var(--color_label);
  font-size: 16px;
  margin-left: 10px;
  min-width: 82px;
  text-align: right;
`;

const DisabledControl = styled.span<{$disabled: boolean}>`
  align-items: center;
  display: inline-flex;
  opacity: ${(props) => (props.$disabled ? 0.45 : 1)};
  pointer-events: ${(props) => (props.$disabled ? 'none' : 'auto')};
`;

const HelpText = styled.p`
  color: var(--color_label);
  font-size: 15px;
  line-height: 1.45;
  margin: 10px 5px 16px;
`;

const PreviewFrame = styled.div`
  align-items: center;
  background: var(--bg_menu);
  border: 1px solid var(--border_color_cell);
  border-radius: 6px;
  box-sizing: border-box;
  display: flex;
  height: 330px;
  justify-content: center;
  margin: 14px 0;
  overflow: hidden;
  position: relative;
  width: 100%;
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 5px;
`;

const StatusPanel = styled.div`
  background: var(--bg_menu);
  border: 1px solid var(--border_color_cell);
  border-radius: 6px;
  color: var(--color_label);
  font-size: 15px;
  line-height: 1.4;
  margin: 10px 0;
  padding: 12px;
`;

const StatusTitle = styled.div`
  color: var(--color_label-highlighted);
  font-size: 18px;
  margin-bottom: 8px;
`;

const CapabilityList = styled.div`
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(150px, 0.35fr) minmax(0, 1fr);
`;

const CapabilityName = styled.span`
  color: var(--color_label-highlighted);
`;

const CapabilityValue = styled.span<{$status: string}>`
  color: ${(props) =>
    props.$status === 'supported'
      ? '#69d391'
      : props.$status === 'unsupported'
      ? '#ff7b7b'
      : 'var(--color_label)'};
`;

const Advanced = styled.details`
  border-bottom: 1px solid var(--border_color_cell);
  margin-top: 8px;

  summary {
    color: var(--color_accent);
    cursor: pointer;
    font-size: 18px;
    line-height: 50px;
    padding: 0 5px;
  }
`;

const formatHexId = (value: number) =>
  value.toString(16).toUpperCase().padStart(4, '0');

const clampByte = (value: number) =>
  Math.min(255, Math.max(0, Math.round(value)));

const hueSaturationToRGB = ([
  hue,
  saturation,
]: PerKeyHueSaturation): RGBColor => {
  const h = (hue / 255) * 360;
  const s = saturation / 255;
  const chroma = s * 255;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = 255 - chroma;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
      ? [x, chroma, 0]
      : h < 180
      ? [0, chroma, x]
      : h < 240
      ? [0, x, chroma]
      : h < 300
      ? [x, 0, chroma]
      : [chroma, 0, x];
  return {
    r: clampByte(r + match),
    g: clampByte(g + match),
    b: clampByte(b + match),
  };
};

const rgbToHueSaturation = ({r, g, b}: RGBColor): PerKeyHueSaturation => {
  const red = clampByte(r) / 255;
  const green = clampByte(g) / 255;
  const blue = clampByte(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return [
    clampByte((((hue + 360) % 360) / 360) * 255),
    clampByte((max === 0 ? 0 : delta / max) * 255),
  ];
};

const pickerColorToRGB = (hue: number, saturation: number): RGBColor =>
  hueSaturationToRGB([clampByte(hue), clampByte(saturation)]);

const rgbToHex = ({r, g, b}: RGBColor) =>
  `#${[r, g, b]
    .map((channel) => clampByte(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const getTextColor = ({r, g, b}: RGBColor) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#151515' : '#ffffff';

const frameToKeyColors = (
  frame: LedFrame,
  keyCount: number,
): (KeyColorPair | undefined)[] => {
  const colors = Array<KeyColorPair | undefined>(keyCount).fill(undefined);
  frame.forEach((color, keyIndex) => {
    const keyColor = rgbToHex(color);
    colors[keyIndex] = {c: keyColor, t: getTextColor(color)};
  });
  return colors;
};

const getDuplicateKeyIndices = (
  diagnostics: readonly MappingDiagnostic[],
  code: MappingDiagnostic['code'],
) =>
  diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .flatMap(({keyIndices}) => keyIndices);

const getCentralLed = (leds: readonly VirtualPreviewLed[]) => {
  if (leds.length === 0) {
    return undefined;
  }
  const bounds = leds.reduce(
    (current, led) => ({
      minX: Math.min(current.minX, led.x),
      maxX: Math.max(current.maxX, led.x),
      minY: Math.min(current.minY, led.y),
      maxY: Math.max(current.maxY, led.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return [...leds].sort(
    (left, right) =>
      Math.hypot(left.x - centerX, left.y - centerY) -
      Math.hypot(right.x - centerX, right.y - centerY),
  )[0];
};

const getAnimationNow = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

const describeCapability = (
  capability: LightingLabCapability,
): {status: string; text: string} => ({
  status: capability.status,
  text: `${capability.status}: ${capability.reason}`,
});

export const LightingLabPane = () => {
  const {t} = useTranslation();
  const definition = useAppSelector(getSelectedDefinition);
  const activeKeys = useAppSelector(getSelectedKeyDefinitions) as (VIAKey & {
    ei?: number;
  })[];
  const matrixKeycodes = useAppSelector(
    (state) => getSelectedKeymap(state) || EMPTY_KEYMAP,
  );
  const device = useAppSelector(getSelectedConnectedDevice);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const isDeviceReady = useAppSelector(getIsSelectedDeviceReady);
  const apiAddress = typeof api === 'string' ? undefined : api?.kbAddr;

  const [settings, setSettings] = useState<LabSettings>(DEFAULT_SETTINGS);
  const [pickerColor, setPickerColor] = useState({hue: 170, sat: 255});
  const [liveRequested, setLiveRequested] = useState(false);
  const [runState, setRunState] = useState<LabRunState>('idle');
  const [status, setStatus] = useState(
    'Ready. Start preview or trigger a test ripple.',
  );
  const [runtimeCapabilities, setRuntimeCapabilities] =
    useState<LightingLabCapabilities>();
  const [deviceCadence, setDeviceCadence] = useState<SafeDeviceUpdateCadence>();
  const [previewColors, setPreviewColors] = useState<
    (KeyColorPair | undefined)[]
  >([]);
  const [metrics, setMetrics] = useState<DeviceMetrics>(EMPTY_METRICS);
  const [rejectedRipples, setRejectedRipples] = useState(0);
  const [previewDimensions, setPreviewDimensions] = useState<DOMRect>();

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const liveActiveRef = useRef(false);
  const awaitingConfirmationRef = useRef(false);
  const runTokenRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const matrixSourceRef = useRef<MatrixStateSourceHandle>();
  const writerRef = useRef<LatestFrameWriter<LedFrame>>();
  const deviceSessionRef = useRef<PerKeyRGBDeviceSession>();
  const ripplesRef = useRef<readonly RippleInstance[]>([]);
  const rippleSequenceRef = useRef(0);
  const previewFrameRef = useRef<LedFrame | null>(null);
  const visualBackgroundRef = useRef<LedFrame>(new Map());
  const lastHardwareFrameRef = useRef<LedFrame | null>(null);
  const lastHardwareHueSaturationRef = useRef(
    new Map<number, PerKeyHueSaturation>(),
  );
  const lastDeviceSubmitAtRef = useRef(0);
  const deviceCadenceRef = useRef<SafeDeviceUpdateCadence>();
  const settingsRef = useRef(settings);
  const primaryColorRef = useRef(
    pickerColorToRGB(pickerColor.hue, pickerColor.sat),
  );
  const stopRef = useRef<(reason?: string, silent?: boolean) => Promise<void>>(
    async () => {},
  );
  const stopGateRef = useRef(createAsyncTaskGate());
  const stopRequestEpochRef = useRef(0);
  const stopAnnouncementRef = useRef<{reason: string}>();
  const selectedLightingIdentityRef = useRef<string>();

  settingsRef.current = settings;
  primaryColorRef.current = pickerColorToRGB(pickerColor.hue, pickerColor.sat);

  const mappings = useMemo(() => {
    if (!definition) {
      return undefined;
    }
    return {
      preview: buildReactivePreviewLedMapping(activeKeys, definition.matrix),
      hardware: buildReactiveLedMapping(activeKeys, definition.matrix),
    };
  }, [activeKeys, definition]);

  const lightingIdentity = useMemo(
    () =>
      JSON.stringify({
        devicePath: device?.path,
        deviceVendorId: device?.vendorId,
        deviceProductId: device?.productId,
        protocol: device?.protocol,
        apiAddress,
        ready: isDeviceReady,
        vendorProductId: definition?.vendorProductId,
        matrix: definition
          ? [definition.matrix.rows, definition.matrix.cols]
          : undefined,
        preview: mappings?.preview.leds.map(({keyIndex, matrixIndex, x, y}) => [
          keyIndex,
          matrixIndex,
          x,
          y,
        ]),
        hardware: mappings?.hardware.leds.map(
          ({keyIndex, matrixIndex, ledIndex}) => [
            keyIndex,
            matrixIndex,
            ledIndex,
          ],
        ),
      }),
    [
      apiAddress,
      definition,
      device?.path,
      device?.productId,
      device?.protocol,
      device?.vendorId,
      isDeviceReady,
      mappings,
    ],
  );

  const staticCapabilities = useMemo(() => {
    if (!definition || !device || !mappings) {
      return undefined;
    }
    return getStaticLightingLabCapabilities(
      device.protocol,
      definition.matrix,
      {
        activeKeyCount: mappings.preview.eligibleKeyCount,
        matrixMappedKeyCount: mappings.preview.leds.length,
        ledMappedKeyCount: mappings.hardware.leds.length,
        duplicateMatrixPositions: getDuplicateKeyIndices(
          mappings.preview.diagnostics,
          'duplicate-matrix-position',
        ),
        duplicateLedIndices: getDuplicateKeyIndices(
          mappings.hardware.diagnostics,
          'duplicate-led-index',
        ),
      },
    );
  }, [definition, device, mappings]);

  const capabilities = runtimeCapabilities || staticCapabilities;
  const canRequestLive =
    !!isDeviceReady &&
    !!api &&
    !!mappings?.hardware.isComplete &&
    staticCapabilities?.matrixInput.status === 'supported' &&
    staticCapabilities.perKeyRead.status !== 'unsupported' &&
    staticCapabilities.perKeyWrite.status !== 'unsupported';
  const liveUnavailableReason = !isDeviceReady
    ? 'The selected device is not ready.'
    : staticCapabilities?.matrixInput.status === 'unsupported'
    ? staticCapabilities.matrixInput.reason
    : staticCapabilities?.activeKeyMapping.status === 'unsupported'
    ? staticCapabilities.activeKeyMapping.reason
    : staticCapabilities?.perKeyRead.status === 'unsupported'
    ? staticCapabilities.perKeyRead.reason
    : staticCapabilities?.perKeyWrite.status === 'unsupported'
    ? staticCapabilities.perKeyWrite.reason
    : 'The required temporary per-key capabilities are not available.';

  const safelySetRunState = useCallback((nextState: LabRunState) => {
    if (mountedRef.current) {
      setRunState(nextState);
    }
  }, []);

  const safelySetStatus = useCallback((nextStatus: string) => {
    if (mountedRef.current) {
      setStatus(nextStatus);
    }
  }, []);

  const stop = useCallback(
    (reason = 'Stopped.', silent = false) => {
      const hadWork =
        runningRef.current ||
        !!matrixSourceRef.current ||
        !!writerRef.current ||
        !!deviceSessionRef.current;
      stopRequestEpochRef.current += 1;
      runTokenRef.current += 1;
      runningRef.current = false;
      liveActiveRef.current = false;
      awaitingConfirmationRef.current = false;
      if (!silent) {
        stopAnnouncementRef.current = {reason};
        if (hadWork || stopGateRef.current.isRunning()) {
          safelySetRunState('stopping');
          safelySetStatus('Stopping and draining the active device command…');
        }
      }

      return stopGateRef.current.run(async () => {
        if (animationFrameRef.current !== undefined) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }
        matrixSourceRef.current?.release();
        matrixSourceRef.current = undefined;

        const writer = writerRef.current;
        writerRef.current = undefined;
        const session = deviceSessionRef.current;
        deviceSessionRef.current = undefined;
        // Closing synchronously reserves restore commands behind the active
        // VIA command and ahead of any later interaction in another pane.
        const sessionClose = session?.close();
        if (writer) {
          await writer.stop();
        }

        let restorationMessage = '';
        if (sessionClose) {
          try {
            const restoration = await sessionClose;
            restorationMessage =
              restoration.failedLedIndices.length === 0
                ? ` Restore commands completed for ${restoration.restoredLedCount} touched LED values; the physical result was not independently observed.`
                : ` Restoration incomplete for LED indexes ${restoration.failedLedIndices.join(
                    ', ',
                  )}.`;
          } catch (error) {
            restorationMessage = ` Restoration failed: ${
              error instanceof Error ? error.message : String(error)
            }.`;
          }
        }

        ripplesRef.current = [];
        previewFrameRef.current = null;
        visualBackgroundRef.current = new Map();
        lastHardwareFrameRef.current = null;
        lastHardwareHueSaturationRef.current.clear();
        lastDeviceSubmitAtRef.current = 0;
        deviceCadenceRef.current = undefined;
        const announcement = stopAnnouncementRef.current;
        stopAnnouncementRef.current = undefined;
        if (mountedRef.current) {
          setPreviewColors([]);
          setMetrics(EMPTY_METRICS);
          setDeviceCadence(undefined);
          setRejectedRipples(0);
          setRunState('idle');
          if (announcement) {
            setStatus(`${announcement.reason}${restorationMessage}`);
          }
        }
      });
    },
    [safelySetRunState, safelySetStatus],
  );
  stopRef.current = stop;

  const addRippleAt = useCallback((led: VirtualPreviewLed) => {
    if (!runningRef.current) {
      return false;
    }
    const now = getAnimationNow();
    const currentSettings = settingsRef.current;
    const ripple = createRipple(
      {
        id: `ripple-${++rippleSequenceRef.current}`,
        originLedIndex: led.ledIndex,
        originX: led.x,
        originY: led.y,
        startedAt: now,
        color: primaryColorRef.current,
      },
      currentSettings,
    );
    const result = addRipple(
      ripplesRef.current,
      ripple,
      currentSettings.maxConcurrentRipples,
      now,
    );
    ripplesRef.current = result.ripples;
    if (!result.accepted && mountedRef.current) {
      setRejectedRipples((count) => count + 1);
    }
    return result.accepted;
  }, []);

  const start = useCallback(
    async (previewOnly = false) => {
      const cleanupWasRunning = stopGateRef.current.isRunning();
      await stopGateRef.current.wait();
      if (cleanupWasRunning) {
        return;
      }
      if (!definition || !device || !api || !mappings || !staticCapabilities) {
        safelySetRunState('error');
        safelySetStatus('No ready keyboard definition is available.');
        return;
      }

      if (runningRef.current || writerRef.current || deviceSessionRef.current) {
        const expectedStopEpoch = stopRequestEpochRef.current + 1;
        await stop('Restarting.', true);
        if (stopRequestEpochRef.current !== expectedStopEpoch) {
          return;
        }
      }

      const token = ++runTokenRef.current;
      runningRef.current = true;
      liveActiveRef.current = false;
      awaitingConfirmationRef.current = false;
      ripplesRef.current = [];
      previewFrameRef.current = null;
      visualBackgroundRef.current = new Map();
      lastHardwareFrameRef.current = null;
      lastHardwareHueSaturationRef.current.clear();
      lastDeviceSubmitAtRef.current = 0;
      deviceCadenceRef.current = undefined;
      if (mountedRef.current) {
        setRuntimeCapabilities(undefined);
        setDeviceCadence(undefined);
        setMetrics(EMPTY_METRICS);
        setRejectedRipples(0);
        setRunState('starting');
        setStatus('Starting the local preview…');
      }

      const tick = (now: number) => {
        if (!runningRef.current || token !== runTokenRef.current) {
          return;
        }
        const currentSettings = settingsRef.current;
        ripplesRef.current = pruneExpiredRipples(ripplesRef.current, now);
        const frame = renderRippleFrame(
          mappings.preview.leds,
          ripplesRef.current,
          {
            ...currentSettings,
            compositionMode:
              visualBackgroundRef.current.size > 0
                ? 'background-interpolation'
                : 'screen',
          },
          now,
          visualBackgroundRef.current.size > 0
            ? visualBackgroundRef.current
            : BLACK,
        );
        if (
          previewFrameRef.current === null ||
          diffLedFrames(previewFrameRef.current, frame).length > 0
        ) {
          previewFrameRef.current = frame;
          if (mountedRef.current) {
            setPreviewColors(frameToKeyColors(frame, activeKeys.length));
          }
        }

        if (
          liveActiveRef.current &&
          writerRef.current &&
          deviceCadenceRef.current?.updateIntervalMs !== null &&
          deviceCadenceRef.current?.updateIntervalMs !== undefined &&
          now - lastDeviceSubmitAtRef.current >=
            deviceCadenceRef.current.updateIntervalMs
        ) {
          const hardwareFrame = new Map<number, RGBColor>();
          mappings.hardware.leds.forEach(({keyIndex, ledIndex}) => {
            const color = frame.get(keyIndex);
            if (color) {
              hardwareFrame.set(ledIndex, color);
            }
          });
          writerRef.current.enqueue(hardwareFrame);
          lastDeviceSubmitAtRef.current = now;
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      };
      animationFrameRef.current = requestAnimationFrame(tick);

      if (
        isDeviceReady &&
        staticCapabilities.matrixInput.status === 'supported'
      ) {
        try {
          matrixSourceRef.current = acquireMatrixStateSource(
            api,
            definition.matrix.rows,
            definition.matrix.cols,
            device.protocol,
            {
              onTransitions: (transitions) => {
                transitions.forEach((transition) => {
                  if (transition.state !== 'down') {
                    return;
                  }
                  const led = mappings.preview.byMatrixIndex.get(
                    transition.matrixIndex,
                  );
                  if (led) {
                    addRippleAt(led);
                  }
                });
              },
              onError: (error) => {
                safelySetRunState('error');
                void stopRef.current(
                  `Stopped after matrix HID error: ${error.message}`,
                );
              },
            },
          );
        } catch (error) {
          safelySetStatus(
            `Preview is running without physical input: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      const shouldProbeLive = !previewOnly && liveRequested && canRequestLive;
      if (!shouldProbeLive) {
        safelySetRunState('preview');
        safelySetStatus(
          isDeviceReady && staticCapabilities.matrixInput.status === 'supported'
            ? 'Preview running. Physical matrix down transitions create independent ripples.'
            : `Preview running with the test button only. ${
                isDeviceReady
                  ? staticCapabilities.matrixInput.reason
                  : 'The selected device is not ready.'
              }`,
        );
        return;
      }

      safelySetStatus(
        'Capturing per-key colors and running a reversible count=1 probe…',
      );
      let probeSession: PerKeyRGBDeviceSession | undefined;
      try {
        const probe = await probeTemporaryPerKeyRGB(
          api,
          mappings.hardware.leds.map(({ledIndex}) => ledIndex),
          staticCapabilities,
          (session) => {
            probeSession = session;
            if (runningRef.current && token === runTokenRef.current) {
              deviceSessionRef.current = session;
            } else {
              void session.close();
            }
          },
        );
        if (!runningRef.current || token !== runTokenRef.current) {
          await probe.session.close();
          return;
        }
        setRuntimeCapabilities(probe.capabilities);

        if (!probe.capabilities.liveSafe) {
          const restoration = await probe.session.close();
          if (!runningRef.current || token !== runTokenRef.current) {
            return;
          }
          if (deviceSessionRef.current === probe.session) {
            deviceSessionRef.current = undefined;
          }
          safelySetRunState('preview');
          safelySetStatus(
            `Preview only: ${probe.capabilities.reasons.join(' ')} ${
              restoration.failedLedIndices.length
                ? 'The probe restoration was incomplete.'
                : 'The same-value restore command completed.'
            }`,
          );
          return;
        }

        const cadence = calculateSafeDeviceUpdateCadence({
          targetFps: settingsRef.current.deviceUpdateRate,
          measuredCommandLatencyMs:
            probe.capabilities.measuredWriteLatencyMs ?? Number.NaN,
          estimatedMaxLedWritesPerFrame: mappings.hardware.leds.length,
          safetyMargin: DEVICE_CADENCE_SAFETY_MARGIN,
        });
        if (!cadence.canStream || cadence.updateIntervalMs === null) {
          const restoration = await probe.session.close();
          if (!runningRef.current || token !== runTokenRef.current) {
            return;
          }
          if (deviceSessionRef.current === probe.session) {
            deviceSessionRef.current = undefined;
          }
          safelySetRunState('preview');
          safelySetStatus(
            `Preview only: a safe measured device cadence could not be established. ${
              cadence.reason
            }${
              restoration.failedLedIndices.length
                ? ' Probe restoration was incomplete.'
                : ''
            }`,
          );
          return;
        }
        deviceCadenceRef.current = cadence;
        if (mountedRef.current) {
          setDeviceCadence(cadence);
        }

        const capturedColors = probe.session.getCapturedColors();
        const visualBackground = new Map<number, RGBColor>();
        const hardwareBackground = new Map<number, RGBColor>();
        capturedColors.forEach((hueSaturation, ledIndex) => {
          const hardwareLed = mappings.hardware.byLedIndex.get(ledIndex);
          if (!hardwareLed) {
            return;
          }
          const rgb = hueSaturationToRGB(hueSaturation);
          visualBackground.set(hardwareLed.keyIndex, rgb);
          hardwareBackground.set(ledIndex, rgb);
          lastHardwareHueSaturationRef.current.set(ledIndex, hueSaturation);
        });
        visualBackgroundRef.current = visualBackground;
        lastHardwareFrameRef.current = hardwareBackground;

        const probeLed = mappings.hardware.leds[0];
        const originalProbeColor = capturedColors.get(probeLed.ledIndex);
        if (!originalProbeColor) {
          throw new Error('The captured visual-probe color is missing.');
        }
        await probe.session.writeTemporary({
          ledIndex: probeLed.ledIndex,
          hue: (originalProbeColor[0] + 85) % 256,
          saturation: originalProbeColor[1] < 64 ? 255 : originalProbeColor[1],
        });
        if (!runningRef.current || token !== runTokenRef.current) {
          await probe.session.close();
          return;
        }
        awaitingConfirmationRef.current = true;
        safelySetRunState('awaiting-confirmation');
        safelySetStatus(
          `Visual safety check: did LED ${probeLed.ledIndex} change color without a save command?`,
        );
      } catch (error) {
        const session = probeSession;
        if (deviceSessionRef.current === session) {
          deviceSessionRef.current = undefined;
        }
        if (session) {
          await session.close();
        }
        if (!runningRef.current || token !== runTokenRef.current) {
          return;
        }
        safelySetRunState('preview');
        safelySetStatus(
          `Preview remains active; live output probe failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [
      activeKeys.length,
      addRippleAt,
      api,
      canRequestLive,
      definition,
      device,
      isDeviceReady,
      liveRequested,
      mappings,
      safelySetRunState,
      safelySetStatus,
      staticCapabilities,
      stop,
    ],
  );

  const confirmVisualProbe = useCallback(async () => {
    const session = deviceSessionRef.current;
    if (!session || !awaitingConfirmationRef.current || !mappings) {
      return;
    }
    const token = runTokenRef.current;
    awaitingConfirmationRef.current = false;
    safelySetStatus('Restoring the probe color before live streaming…');
    const probeRestoration = await session.restore();
    if (
      !runningRef.current ||
      token !== runTokenRef.current ||
      deviceSessionRef.current !== session
    ) {
      return;
    }
    if (probeRestoration.failedLedIndices.length > 0) {
      const finalRestoration = await session.close();
      if (
        !runningRef.current ||
        token !== runTokenRef.current ||
        deviceSessionRef.current !== session
      ) {
        return;
      }
      deviceSessionRef.current = undefined;
      safelySetRunState('preview');
      safelySetStatus(
        finalRestoration.failedLedIndices.length > 0
          ? `Preview only: the probe could not restore LED indexes ${finalRestoration.failedLedIndices.join(
              ', ',
            )}.`
          : 'Preview only: restoration required a retry, so live output remains disabled. The retry commands completed.',
      );
      return;
    }

    const metricsStartedAt = getAnimationNow();
    if (mountedRef.current) {
      setMetrics({...EMPTY_METRICS, startedAt: metricsStartedAt});
    }
    const capturedColors = session.getCapturedColors();
    writerRef.current = createLatestFrameWriter<LedFrame>(
      async (frame, {isLatest}) => {
        const writeResult = await writeChangedLedFrame(
          lastHardwareFrameRef.current,
          frame,
          FRAME_DIFF_THRESHOLD,
          async ({ledIndex, color}) => {
            const capturedColor = capturedColors.get(ledIndex);
            const capturedRGB = capturedColor
              ? hueSaturationToRGB(capturedColor)
              : undefined;
            const hueSaturation =
              capturedColor &&
              capturedRGB?.r === color.r &&
              capturedRGB.g === color.g &&
              capturedRGB.b === color.b
                ? capturedColor
                : rgbToHueSaturation(color);
            const previous = lastHardwareHueSaturationRef.current.get(ledIndex);
            if (
              previous &&
              previous[0] === hueSaturation[0] &&
              previous[1] === hueSaturation[1]
            ) {
              return null;
            }
            const latency = await session.writeTemporary({
              ledIndex,
              hue: hueSaturation[0],
              saturation: hueSaturation[1],
            });
            lastHardwareHueSaturationRef.current.set(ledIndex, hueSaturation);
            return latency;
          },
          () =>
            isLatest() &&
            runningRef.current &&
            liveActiveRef.current &&
            token === runTokenRef.current &&
            deviceSessionRef.current === session,
        );
        lastHardwareFrameRef.current = writeResult.appliedFrame;
        if (
          writeResult.ledWrites > 0 &&
          mountedRef.current &&
          runningRef.current &&
          token === runTokenRef.current
        ) {
          setMetrics((current) => ({
            startedAt: current.startedAt || metricsStartedAt,
            writeFrames: current.writeFrames + 1,
            ledWrites: current.ledWrites + writeResult.ledWrites,
            totalCommandLatencyMs:
              current.totalCommandLatencyMs + writeResult.totalCommandLatencyMs,
          }));
        }
        return !writeResult.aborted;
      },
      {
        onError: (error) => {
          void stopRef.current(
            `Stopped after live HID error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      },
    );
    liveActiveRef.current = true;
    lastDeviceSubmitAtRef.current = 0;
    safelySetRunState('live');
    safelySetStatus(
      `Live output running at up to ${
        deviceCadenceRef.current?.safeFps.toFixed(1) ?? 'an unknown'
      } FPS. No persistence command is used; keep this page open.`,
    );
  }, [mappings, safelySetRunState, safelySetStatus]);

  const rejectVisualProbe = useCallback(async () => {
    const token = runTokenRef.current;
    awaitingConfirmationRef.current = false;
    liveActiveRef.current = false;
    const session = deviceSessionRef.current;
    deviceSessionRef.current = undefined;
    const restoration = session ? await session.close() : undefined;
    if (!runningRef.current || token !== runTokenRef.current) {
      return;
    }
    safelySetRunState('preview');
    safelySetStatus(
      restoration?.failedLedIndices.length
        ? 'Preview only. The visual probe was rejected and restoration was incomplete.'
        : 'Preview only. The temporary color was not visibly confirmed; its restore command completed.',
    );
  }, [safelySetRunState, safelySetStatus]);

  const triggerTestRipple = useCallback(async () => {
    if (!mappings) {
      return;
    }
    if (!runningRef.current) {
      await start(true);
    }
    const centralLed = getCentralLed(mappings.preview.leds);
    if (centralLed) {
      addRippleAt(centralLed);
    } else {
      safelySetStatus('No unambiguous key is available for a test ripple.');
    }
  }, [addRippleAt, mappings, safelySetStatus, start]);

  const restoreDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setPickerColor({hue: 170, sat: 255});
    setLiveRequested(false);
    safelySetStatus('Default Lighting Lab values restored.');
  }, [safelySetStatus]);

  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) {
      return undefined;
    }
    const updateDimensions = () => {
      if (mountedRef.current) {
        setPreviewDimensions(element.getBoundingClientRect());
      }
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previousIdentity = selectedLightingIdentityRef.current;
    if (
      previousIdentity !== undefined &&
      previousIdentity !== lightingIdentity
    ) {
      setRuntimeCapabilities(undefined);
      setLiveRequested(false);
      if (runningRef.current) {
        void stopRef.current(
          isDeviceReady
            ? 'Stopped because the selected keyboard context changed.'
            : 'Stopped because the selected device is no longer ready.',
        );
      }
    }
    selectedLightingIdentityRef.current = lightingIdentity;
  }, [isDeviceReady, lightingIdentity]);

  useEffect(() => {
    const measuredCommandLatencyMs =
      runtimeCapabilities?.measuredWriteLatencyMs;
    const estimatedMaxLedWritesPerFrame = mappings?.hardware.leds.length ?? 0;
    if (
      !runtimeCapabilities?.liveSafe ||
      measuredCommandLatencyMs === undefined ||
      estimatedMaxLedWritesPerFrame === 0
    ) {
      deviceCadenceRef.current = undefined;
      setDeviceCadence(undefined);
      return;
    }

    const nextCadence = calculateSafeDeviceUpdateCadence({
      targetFps: settings.deviceUpdateRate,
      measuredCommandLatencyMs,
      estimatedMaxLedWritesPerFrame,
      safetyMargin: DEVICE_CADENCE_SAFETY_MARGIN,
    });
    deviceCadenceRef.current = nextCadence;
    setDeviceCadence(nextCadence);
    if (
      liveActiveRef.current &&
      (!nextCadence.canStream || nextCadence.updateIntervalMs === null)
    ) {
      void stopRef.current(
        `Stopped because a safe device cadence is no longer available. ${nextCadence.reason}`,
      );
    }
  }, [
    mappings?.hardware.leds.length,
    runtimeCapabilities,
    settings.deviceUpdateRate,
  ]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        void stopRef.current('Stopped because the page was hidden.');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopRef.current('Stopped because Lighting Lab was closed.');
    };
  }, []);

  if (!definition || !device || !mappings || !staticCapabilities) {
    return (
      <LabContainer>
        <StatusPanel>{t('No ready keyboard is selected.')}</StatusPanel>
      </LabContainer>
    );
  }

  const connectionDescription = `${device.productName} · VID:PID ${formatHexId(
    device.vendorId,
  )}:${formatHexId(device.productId)} · VIA ${device.protocol} · ${
    definition.matrix.rows
  }×${definition.matrix.cols}`;
  const matrixCapability = describeCapability(capabilities!.matrixInput);
  const ledMappingCapability = describeCapability(
    capabilities!.activeKeyMapping,
  );
  const readCapability = describeCapability(capabilities!.perKeyRead);
  const writeCapability = describeCapability(capabilities!.perKeyWrite);
  const batchCapability = describeCapability(capabilities!.perKeyBatchWrite);
  const writerState = writerRef.current?.getState();
  const elapsedDeviceSeconds =
    metrics.startedAt > 0
      ? Math.max(0.001, (getAnimationNow() - metrics.startedAt) / 1000)
      : 0;
  const measuredWriteFrameRate =
    elapsedDeviceSeconds > 0 ? metrics.writeFrames / elapsedDeviceSeconds : 0;
  const measuredCommandRate =
    elapsedDeviceSeconds > 0 ? metrics.ledWrites / elapsedDeviceSeconds : 0;
  const averageLedWrites =
    metrics.writeFrames > 0 ? metrics.ledWrites / metrics.writeFrames : 0;
  const averageCommandLatency =
    metrics.ledWrites > 0
      ? metrics.totalCommandLatencyMs / metrics.ledWrites
      : undefined;

  return (
    <LabContainer>
      <Heading>
        <ExperimentalBadge>{t('Experimental')}</ExperimentalBadge>
        <h2>{t('Concurrent Reactive Ripple')}</h2>
        <p>
          {t(
            'Each physical key-down owns an independent timeline. Later presses overlap without restarting earlier waves.',
          )}
        </p>
      </Heading>

      <ControlRow>
        <Label>{t('Effect')}</Label>
        <Detail>
          <AccentSelect
            isDisabled
            options={[EFFECT_OPTION]}
            value={EFFECT_OPTION}
          />
        </Detail>
      </ControlRow>
      <ControlRow>
        <Label>{t('Primary color')}</Label>
        <Detail>
          <ColorPicker
            color={pickerColor}
            setColor={(hue, sat) => setPickerColor({hue, sat})}
          />
        </Detail>
      </ControlRow>
      <ControlRow>
        <Label>{t('Duration')}</Label>
        <Detail>
          <AccentRange
            min={200}
            max={3000}
            step={50}
            value={settings.durationMs}
            onChange={(durationMs) =>
              setSettings((current) => ({...current, durationMs}))
            }
          />
          <InlineValue>{settings.durationMs} ms</InlineValue>
        </Detail>
      </ControlRow>
      <ControlRow>
        <Label>{t('Wave width')}</Label>
        <Detail>
          <AccentRange
            min={5}
            max={40}
            step={1}
            value={Math.round(settings.waveWidth * 10)}
            onChange={(value) =>
              setSettings((current) => ({
                ...current,
                waveWidth: value / 10,
              }))
            }
          />
          <InlineValue>{settings.waveWidth.toFixed(1)} keys</InlineValue>
        </Detail>
      </ControlRow>
      <ControlRow>
        <Label>{t('Intensity')}</Label>
        <Detail>
          <AccentRange
            min={0}
            max={100}
            step={1}
            value={Math.round(settings.intensity * 100)}
            onChange={(value) =>
              setSettings((current) => ({
                ...current,
                intensity: value / 100,
              }))
            }
          />
          <InlineValue>{Math.round(settings.intensity * 100)}%</InlineValue>
        </Detail>
      </ControlRow>
      <ControlRow>
        <Label>{t('Live output on next Start')}</Label>
        <Detail>
          <DisabledControl $disabled={!canRequestLive || runState !== 'idle'}>
            <AccentSlider
              isChecked={liveRequested}
              onChange={setLiveRequested}
              disabled={!canRequestLive || runState !== 'idle'}
              ariaLabel={t('Request live device output on next Start')}
            />
          </DisabledControl>
        </Detail>
      </ControlRow>
      <HelpText>
        {canRequestLive
          ? t(
              'Live output requires USB, an open page, a reversible probe, and visual confirmation. It does not install a firmware effect.',
            )
          : t(`Live output is unavailable: ${liveUnavailableReason}`)}
      </HelpText>

      <Advanced>
        <summary>{t('Advanced')}</summary>
        <ControlRow>
          <Label>{t('Maximum concurrent ripples')}</Label>
          <Detail>
            <AccentRange
              min={1}
              max={64}
              step={1}
              value={settings.maxConcurrentRipples}
              onChange={(maxConcurrentRipples) =>
                setSettings((current) => ({
                  ...current,
                  maxConcurrentRipples,
                }))
              }
            />
            <InlineValue>{settings.maxConcurrentRipples}</InlineValue>
          </Detail>
        </ControlRow>
        <ControlRow>
          <Label>{t('Target device update rate')}</Label>
          <Detail>
            <AccentRange
              min={10}
              max={20}
              step={1}
              value={settings.deviceUpdateRate}
              onChange={(deviceUpdateRate) =>
                setSettings((current) => ({
                  ...current,
                  deviceUpdateRate,
                }))
              }
            />
            <InlineValue>{settings.deviceUpdateRate} FPS</InlineValue>
          </Detail>
        </ControlRow>
      </Advanced>

      <StatusPanel>
        <StatusTitle>{t('Connection and capabilities')}</StatusTitle>
        <CapabilityList>
          <CapabilityName>{t('Connection')}</CapabilityName>
          <CapabilityValue
            $status={isDeviceReady ? 'supported' : 'unsupported'}
          >
            {isDeviceReady ? 'ready' : 'not ready'}: {connectionDescription}
          </CapabilityValue>
          <CapabilityName>{t('Matrix input')}</CapabilityName>
          <CapabilityValue $status={matrixCapability.status}>
            {matrixCapability.text}
          </CapabilityValue>
          <CapabilityName>{t('Preview mapping')}</CapabilityName>
          <CapabilityValue
            $status={mappings.preview.isComplete ? 'supported' : 'unsupported'}
          >
            {mappings.preview.leds.length}/{mappings.preview.eligibleKeyCount}{' '}
            active keys
          </CapabilityValue>
          <CapabilityName>{t('Per-key LED mapping')}</CapabilityName>
          <CapabilityValue $status={ledMappingCapability.status}>
            {ledMappingCapability.text}
          </CapabilityValue>
          <CapabilityName>{t('Per-key read')}</CapabilityName>
          <CapabilityValue $status={readCapability.status}>
            {readCapability.text}
          </CapabilityValue>
          <CapabilityName>{t('Per-key write')}</CapabilityName>
          <CapabilityValue $status={writeCapability.status}>
            {writeCapability.text}
          </CapabilityValue>
          <CapabilityName>{t('Batch write')}</CapabilityName>
          <CapabilityValue $status={batchCapability.status}>
            {batchCapability.text}
          </CapabilityValue>
          <CapabilityName>{t('Color channels')}</CapabilityName>
          <CapabilityValue $status="unknown">
            hue + saturation; per-LED value unsupported
          </CapabilityValue>
          <CapabilityName>{t('Persistence')}</CapabilityName>
          <CapabilityValue $status="supported">
            not used: no save/commit command in Lighting Lab
          </CapabilityValue>
        </CapabilityList>
      </StatusPanel>

      <StatusPanel>
        <div role="status" aria-live="polite">
          <StatusTitle>
            {t('State')}: {runState}
          </StatusTitle>
          <div>{status}</div>
        </div>
        <div>
          Active ripples: {ripplesRef.current.length} · rejected by safety cap:{' '}
          {rejectedRipples}
        </div>
        {runtimeCapabilities ? (
          <div>
            Probe latency:{' '}
            {runtimeCapabilities.measuredWriteLatencyMs?.toFixed(1) ??
              'not measured'}{' '}
            ms
          </div>
        ) : null}
        {deviceCadence ? (
          <div>
            Safe device ceiling: {deviceCadence.safeFps.toFixed(1)} FPS from a{' '}
            {deviceCadence.targetFps.toFixed(1)} FPS target · conservative
            writes/frame: {deviceCadence.estimatedMaxLedWritesPerFrame ?? 0} ·
            margin: {deviceCadence.safetyMargin?.toFixed(1) ?? 'not measured'}×
          </div>
        ) : null}
        {metrics.startedAt > 0 ? (
          <div>
            Observed write-bearing frames: {measuredWriteFrameRate.toFixed(1)}{' '}
            FPS · device commands: {measuredCommandRate.toFixed(1)}/s · average
            LED writes/write-frame: {averageLedWrites.toFixed(1)} · average
            stream command:{' '}
            {averageCommandLatency?.toFixed(1) ?? 'not measured'} ms · queue:{' '}
            {(writerState?.inFlight ? 1 : 0) +
              (writerState?.hasPending ? 1 : 0)}
            /2 · stale frames dropped: {writerState?.dropped ?? 0}
          </div>
        ) : null}
      </StatusPanel>

      <PreviewFrame ref={previewContainerRef}>
        {previewDimensions ? (
          <KeyboardCanvas
            matrixKeycodes={matrixKeycodes}
            keys={activeKeys}
            selectable={false}
            definition={definition}
            containerDimensions={previewDimensions}
            mode={DisplayMode.ConfigureColors}
            keyColorOverrides={previewColors}
          />
        ) : null}
      </PreviewFrame>

      <ButtonRow>
        <AccentButton
          disabled={runState !== 'idle'}
          onClick={() => void start(false)}
        >
          {t('Start')}
        </AccentButton>
        <AccentButton
          disabled={runState === 'idle' || runState === 'stopping'}
          onClick={() => void stop('Stopped by user.')}
        >
          {t('Stop')}
        </AccentButton>
        <AccentButton
          disabled={runState === 'stopping'}
          onClick={() => void triggerTestRipple()}
        >
          {t('Trigger test ripple')}
        </AccentButton>
        <AccentButton disabled={runState !== 'idle'} onClick={restoreDefaults}>
          {t('Restore defaults')}
        </AccentButton>
      </ButtonRow>

      {runState === 'awaiting-confirmation' ? (
        <ButtonRow>
          <AccentButton onClick={() => void confirmVisualProbe()}>
            {t('Yes, the temporary LED changed')}
          </AccentButton>
          <AccentButton onClick={() => void rejectVisualProbe()}>
            {t('No visible change')}
          </AccentButton>
        </ButtonRow>
      ) : null}
    </LabContainer>
  );
};
