import { describe, it, expect } from "vitest";
import {
  globalMeanDetrend,
  movingAverageDetrend,
  zeroUpCrossingWaves,
  computeWaveStatistics,
  estimateDominantPeriod,
} from "./waveStatistics";

const SAMPLE_RATE_HZ = 30;

function makeTime(durationS: number, sampleRateHz: number = SAMPLE_RATE_HZ): number[] {
  const n = Math.floor(durationS * sampleRateHz);
  return Array.from({ length: n }, (_, i) => i / sampleRateHz);
}

function expectWithinRelativeTolerance(actual: number, expected: number, relTolerance: number) {
  const allowed = Math.abs(expected) * relTolerance;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(allowed);
}

function rmsError(actual: number[], expected: number[]): number {
  const n = actual.length;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = actual[i] - expected[i];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / n);
}

/** Deterministic PRNG (mulberry32) so the "critical" regression test below is reproducible across runs/machines instead of depending on Math.random(). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("globalMeanDetrend", () => {
  it("removes only the mean, leaving a linear ramp's slope intact", () => {
    const signal = Array.from({ length: 50 }, (_, i) => 3 + 0.7 * i);
    const detrended = globalMeanDetrend(signal);

    // The mean is gone (average of the detrended signal is ~0)...
    expect(Math.abs(detrended.reduce((s, v) => s + v, 0) / detrended.length)).toBeLessThanOrEqual(
      1e-9
    );
    // ...but the ramp itself is still there: the first and last points are
    // still far apart (unlike a true linear detrend, which would flatten it).
    expect(Math.abs(detrended[detrended.length - 1] - detrended[0])).toBeCloseTo(
      0.7 * (signal.length - 1),
      6
    );
  });

  it("handles empty and single-sample inputs without NaN", () => {
    expect(globalMeanDetrend([])).toEqual([]);
    expect(globalMeanDetrend([5])[0]).toBeCloseTo(0);
  });
});

describe("movingAverageDetrend", () => {
  it("tracks and removes a slow linear drift far better than global-mean detrending, recovering the underlying sine within 10%", () => {
    const amplitudeCm = 5;
    const periodS = 2;
    const durationS = 60;
    const driftPerSecondCm = 0.1; // 6cm of drift over the record — spec's example rate

    const timeS = makeTime(durationS);
    const pureSine = timeS.map((t) => amplitudeCm * Math.sin((2 * Math.PI * t) / periodS));
    const withDrift = timeS.map((t, i) => pureSine[i] + driftPerSecondCm * t);

    const globalDetrended = globalMeanDetrend(withDrift);
    const movingDetrended = movingAverageDetrend(withDrift, SAMPLE_RATE_HZ, periodS * 3);

    const globalRmsError = rmsError(globalDetrended, pureSine) / amplitudeCm;
    const movingRmsError = rmsError(movingDetrended, pureSine) / amplitudeCm;

    expect(movingRmsError).toBeLessThanOrEqual(0.1);
    // The whole point of Phase 11: moving-average must clearly beat the old method.
    expect(movingRmsError).toBeLessThan(globalRmsError);
  });

  it("preserves signal length and handles edges without zero-padding artifacts", () => {
    const n = 41;
    const signal = Array.from({ length: n }, () => 10);
    const detrended = movingAverageDetrend(signal, SAMPLE_RATE_HZ, 1);

    expect(detrended.length).toBe(n);
    // A perfectly flat signal has zero local trend everywhere, including at
    // the (shrunk) edge windows — zero-padding instead would have pulled the
    // edge values away from 0 toward the padding.
    for (const value of detrended) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe("zeroUpCrossingWaves", () => {
  it("matches hand-calculated crossings for a simple square wave", () => {
    // Square wave with period 4 (index units): -2, 2, 2, -2, repeating.
    // Exactly 4 whole periods (16 samples), and the pattern is symmetric
    // about the midpoint of the record, so global-mean detrending (mean is
    // exactly 0) doesn't shift the crossing times.
    // Up-crossings (negative -> non-negative) interpolate to t=0.5, 4.5, 8.5, 12.5.
    const timeS = Array.from({ length: 16 }, (_, i) => i); // t = 0..15
    const elevationCm = timeS.map((t) => [-2, 2, 2, -2][t % 4]);

    const waves = zeroUpCrossingWaves(timeS, elevationCm);

    expect(waves.length).toBe(3);

    const expectedStarts = [0.5, 4.5, 8.5];
    const expectedEnds = [4.5, 8.5, 12.5];

    waves.forEach((wave, i) => {
      expect(wave.tStart).toBeCloseTo(expectedStarts[i]);
      expect(wave.tEnd).toBeCloseTo(expectedEnds[i]);
      expect(wave.periodS).toBeCloseTo(4);
      expect(wave.heightCm).toBeCloseTo(4);
    });
  });

  it("throws when the signal is too short to detect at least 3 waves", () => {
    const timeS = makeTime(1); // 1s at 30Hz, period below is 2s
    const elevationCm = timeS.map((t) => 10 * Math.sin((2 * Math.PI * t) / 2));

    expect(() => zeroUpCrossingWaves(timeS, elevationCm)).toThrow();
  });
});

describe("computeWaveStatistics", () => {
  it("recovers amplitude and period from a pure sine wave within 5%", () => {
    const amplitudeCm = 10;
    const periodS = 2;
    const durationS = 60;
    const expectedHeightCm = 2 * amplitudeCm; // crest-to-trough

    const timeS = makeTime(durationS);
    const elevationCm = timeS.map(
      (t) => amplitudeCm * Math.sin((2 * Math.PI * t) / periodS)
    );

    const stats = computeWaveStatistics(timeS, elevationCm);

    expectWithinRelativeTolerance(stats.hMax, expectedHeightCm, 0.05);
    expectWithinRelativeTolerance(stats.hMean, expectedHeightCm, 0.05);
    expectWithinRelativeTolerance(stats.hSignificant, expectedHeightCm, 0.05);
    expectWithinRelativeTolerance(stats.periodMeanS, periodS, 0.05);
    expect(stats.nWaves).toBeGreaterThanOrEqual(25);
  });

  it("is unaffected by a strong linear baseline drift when moving-average detrending is enabled via sampleRateHz", () => {
    // Same sine as above but with a 1 cm/s drift added — 60cm of drift over
    // the record, 2cm per wave period. The legacy global-mean default (no
    // sampleRateHz) would inflate/bias every wave's height and period;
    // supplying sampleRateHz switches the default to moving-average detrend.
    const amplitudeCm = 10;
    const periodS = 2;
    const timeS = makeTime(60);
    const elevationCm = timeS.map(
      (t) => amplitudeCm * Math.sin((2 * Math.PI * t) / periodS) + 1.0 * t
    );

    const stats = computeWaveStatistics(timeS, elevationCm, { sampleRateHz: SAMPLE_RATE_HZ });

    expectWithinRelativeTolerance(stats.hMean, 2 * amplitudeCm, 0.05);
    expectWithinRelativeTolerance(stats.periodMeanS, periodS, 0.05);
  });

  it("keeps hMax >= hSignificant >= hMean for a mixed-height wave train", () => {
    const durationS = 60;
    const timeS = makeTime(durationS);
    const elevationCm = timeS.map(
      (t) =>
        8 * Math.sin((2 * Math.PI * t) / 4) + 3 * Math.sin((2 * Math.PI * t) / 1.3)
    );

    const stats = computeWaveStatistics(timeS, elevationCm);

    expect(stats.hSignificant).toBeGreaterThan(stats.hMean);
    expect(stats.hMax).toBeGreaterThanOrEqual(stats.hSignificant);
    expect(stats.hSignificant).toBeGreaterThanOrEqual(stats.hMean);
  });

  it("throws when the signal is too short", () => {
    const timeS = makeTime(1);
    const elevationCm = timeS.map((t) => 10 * Math.sin((2 * Math.PI * t) / 2));

    expect(() => computeWaveStatistics(timeS, elevationCm)).toThrow();
  });
});

describe("estimateDominantPeriod", () => {
  it("recovers a known period from a pure sine wave within 5%", () => {
    const periodS = 2.5; // 0.4 Hz
    const durationS = 60;
    const timeS = makeTime(durationS);
    const elevationCm = timeS.map((t) => 3 * Math.sin((2 * Math.PI * t) / periodS));

    const result = estimateDominantPeriod(elevationCm, SAMPLE_RATE_HZ);

    expectWithinRelativeTolerance(result.dominantPeriodS, periodS, 0.05);
    expect(result.spectrum.length).toBeGreaterThan(0);
  });

  it("restricts the peak search to frequencyRangeHz, ignoring a stronger out-of-range component", () => {
    const durationS = 60;
    const timeS = makeTime(durationS);
    const targetFrequencyHz = 0.4; // weaker, in-range
    const strongerOutOfRangeHz = 2.0; // stronger, deliberately outside the searched range

    const elevationCm = timeS.map(
      (t) =>
        1 * Math.sin(2 * Math.PI * targetFrequencyHz * t) +
        5 * Math.sin(2 * Math.PI * strongerOutOfRangeHz * t)
    );

    // Without a range restriction, the stronger high-frequency component wins.
    const unrestricted = estimateDominantPeriod(elevationCm, SAMPLE_RATE_HZ);
    expect(Math.abs(unrestricted.dominantFrequencyHz - strongerOutOfRangeHz)).toBeLessThan(0.05);

    // Restricting the search to a band around the weaker target frequency
    // must find it instead, ignoring the stronger peak outside the band.
    const restricted = estimateDominantPeriod(elevationCm, SAMPLE_RATE_HZ, undefined, [0.2, 0.6]);
    expect(Math.abs(restricted.dominantFrequencyHz - targetFrequencyHz)).toBeLessThan(0.05);
  });
});

describe("Phase 11 critical regression: small-amplitude wave + drift + noise period bias", () => {
  it("reproduces the old global-mean period bias (a), shows moving-average detrend fixes it (b), and FFT is the most accurate of the three (c)", () => {
    const amplitudeCm = 0.5; // sub-cm, matching the reported real-world symptom
    const periodS = 2.5; // 0.4 Hz, matching the reported wave-flume setting
    const durationS = 150; // 60 full cycles
    const driftPerSecondCm = 0.03; // slow drift, ~9x the wave amplitude over the record
    const noiseAmplitudeCm = 0.05; // sub-pixel-scale detection jitter, 10% of wave amplitude

    const rng = mulberry32(20260707);
    const timeS = makeTime(durationS);
    const elevationCm = timeS.map((t) => {
      const wave = amplitudeCm * Math.sin((2 * Math.PI * t) / periodS);
      const drift = driftPerSecondCm * t;
      const noise = (rng() - 0.5) * 2 * noiseAmplitudeCm;
      return wave + drift + noise;
    });

    // (a) legacy behavior: global-mean detrend (computeWaveStatistics's
    // fallback when no sampleRateHz is supplied).
    const globalStats = computeWaveStatistics(timeS, elevationCm);
    const globalErrorPct = Math.abs(globalStats.periodMeanS - periodS) / periodS;

    // (b) new behavior: moving-average detrend, window = 3x the true period
    // (matching the "3x a period estimate" bootstrap rule from Part 1/3).
    const movingStats = computeWaveStatistics(timeS, elevationCm, {
      sampleRateHz: SAMPLE_RATE_HZ,
      detrendWindowSeconds: periodS * 3,
    });
    const movingErrorPct = Math.abs(movingStats.periodMeanS - periodS) / periodS;

    // (c) FFT-based dominant period, same detrend window.
    const spectral = estimateDominantPeriod(elevationCm, SAMPLE_RATE_HZ, periodS * 3);
    const fftErrorPct = Math.abs(spectral.dominantPeriodS - periodS) / periodS;

    console.log(
      `[Phase 11 regression] true period = ${periodS.toFixed(3)}s\n` +
        `  (a) global-mean zero up-crossing:   ${globalStats.periodMeanS.toFixed(3)}s ` +
        `(error ${(globalErrorPct * 100).toFixed(1)}%)\n` +
        `  (b) moving-average zero up-crossing: ${movingStats.periodMeanS.toFixed(3)}s ` +
        `(error ${(movingErrorPct * 100).toFixed(1)}%)\n` +
        `  (c) FFT dominant period:             ${spectral.dominantPeriodS.toFixed(3)}s ` +
        `(error ${(fftErrorPct * 100).toFixed(1)}%)`
    );

    expect(globalErrorPct).toBeGreaterThan(0.2);
    expect(movingErrorPct).toBeLessThanOrEqual(0.15);
    expect(fftErrorPct).toBeLessThanOrEqual(0.1);
  });
});
