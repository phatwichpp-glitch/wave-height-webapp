import FFT from "fft.js";
import type { WaveEvent, WaveStatistics } from "@/types/wave";

/**
 * Removes only the signal's global mean. This is the original (Phase <11)
 * detrending method, kept under its own name because it's also the "naive"
 * baseline computeWaveStatistics falls back to when no sampleRateHz is
 * supplied. It's known to bias period estimates upward whenever a slow
 * baseline drift (or strong low-frequency noise) survives alongside a
 * small-amplitude wave: entire stretches of the signal end up permanently
 * offset from zero, so real up-crossings are missed and two consecutive
 * waves silently merge into one long one. See movingAverageDetrend for the
 * fix (Phase 11).
 */
export function globalMeanDetrend(elevationCm: number[]): number[] {
  const m = mean(elevationCm);
  return elevationCm.map((v) => v - m);
}

/**
 * Removes a *local* trend at each sample — the value minus the average of a
 * centered window around it — instead of one global mean. A slow drift (or
 * any low-frequency component whose period is much longer than
 * `windowSeconds`) tracks the local average and cancels out, while the
 * genuine wave oscillation (whose period should be much shorter than the
 * window) survives, so real zero up-crossings stop getting suppressed by
 * accumulated drift the way globalMeanDetrend's single mean does.
 *
 * Uses a prefix-sum so every window sum is an O(1) lookup — an O(n) pass
 * overall rather than an O(n * windowSize) nested loop.
 */
export function movingAverageDetrend(
  elevationCm: number[],
  sampleRateHz: number,
  windowSeconds: number
): number[] {
  const n = elevationCm.length;
  if (n === 0) {
    return [];
  }

  // Force an odd window so it has a true center sample rather than being
  // biased half a sample toward one side.
  let windowSize = Math.max(1, Math.round(windowSeconds * sampleRateHz));
  if (windowSize % 2 === 0) {
    windowSize += 1;
  }
  const halfWindow = (windowSize - 1) / 2;

  const prefixSum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefixSum[i + 1] = prefixSum[i] + elevationCm[i];
  }

  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // Shrink the window near the edges to whatever data actually exists,
    // rather than zero-padding — padding with zeros would pull the local
    // average toward 0 right at the edges and fabricate an edge artifact.
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    const count = hi - lo + 1;
    const localAverage = (prefixSum[hi + 1] - prefixSum[lo]) / count;
    result[i] = elevationCm[i] - localAverage;
  }

  return result;
}

function maxOf(values: number[]): number {
  let max = -Infinity;
  for (const v of values) {
    if (v > max) {
      max = v;
    }
  }
  return max;
}

