export interface CalibrationData {
  point1: { x: number; y: number };
  point2: { x: number; y: number };
  knownDistanceCm: number;
  pixelsPerCm: number;
}

export interface WaveDataPoint {
  timeS: number;
  elevationCm: number;
  confidence: number;
}

export interface WaveEvent {
  tStart: number;
  tEnd: number;
  periodS: number;
  heightCm: number;
}

export interface WaveStatistics {
  nWaves: number;
  hMax: number;
  hMean: number;
  hRms: number;
  hSignificant: number;
  periodMeanS: number;
  periodSignificantS: number;
  waves: WaveEvent[];
}

export interface MeasurementPoint {
  id: string;
  xColumn: number;
  label: string;
  color: string;
  baselineY: number | null;
  /** Real-world value (cm) on the ruler that corresponds to still water level. Only used when ruler-based re-calibration (Phase 9) is active. */
  baselineValueCm: number | null;
  /** Horizontal distance (cm) from the ruler's center column, positive = right. Only used when ruler-based re-calibration (Phase 9) is active. */
  xOffsetCm: number;
  /** Pixel y-position the user clicked when adding this point, on the calibration reference frame (Phase 15). Seeds the first frame's *bounded* search (Phase 16) so tracking can't lock onto an unrelated high-contrast object (a ruler tick, a phone edge, a window frame) elsewhere in the image — it is never itself the measured surface position, which always comes from per-frame tracking as before. */
  initialGuessPixelY: number;
  /** Overrides the default ±60px margin around initialGuessPixelY searched on the first frame. Null = use the default. Widen this if the true water surface can be further from the click than that (e.g. very large waves). */
  initialSearchMarginPx: number | null;
}

export interface MultiPointWaveData {
  pointId: string;
  data: WaveDataPoint[];
}

export interface RulerCalibration {
  point1: { x: number; y: number; valueCm: number };
  point2: { x: number; y: number; valueCm: number };
  roi: { x: number; y: number; width: number; height: number };
}

export interface BatchVideoConfig {
  /** Matched against the selected File's name via exact string match. */
  fileNamePattern: string;
  label?: string;
  overridePoints?: MeasurementPoint[];
  overrideCalibration?: CalibrationData;
}

export interface BatchConfig {
  defaultCalibration: CalibrationData;
  defaultPoints: MeasurementPoint[];
  videos: BatchVideoConfig[];
  sampleRateHz: number;
}

export interface BatchResult {
  fileName: string;
  status: "pending" | "processing" | "done" | "error";
  errorMessage?: string;
  statistics?: Record<string, WaveStatistics>;
  rawData?: Record<string, WaveDataPoint[]>;
  /** The measurement points actually used for this video (override or default) — needed to resolve point labels when exporting. */
  points?: MeasurementPoint[];
}
