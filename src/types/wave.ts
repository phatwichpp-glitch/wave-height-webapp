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
