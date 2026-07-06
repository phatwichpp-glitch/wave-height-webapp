import type { CalibrationData } from "@/types/wave";

const CALIBRATION_STORAGE_KEY = "wave-analyzer-calibration";

export function calculatePixelsPerCm(
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  knownDistanceCm: number
): number {
  if (knownDistanceCm <= 0) {
    throw new Error("knownDistanceCm must be greater than 0");
  }

  const pixelDistance = Math.hypot(point2.x - point1.x, point2.y - point1.y);

  if (pixelDistance === 0) {
    throw new Error("point1 and point2 must not be the same point");
  }

  return pixelDistance / knownDistanceCm;
}

export function saveCalibrationToLocalStorage(data: CalibrationData): void {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable (e.g. private browsing in some browsers).
    // Calibration reuse is a convenience, not a hard requirement, so fail silently.
  }
}

export function loadCalibrationFromLocalStorage(): CalibrationData | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as CalibrationData;
  } catch {
    return null;
  }
}