function minOf(values: number[]): number {
  let min = Infinity;
  for (const v of values) {
    if (v < min) {
      min = v;
    }
  }
  return min;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Zero up-crossing detection over an *already detrended* signal. Factored out
 * of zeroUpCrossingWaves so computeWaveStatistics can hand it whichever
 * detrended signal it chose (global-mean or moving-average) without
 * detrending twice — zeroUpCrossingWaves below is just this plus the
 * original (global-mean) detrend, kept for backward compatibility with
 * existing callers/tests that pass a raw, non-detrended signal directly.
 */
function detectWaveEvents(timeS: number[], detrended: number[]): WaveEvent[] {
  const crossingTimes: number[] = [];
  const crossingIndices: number[] = [];

  for (let i = 0; i < detrended.length - 1; i++) {
    const v0 = detrended[i];
    const v1 = detrended[i + 1];
    if (v0 < 0 && v1 >= 0) {
      const t0 = timeS[i];
      const t1 = timeS[i + 1];
      // Linear interpolation for a more precise crossing time than the raw
      // sample index would give, since sample rate is limited.
      const frac = v1 !== v0 ? -v0 / (v1 - v0) : 0;
      crossingTimes.push(t0 + frac * (t1 - t0));
      crossingIndices.push(i);
    }
  }

  const waves: WaveEvent[] = [];

  for (let k = 0; k < crossingTimes.length - 1; k++) {
    const idxStart = crossingIndices[k];
    const idxEnd = crossingIndices[k + 1] + 1;
    const segment = detrended.slice(idxStart, idxEnd + 1);

    const tStart = crossingTimes[k];
    const tEnd = crossingTimes[k + 1];

    waves.push({
      tStart,
      tEnd,
      periodS: tEnd - tStart,
      heightCm: maxOf(segment) - minOf(segment),
    });
  }

  if (waves.length < 3) {
    throw new Error(
      `Only ${waves.length} wave(s) could be detected via zero up-crossing ` +
        "(need at least 3) — the signal is too short or has no clear periodic " +
        "waves for statistical analysis."
    );
  }

  return waves;
}

export function zeroUpCrossingWaves(timeS: number[], elevationCm: number[]): WaveEvent[] {
  return detectWaveEvents(timeS, globalMeanDetrend(elevationCm));
}

/**
 * A rough period estimate (via a first zero up-crossing pass using naive
 * global-mean detrending) times 3, used as computeWaveStatistics's
 * moving-average window when the caller doesn't supply one directly. Sized
 * to comfortably span more than one full wave cycle so the moving average
 * tracks slow drift without also cancelling out the wave oscillation itself.
 */
function bootstrapDetrendWindowSeconds(timeS: number[], elevationCm: number[]): number {
  try {
    const roughWaves = detectWaveEvents(timeS, globalMeanDetrend(elevationCm));
    return mean(roughWaves.map((w) => w.periodS)) * 3;
  } catch {
    // The naive pass couldn't find 3 waves at all (short and/or very noisy
    // record) — fall back to a quarter of the record's duration as a single
    // reasonable guess; the actual (moving-average-detrended) up-crossing
    // pass below still gets its own chance to succeed or fail on its own.
    const durationS = timeS[timeS.length - 1] - timeS[0];
    return durationS > 0 ? durationS / 4 : 1;
  }
}

export interface ComputeWaveStatisticsOptions {
  /** Required to enable moving-average detrending — a window is measured in seconds, not samples. */
  sampleRateHz?: number;
  /** Defaults to 'moving-average' when sampleRateHz is given, else falls back to the legacy 'global-mean' (the only method available without a sample rate). */
  detrendMethod?: "global-mean" | "moving-average";
  /** Defaults to 3x a bootstrap period estimate (see bootstrapDetrendWindowSeconds) when not supplied. */
  detrendWindowSeconds?: number;
}

export function computeWaveStatistics(
  timeS: number[],
  elevationCm: number[],
  options: ComputeWaveStatisticsOptions = {}
): WaveStatistics {
  const { sampleRateHz } = options;
  const detrendMethod = options.detrendMethod ?? (sampleRateHz ? "moving-average" : "global-mean");

  const detrended =
    detrendMethod === "moving-average" && sampleRateHz
      ? movingAverageDetrend(
          elevationCm,
          sampleRateHz,
          options.detrendWindowSeconds ?? bootstrapDetrendWindowSeconds(timeS, elevationCm)
        )
      : globalMeanDetrend(elevationCm);

  const waves = detectWaveEvents(timeS, detrended);

  const heights = waves.map((w) => w.heightCm);
  const periods = waves.map((w) => w.periodS);

  const orderDescending = heights
    .map((_, i) => i)
    .sort((a, b) => heights[b] - heights[a]);

  const nWaves = waves.length;
  const nThird = Math.ceil(nWaves / 3);
  const topIndices = orderDescending.slice(0, nThird);

  const topHeights = topIndices.map((i) => heights[i]);
  const topPeriods = topIndices.map((i) => periods[i]);

  return {
    nWaves,
    hMax: maxOf(heights),
    hMean: mean(heights),
    hRms: Math.sqrt(mean(heights.map((h) => h * h))),
    hSignificant: mean(topHeights),
    periodMeanS: mean(periods),
    periodSignificantS: mean(topPeriods),
    waves,
  };
}

export interface SpectralPeriodResult {
  dominantFrequencyHz: number;
  dominantPeriodS: number;
  /** Full power spectrum from DC to Nyquist, kept for plotting so the user can visually judge how sharp/clean the dominant peak is. */
  spectrum: { frequencyHz: number; power: number }[];
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) {
    p *= 2;
  }
  return p;
}

