// Pure functions for locating the water surface (y-pixel) along a fixed image
// column. No DOM/canvas access here, so this can run identically on the main
// thread or inside a Web Worker.

export function extractColumnProfile(
  imageData: ImageData,
  x: number,
  columnWidth: number = 3
): Float32Array {
  const { data, width, height } = imageData;
  const halfWidth = Math.floor(columnWidth / 2);
  // A fractional x (e.g. from ruler-tracking's cm→pixel conversion) would make
  // every typed-array index below non-integer, reading `undefined` and turning
  // the whole profile into NaN — so snap to the nearest whole column first.
  const xCenter = Math.round(x);
  const xMin = Math.max(0, xCenter - halfWidth);
  const xMax = Math.min(width - 1, xCenter + halfWidth);

  const profile = new Float32Array(height);
  // Column entirely outside the image: return an all-zero (flat) profile so
  // downstream edge detection degrades to confidence 0 instead of NaN.
  if (xMin > xMax) {
    return profile;
  }

  for (let y = 0; y < height; y++) {
    let sum = 0;
    let count = 0;
    for (let col = xMin; col <= xMax; col++) {
      const idx = (y * width + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      count += 1;
    }
    profile[y] = sum / count;
  }

  return profile;
}

export function gaussianSmooth1D(
  signal: Float32Array,
  sigma: number = 2.0
): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * radius + 1);
  let kernelSum = 0;

  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = weight;
    kernelSum += weight;
  }
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= kernelSum;
  }

  const n = signal.length;
  const output = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      // Edge-padding: clamp the sample index so the kernel can still be
      // applied fully at the start/end of the signal.
      const sampleIndex = Math.min(n - 1, Math.max(0, i + k));
      sum += signal[sampleIndex] * kernel[k + radius];
    }
    output[i] = sum;
  }

  return output;
}

export function computeGradient(signal: Float32Array): Float32Array {
  const n = signal.length;
  const gradient = new Float32Array(n);

  if (n === 0) {
    return gradient;
  }
  if (n === 1) {
    gradient[0] = 0;
    return gradient;
  }

  gradient[0] = signal[1] - signal[0];
  gradient[n - 1] = signal[n - 1] - signal[n - 2];

  for (let i = 1; i < n - 1; i++) {
    gradient[i] = (signal[i + 1] - signal[i - 1]) / 2;
  }

  return gradient;
}

export interface EdgeResult {
  yPosition: number;
  confidence: number;
  /** True when `confidence` fell below the threshold — the detected edge may not be reliable (e.g. a flat/noisy column with no clear step). Detection still returns its best guess rather than throwing; callers decide what to do (e.g. flag it in a live overlay). */
  lowConfidence: boolean;
}

// Not a rigorously derived cutoff — just a practical trigger for flagging a
// frame as worth a second look. A clean, unambiguous step edge typically
// scores well above this (existing tests use synthetic clean edges and
// assert confidence > 1.0); this sits a bit above that baseline.
export const DEFAULT_CONFIDENCE_THRESHOLD = 1.5;

/** Default ±margin (px) searched around a point's initialGuessPixelY on the first frame, when the point itself doesn't override it. Shared with videoProcessor.ts/frameCallbackProcessor.ts so their inline first-frame search range matches SurfaceTracker's own default exactly. */
export const DEFAULT_INITIAL_SEARCH_MARGIN_PX = 60;

export function findSurfaceEdge(
  profile: Float32Array,
  searchRange: [number, number] | null = null,
  smoothSigma: number = 2.0,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): EdgeResult {
  const smoothed = gaussianSmooth1D(profile, smoothSigma);
  const gradient = computeGradient(smoothed);

  let yMin: number;
  let yMax: number;

  if (searchRange !== null) {
    yMin = Math.max(0, searchRange[0]);
    yMax = Math.min(profile.length - 1, searchRange[1]);
  } else {
    yMin = 0;
    yMax = profile.length - 1;
  }

  if (yMin > yMax) {
    throw new Error(`Invalid search range after clamping: (${yMin}, ${yMax})`);
  }

  let maxAbsGradient = -Infinity;
  let yPosition = yMin;
  let sum = 0;
  let count = 0;

  for (let i = yMin; i <= yMax; i++) {
    const absValue = Math.abs(gradient[i]);
    sum += absValue;
    count += 1;
    if (absValue > maxAbsGradient) {
      maxAbsGradient = absValue;
      yPosition = i;
    }
  }

  const meanAbsGradient = sum / count;
  const confidence = meanAbsGradient > 0 ? maxAbsGradient / meanAbsGradient : 0;

  return { yPosition, confidence, lowConfidence: confidence < confidenceThreshold };
}

export class SurfaceTracker {
  private lastY: number | null = null;

  // `initialSeedY` is required (no default) and therefore must come before
  // the optional/defaulted parameters below it — TypeScript doesn't allow a
  // required parameter after one with a default value, so this differs from
  // a strict "seed goes last" ordering; the intent (never silently fall back
  // to an unbounded first-frame search) is what matters, not the position.
  constructor(
    private xColumn: number,
    private initialSeedY: number,
    private columnWidth: number = 3,
    private searchMarginPx: number = 40,
    private smoothSigma: number = 2.0,
    private initialSearchMarginPx: number = DEFAULT_INITIAL_SEARCH_MARGIN_PX
  ) {}

  detect(imageData: ImageData): EdgeResult {
    const profile = extractColumnProfile(imageData, this.xColumn, this.columnWidth);

    // First frame (no prior lock yet): search only a bounded margin around
    // where the user actually clicked, never the whole column — an
    // unbounded search here is exactly what let this lock onto an unrelated
    // high-contrast object (a ruler tick, a phone edge, a window frame)
    // elsewhere in frame instead of the real water surface (Phase 16 fix).
    const searchRange: [number, number] =
      this.lastY === null
        ? [this.initialSeedY - this.initialSearchMarginPx, this.initialSeedY + this.initialSearchMarginPx]
        : [this.lastY - this.searchMarginPx, this.lastY + this.searchMarginPx];

    const result = findSurfaceEdge(profile, searchRange, this.smoothSigma);
    this.lastY = result.yPosition;
    return result;
  }

  reset(): void {
    this.lastY = null;
  }
}
