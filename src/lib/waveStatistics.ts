import type { WaveEvent, WaveStatistics } from "@/types/wave";

/**
 * Removes the least-squares linear trend (fit over sample index, which is
 * equivalent to fitting over time for the uniformly sampled data this app
 * produces). Mean removal alone is not enough here: a slowly drifting
 * baseline — e.g. gradual camera sag over a long clip — would otherwise leak
 * into every wave's crest-to-trough height and bias the statistics upward.
 */
export function detrend(elevationCm: number[]): number[] {
  const n = elevationCm.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [0];
  }

  const indexMean = (n - 1) / 2;
  const valueMean = mean(elevationCm);

  let covariance = 0;
  let indexVariance = 0;
  for (let i = 0; i < n; i++) {
    const dIndex = i - indexMean;
    covariance += dIndex * (elevationCm[i] - valueMean);
    indexVariance += dIndex * dIndex;
  }
  const slope = covariance / indexVariance;

  return elevationCm.map((v, i) => v - (valueMean + slope * (i - indexMean)));
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

export function zeroUpCrossingWaves(timeS: number[], elevationCm: number[]): WaveEvent[] {
  const detrended = detrend(elevationCm);

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

export function computeWaveStatistics(
  timeS: number[],
  elevationCm: number[]
): WaveStatistics {
  const waves = zeroUpCrossingWaves(timeS, elevationCm);

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