/** Standard Hann window — tapers the signal's ends toward 0 before an FFT to reduce spectral leakage from treating a finite record as if it repeated periodically. */
function hannWindow(n: number): Float64Array {
  const window = new Float64Array(n);
  if (n === 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return window;
}

/**
 * Estimates the dominant wave period via FFT power spectrum peak-picking,
 * independent of (and a cross-check against) the zero up-crossing method —
 * a spectral estimate isn't fooled by individual missed crossings the way
 * up-crossing counting can be.
 *
 * detrendWindowSeconds selects moving-average detrending (recommended: a
 * slow drift would otherwise show up as a huge near-0Hz DC/low-frequency
 * peak that swamps the real wave peak); omitting it falls back to plain
 * global-mean detrending (removes DC only).
 *
 * frequencyRangeHz, when known (e.g. from an expected wave-flume frequency),
 * restricts peak search to that band — otherwise noise or residual drift at
 * very low frequencies can outrank the real peak.
 */
export function estimateDominantPeriod(
  elevationCm: number[],
  sampleRateHz: number,
  detrendWindowSeconds?: number,
  frequencyRangeHz?: [number, number]
): SpectralPeriodResult {
  const n = elevationCm.length;
  if (n < 4) {
    throw new Error("Need at least 4 samples to estimate a dominant period via FFT");
  }

  const detrended =
    detrendWindowSeconds !== undefined
      ? movingAverageDetrend(elevationCm, sampleRateHz, detrendWindowSeconds)
      : globalMeanDetrend(elevationCm);

  const window = hannWindow(n);
  const windowed = detrended.map((v, i) => v * window[i]);

  // fft.js requires a power-of-two size; zero-pad (never truncate) after
  // windowing so every real sample is preserved and the extra bins just
  // interpolate the existing spectrum more finely.
  const fftSize = nextPowerOfTwo(n);
  const paddedInput = new Array(fftSize).fill(0);
  for (let i = 0; i < n; i++) {
    paddedInput[i] = windowed[i];
  }

  const fft = new FFT(fftSize);
  const complexOut = fft.createComplexArray();
  fft.realTransform(complexOut, paddedInput);

  const halfSize = fftSize / 2;
  const spectrum: { frequencyHz: number; power: number }[] = [];
  for (let k = 0; k <= halfSize; k++) {
    const re = complexOut[2 * k];
    const im = complexOut[2 * k + 1];
    spectrum.push({
      frequencyHz: (k * sampleRateHz) / fftSize,
      power: re * re + im * im,
    });
  }

  const [rangeLo, rangeHi] = frequencyRangeHz ?? [0, Infinity];
  let bestIndex = -1;
  let bestPower = -Infinity;
  // k=0 (DC) is always excluded, in or out of a supplied range — it carries
  // no period information (frequency 0 has no corresponding finite period).
  for (let k = 1; k < spectrum.length; k++) {
    const { frequencyHz, power } = spectrum[k];
    if (frequencyHz < rangeLo || frequencyHz > rangeHi) {
      continue;
    }
    if (power > bestPower) {
      bestPower = power;
      bestIndex = k;
    }
  }

  if (bestIndex === -1) {
    throw new Error(
      frequencyRangeHz
        ? `No spectral peak found within the specified frequency range [${rangeLo}, ${rangeHi}] Hz`
        : "No spectral peak found (signal may be too short or entirely flat)"
    );
  }

  const dominantFrequencyHz = spectrum[bestIndex].frequencyHz;

  return {
    dominantFrequencyHz,
    dominantPeriodS: 1 / dominantFrequencyHz,
    spectrum,
  };
}
