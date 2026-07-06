import { computeGradient, gaussianSmooth1D } from "@/lib/surfaceDetector";
import type { RulerCalibration } from "@/types/wave";

/**
 * Averages grayscale brightness across the width of `roi`, producing a
 * profile indexed by row (0 = roi.y) along the ruler's long axis — the same
 * idea as extractColumnProfile from Phase 2, just restricted to a sub-region
 * instead of the whole frame.
 */
export function extractRulerProfile(
  imageData: ImageData,
  roi: { x: number; y: number; width: number; height: number }
): Float32Array {
  const { data, width: imageWidth, height: imageHeight } = imageData;
  const profile = new Float32Array(roi.height);

  const xStart = Math.max(0, roi.x);
  const xEnd = Math.min(imageWidth, roi.x + roi.width);

  for (let row = 0; row < roi.height; row++) {
    const y = roi.y + row;
    if (y < 0 || y >= imageHeight) {
      continue;
    }

    let sum = 0;
    let count = 0;
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * imageWidth + x) * 4;
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count += 1;
    }
    profile[row] = count > 0 ? sum / count : 0;
  }

  return profile;
}

export interface TickPeak {
  pixelPos: number;
  strength: number;
}

/**
 * Finds local maxima of |gradient| above a mean+1*std threshold — one per
 * tick mark on the ruler. Non-maximum suppression (minSeparationPx) collapses
 * runs of adjacent above-threshold samples belonging to the same tick edge
 * into a single peak.
 */
export function detectTickPeaks(profile: Float32Array, smoothSigma: number = 1.5): TickPeak[] {
  if (profile.length < 3) {
    return [];
  }

  const smoothed = gaussianSmooth1D(profile, smoothSigma);
  const gradient = computeGradient(smoothed);
  const absGradient = gradient.map((v) => Math.abs(v));

  const mean = absGradient.reduce((s, v) => s + v, 0) / absGradient.length;
  const variance =
    absGradient.reduce((s, v) => s + (v - mean) ** 2, 0) / absGradient.length;
  const std = Math.sqrt(variance);
  const threshold = mean + std;

  // A single tick line produces two gradient peaks (its rising and falling
  // edge), roughly 2*smoothSigma apart after smoothing — wide enough
  // clustering is needed to merge those into one peak per tick, while
  // staying well under the actual tick-to-tick spacing.
  const minSeparationPx = Math.max(4, Math.ceil(smoothSigma * 3));

  const candidates: TickPeak[] = [];
  for (let i = 1; i < absGradient.length - 1; i++) {
    const v = absGradient[i];
    if (v > threshold && v >= absGradient[i - 1] && v >= absGradient[i + 1]) {
      candidates.push({ pixelPos: i, strength: v });
    }
  }

  // Cluster candidates within minSeparationPx of each other (e.g. a tick
  // line's two edges) and report each cluster's strength-weighted average
  // position as one peak — averaging rather than just picking the stronger
  // candidate avoids a systematic bias toward whichever edge is encountered
  // first when both edges have equal (or near-equal) strength.
  const peaks: TickPeak[] = [];
  let clusterPositions: number[] = [];
  let clusterStrengths: number[] = [];

  function flushCluster() {
    if (clusterPositions.length === 0) {
      return;
    }
    const totalStrength = clusterStrengths.reduce((s, w) => s + w, 0);
    const weightedPos =
      clusterPositions.reduce((s, p, k) => s + p * clusterStrengths[k], 0) / totalStrength;
    peaks.push({ pixelPos: weightedPos, strength: Math.max(...clusterStrengths) });
    clusterPositions = [];
    clusterStrengths = [];
  }

  for (const candidate of candidates) {
    const lastPos = clusterPositions[clusterPositions.length - 1];
    if (lastPos !== undefined && candidate.pixelPos - lastPos >= minSeparationPx) {
      flushCluster();
    }
    clusterPositions.push(candidate.pixelPos);
    clusterStrengths.push(candidate.strength);
  }
  flushCluster();

  return peaks;
}

export interface RulerFit {
  pixelsPerCm: number;
  anchorPixelPos: number;
  anchorValueCm: number;
  fitError: number;
}

/**
 * Fits detected tick peaks to a uniform grid via least-squares regression,
 * using the prior fit to guess each peak's tick index (how many ticks it is
 * from the anchor). Re-fitting against the *previous* fit (not the original
 * calibration) each time lets this track a continuously drifting/zooming
 * camera instead of only ever comparing back to frame 0.
 */
