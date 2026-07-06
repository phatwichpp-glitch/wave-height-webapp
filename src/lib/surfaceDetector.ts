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
}

export function findSurfaceEdge(
  profile: Float32Array,
  searchRange: [number, number] | null = null,
  smoothSigma: number = 2.0
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

  return { yPosition, confidence };
}

export class SurfaceTracker {
  private lastY: number | null = null;

  constructor(
    private xColumn: number,
    private columnWidth: number = 3,
    private searchMarginPx: number = 40,
    private smoothSigma: number = 2.0
  ) {}

  detect(imageData: ImageData): EdgeResult {
    const profile = extractColumnProfile(imageData, this.xColumn, this.columnWidth);

    const searchRange: [number, number] | null =
      this.lastY === null
        ? null
        : [this.lastY - this.searchMarginPx, this.lastY + this.searchMarginPx];

    const result = findSurfaceEdge(profile, searchRange, this.smoothSigma);
    this.lastY = result.yPosition;
    return result;
  }

  reset(): void {
    this.lastY = null;
  }
}
