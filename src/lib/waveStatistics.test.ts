import { describe, it, expect } from "vitest";
import { zeroUpCrossingWaves, computeWaveStatistics } from "./waveStatistics";

const SAMPLE_RATE_HZ = 30;

function makeTime(durationS: number, sampleRateHz: number = SAMPLE_RATE_HZ): number[] {
  const n = Math.floor(durationS * sampleRateHz);
  return Array.from({ length: n }, (_, i) => i / sampleRateHz);
}

function expectWithinRelativeTolerance(actual: number, expected: number, relTolerance: number) {
  const allowed = Math.abs(expected) * relTolerance;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(allowed);
}

describe("zeroUpCrossingWaves", () => {
  it("matches hand-calculated crossings for a simple triangular wave", () => {
    // Triangular wave with period 4 (index units): -2, 0, 2, 0, repeating.
    // Exactly 4 whole periods (16 samples) so the mean is exactly 0 and
    // detrend() doesn't shift the crossing times.
    // Up-crossings (negative -> non-negative) land exactly at t=1,5,9,13.
    const timeS = Array.from({ length: 16 }, (_, i) => i); // t = 0..15
    const elevationCm = timeS.map((t) => [-2, 0, 2, 0][t % 4]);

    const waves = zeroUpCrossingWaves(timeS, elevationCm);

    expect(waves.length).toBe(3);

    const expectedStarts = [1, 5, 9];
    const expectedEnds = [5, 9, 13];

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