export function fitUniformGrid(
  peaks: TickPeak[],
  priorPixelsPerCm: number,
  priorAnchorPixelPos: number,
  priorAnchorValueCm: number,
  cmPerTick: number
): RulerFit {
  const fallback: RulerFit = {
    pixelsPerCm: priorPixelsPerCm,
    anchorPixelPos: priorAnchorPixelPos,
    anchorValueCm: priorAnchorValueCm,
    fitError: Infinity,
  };

  const expectedSpacingPx = cmPerTick * priorPixelsPerCm;
  if (peaks.length === 0 || expectedSpacingPx === 0 || !Number.isFinite(expectedSpacingPx)) {
    return fallback;
  }

  const indices = peaks.map((peak) =>
    Math.round((peak.pixelPos - priorAnchorPixelPos) / expectedSpacingPx)
  );

  const n = peaks.length;
  const sumIndex = indices.reduce((s, i) => s + i, 0);
  const sumPixel = peaks.reduce((s, p) => s + p.pixelPos, 0);
  const sumIndexPixel = indices.reduce((s, i, k) => s + i * peaks[k].pixelPos, 0);
  const sumIndexSq = indices.reduce((s, i) => s + i * i, 0);

  const denominator = n * sumIndexSq - sumIndex * sumIndex;

  let slope: number;
  let intercept: number;

  if (denominator === 0) {
    // Every peak matched the same tick index (e.g. only one peak found) — a
    // slope can't be fit from a single point, so keep the prior scale and
    // just re-anchor to this peak's own position.
    slope = expectedSpacingPx;
    intercept = sumPixel / n - indices[0] * slope;
  } else {
    slope = (n * sumIndexPixel - sumIndex * sumPixel) / denominator;
    intercept = (sumPixel - slope * sumIndex) / n;
  }

  const pixelsPerCm = slope / cmPerTick;
  const anchorPixelPos = intercept;
  // Tick index 0 is defined relative to the prior anchor, so it always maps
  // to the same real-world value — only its pixel position (and the scale)
  // change between fits.
  const anchorValueCm = priorAnchorValueCm;

  const residuals = indices.map((i, k) => peaks[k].pixelPos - (slope * i + intercept));
  const fitError = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);

  return { pixelsPerCm, anchorPixelPos, anchorValueCm, fitError };
}

export class RulerCalibrationTracker {
  private frameCounter = 0;
  private currentFit: RulerFit;
  private currentRulerCenterX: number;
  /** True when the most recent update() rejected its fit (error above maxFitError) and kept the previous calibration. */
  lastUpdateSkipped = false;
  /** The rejected fit's error (px) from the most recent skipped update(), for surfacing in a UI warning. */
  lastSkippedFitError = 0;

  constructor(
    private initialCalibration: RulerCalibration,
    private cmPerTick: number,
    private checkIntervalFrames: number = 10,
    private maxFitError: number = 2.0
  ) {
    const { point1, point2, roi } = initialCalibration;
    const dPixel = point2.y - point1.y;
    const dValue = point2.valueCm - point1.valueCm;

    this.currentFit = {
      pixelsPerCm: dPixel / dValue,
      anchorPixelPos: point1.y,
      anchorValueCm: point1.valueCm,
      fitError: 0,
    };
    this.currentRulerCenterX = roi.x + roi.width / 2;
  }

  shouldCheck(): boolean {
    this.frameCounter += 1;
    return this.frameCounter % this.checkIntervalFrames === 0;
  }

  update(imageData: ImageData): RulerFit {
    const roi = this.initialCalibration.roi;
    const profile = extractRulerProfile(imageData, roi);
    const peaks = detectTickPeaks(profile);

    // Peaks are relative to the roi's own row 0 = roi.y; convert to
    // absolute-frame pixel positions to match anchorPixelPos's coordinate space.
    const absolutePeaks = peaks.map((p) => ({ ...p, pixelPos: p.pixelPos + roi.y }));

    const fit = fitUniformGrid(
      absolutePeaks,
      this.currentFit.pixelsPerCm,
      this.currentFit.anchorPixelPos,
      this.currentFit.anchorValueCm,
      this.cmPerTick
    );

    if (fit.fitError <= this.maxFitError) {
      this.currentFit = fit;
      this.lastUpdateSkipped = false;
    } else {
      this.lastUpdateSkipped = true;
      this.lastSkippedFitError = fit.fitError;
      if (typeof console !== "undefined") {
        console.warn(
          `Ruler re-calibration skipped: fit error ${fit.fitError.toFixed(2)}px exceeds ` +
            `max ${this.maxFitError}px — keeping the previous calibration.`
        );
      }
    }

    return this.currentFit;
  }

  /**
   * Converts a real-world ruler value (cm) to its current pixel Y position.
   * Assumes the ruler's printed values increase in the same pixel direction
   * as pixelsPerCm's sign (derived from the two calibration clicks) — if the
   * ruler is mounted upside down relative to the frame, pixelsPerCm comes out
   * negative and this formula still holds.
   */
  valueCmToPixelY(valueCm: number): number {
    return (
      this.currentFit.anchorPixelPos +
      (valueCm - this.currentFit.anchorValueCm) * this.currentFit.pixelsPerCm
    );
  }

  /**
   * Converts a horizontal offset (cm) from the ruler's center column to a
   * pixel X position. Uses the magnitude of pixelsPerCm: its sign encodes the
   * ruler's *vertical* value direction (see valueCmToPixelY) and has no
   * bearing on horizontal placement — using the signed value would mirror
   * points left/right whenever the ruler is mounted with values increasing
   * upward, contradicting MeasurementPoint.xOffsetCm's "positive = right".
   */
  pixelXForOffset(offsetCm: number): number {
    return this.currentRulerCenterX + offsetCm * Math.abs(this.currentFit.pixelsPerCm);
  }

  getCurrentFit(): RulerFit {
    return this.currentFit;
  }
}
