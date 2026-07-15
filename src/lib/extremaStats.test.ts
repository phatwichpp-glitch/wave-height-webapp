import { describe, it, expect } from "vitest";
import {
  computeExtremaStats,
  fitSineWave,
  generateSineFitCurve,
  type ExtremaPoint,
} from "./extremaStats";

/** Deterministic PRNG (mulberry32), matching the convention used in waveStatistics.test.ts, so the noisy-fit test is reproducible. */
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

/** Crest/trough points computed directly from v(t) = offsetCm + amplitudeCm*sin(2*pi*frequencyHz*t) — crest at t = period/4 + k*period, trough at t = 3*period/4 + k*period. */
function syntheticExtrema(
  amplitudeCm: number,
  frequencyHz: number,
  offsetCm: number,
  numWaves: number
): ExtremaPoint[] {
  const periodS = 1 / frequencyHz;
  const points: ExtremaPoint[] = [];
  for (let k = 0; k < numWaves; k++) {
    points.push({ timeS: periodS / 4 + k * periodS, valueCm: offsetCm + amplitudeCm, type: "crest" });
    points.push({
      timeS: (3 * periodS) / 4 + k * periodS,
      valueCm: offsetCm - amplitudeCm,
      type: "trough",
    });
  }
  return points.sort((a, b) => a.timeS - b.timeS);
}

describe("computeExtremaStats", () => {
  it("computes hMax/hMean/hSignificant/periodMeanS matching hand-calculated values for 7 alternating points", () => {
    const extrema: ExtremaPoint[] = [
      { timeS: 0, valueCm: 10, type: "crest" },
      { timeS: 1, valueCm: 2, type: "trough" },
      { timeS: 2, valueCm: 12, type: "crest" },
      { timeS: 3, valueCm: 0, type: "trough" },
      { timeS: 4, valueCm: 11, type: "crest" },
      { timeS: 5, valueCm: 1, type: "trough" },
      { timeS: 6, valueCm: 13, type: "crest" },
    ];

    const stats = computeExtremaStats(extrema);

    // Adjacent-pair heights: |10-2|=8, |2-12|=10, |12-0|=12, |0-11|=11, |11-1|=10, |1-13|=12
    expect(stats.nWaves).toBe(6);
    expect(stats.hMax).toBeCloseTo(12, 9);
    expect(stats.hMean).toBeCloseTo(63 / 6, 9);
    // Top ceil(6/3)=2 heights are [12, 12] -> mean 12.
    expect(stats.hSignificant).toBeCloseTo(12, 9);
    // Crest times 0,2,4,6 -> diffs 2,2,2; trough times 1,3,5 -> diffs 2,2. Mean = 2.
    expect(stats.periodMeanS).toBeCloseTo(2, 9);
    expect(stats.warnings).toEqual([]);
  });

  it("warns (without throwing) when the same type appears twice in a row, but still pairs adjacent points", () => {
    const extrema: ExtremaPoint[] = [
      { timeS: 0, valueCm: 10, type: "crest" },
      { timeS: 1, valueCm: 9, type: "crest" },
      { timeS: 2, valueCm: 2, type: "trough" },
      { timeS: 3, valueCm: 11, type: "crest" },
      { timeS: 4, valueCm: 1, type: "trough" },
    ];

    const stats = computeExtremaStats(extrema);

    expect(stats.warnings).toHaveLength(1);
    expect(stats.warnings[0]).toMatchObject({
      type: "consecutiveSameType",
      extremaType: "crest",
      time1S: 0,
      time2S: 1,
    });
    expect(stats.nWaves).toBe(4);
  });

  it("sorts by timeS regardless of input order", () => {
    const shuffled: ExtremaPoint[] = [
      { timeS: 3, valueCm: 0, type: "trough" },
      { timeS: 0, valueCm: 10, type: "crest" },
      { timeS: 2, valueCm: 12, type: "crest" },
      { timeS: 1, valueCm: 2, type: "trough" },
    ];
    const sortedInput: ExtremaPoint[] = [...shuffled].sort((a, b) => a.timeS - b.timeS);

    expect(computeExtremaStats(shuffled)).toEqual(computeExtremaStats(sortedInput));
  });

  it("returns zeros (not NaN) for empty and single-point input", () => {
    expect(computeExtremaStats([])).toMatchObject({ nWaves: 0, hMax: 0, hMean: 0, hSignificant: 0, periodMeanS: 0 });
    expect(
      computeExtremaStats([{ timeS: 0, valueCm: 5, type: "crest" }])
    ).toMatchObject({ nWaves: 0, hMax: 0, hMean: 0, hSignificant: 0, periodMeanS: 0 });
  });
});

