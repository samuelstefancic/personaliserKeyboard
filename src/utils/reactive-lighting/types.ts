export type RGBColor = Readonly<{
  r: number;
  g: number;
  b: number;
}>;

export type ReactiveLed = Readonly<{
  keyIndex: number;
  matrixIndex: number;
  row: number;
  col: number;
  ledIndex: number;
  x: number;
  y: number;
}>;

export type RippleInstance = Readonly<{
  id: string;
  originLedIndex: number;
  originX: number;
  originY: number;
  startedAt: number;
  durationMs: number;
  color: RGBColor;
}>;

export type RippleSettings = Readonly<{
  durationMs: number;
  waveWidth: number;
  intensity: number;
  maxConcurrentRipples: number;
}>;

export type RippleCompositionMode = 'screen' | 'background-interpolation';

export type RippleRenderSettings = Readonly<
  Pick<RippleSettings, 'waveWidth' | 'intensity'> & {
    compositionMode?: RippleCompositionMode;
  }
>;

export type RippleTiming = Readonly<{
  elapsedMs: number;
  progress: number;
  hasStarted: boolean;
  finished: boolean;
}>;

export type LedFrame = ReadonlyMap<number, RGBColor>;
