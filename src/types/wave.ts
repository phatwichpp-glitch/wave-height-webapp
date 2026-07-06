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