describe("fitSineWave", () => {
  it("recovers amplitude/frequency/offset within 2% and rSquared > 0.99 from a noiseless synthetic sine", () => {
    const amplitudeCm = 8;
    const frequencyHz = 0.4;
    const offsetCm = 15;
    const extrema = syntheticExtrema(amplitudeCm, frequencyHz, offsetCm, 6);

    const fit = fitSineWave(extrema);

    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.amplitudeCm - amplitudeCm) / amplitudeCm).toBeLessThanOrEqual(0.02);
    expect(Math.abs(fit!.frequencyHz - frequencyHz) / frequencyHz).toBeLessThanOrEqual(0.02);
    expect(Math.abs(fit!.offsetCm - offsetCm) / offsetCm).toBeLessThanOrEqual(0.02);
    expect(fit!.rSquared).toBeGreaterThan(0.99);
  });

  it("still recovers amplitude within 10% (and a lower but still-high rSquared) when the marked values carry realistic hand-reading noise", () => {
    const amplitudeCm = 8;
    const frequencyHz = 0.4;
    const offsetCm = 15;
    const clean = syntheticExtrema(amplitudeCm, frequencyHz, offsetCm, 8);

    const rand = mulberry32(42);
    const noisy = clean.map((p) => ({ ...p, valueCm: p.valueCm + (rand() - 0.5) * 0.6 }));

    const cleanFit = fitSineWave(clean);
    const noisyFit = fitSineWave(noisy);

    expect(noisyFit).not.toBeNull();
    expect(Math.abs(noisyFit!.amplitudeCm - amplitudeCm) / amplitudeCm).toBeLessThanOrEqual(0.1);
    expect(noisyFit!.rSquared).toBeGreaterThan(0.8);
    expect(noisyFit!.rSquared).toBeLessThanOrEqual(cleanFit!.rSquared);
  });

  it("does not return a wildly inflated amplitude when marked points happen to fall near-exactly on half-period offsets of a candidate frequency (regression: grid search picked an ill-conditioned near-degenerate frequency where the fitted amplitude blew up to ~33cm against ~10cm-amplitude data, despite a deceptively high reported rSquared)", () => {
    // Hand-picked crest/trough values with realistic cycle-to-cycle
    // variation (not a perfect sine) at exactly 1Hz, sampled at exactly
    // t = 0.25 + 0.5*k — this specific alignment makes the design matrix
    // ill-conditioned right at the true 1Hz frequency.
    const extrema: ExtremaPoint[] = [
      { timeS: 0.25, valueCm: 24, type: "crest" },
      { timeS: 0.75, valueCm: 6, type: "trough" },
      { timeS: 1.25, valueCm: 25, type: "crest" },
      { timeS: 1.75, valueCm: 5, type: "trough" },
      { timeS: 2.25, valueCm: 23, type: "crest" },
      { timeS: 2.75, valueCm: 7, type: "trough" },
      { timeS: 3.25, valueCm: 26, type: "crest" },
      { timeS: 3.75, valueCm: 4, type: "trough" },
    ];

    const fit = fitSineWave(extrema);

    expect(fit).not.toBeNull();
    // The data's own peak-to-peak range is 26-4=22cm, so amplitude has no
    // business exceeding that by a wide margin.
    expect(fit!.amplitudeCm).toBeLessThan(15);
  });

  it("returns null with fewer than 4 points instead of throwing", () => {
    expect(fitSineWave([])).toBeNull();
    expect(
      fitSineWave([
        { timeS: 0, valueCm: 5, type: "crest" },
        { timeS: 1, valueCm: 1, type: "trough" },
        { timeS: 2, valueCm: 5, type: "crest" },
      ])
    ).toBeNull();
  });
});

describe("generateSineFitCurve", () => {
  it("returns exactly numPoints samples, matching the known formula at each timestamp", () => {
    const fit = {
      amplitudeCm: 8,
      frequencyHz: 0.4,
      periodS: 2.5,
      phaseRad: 0.3,
      offsetCm: 15,
      rSquared: 1,
    };

    const curve = generateSineFitCurve(fit, 0, 10, 11);

    expect(curve).toHaveLength(11);
    for (const point of curve) {
      const expected =
        fit.offsetCm + fit.amplitudeCm * Math.sin(2 * Math.PI * fit.frequencyHz * point.timeS + fit.phaseRad);
      expect(point.valueCm).toBeCloseTo(expected, 9);
    }
    expect(curve[0].timeS).toBeCloseTo(0, 9);
    expect(curve[curve.length - 1].timeS).toBeCloseTo(10, 9);
  });
});
