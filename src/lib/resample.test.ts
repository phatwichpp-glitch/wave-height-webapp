import { describe, it, expect } from "vitest";
import { resampleToUniformGrid } from "./resample";
import type { WaveDataPoint } from "@/types/wave";

describe("resampleToUniformGrid", () => {
  it("linearly interpolates between the two straddling real samples at each grid point", () => {
    const data: WaveDataPoint[] = [
      { timeS: 0.5, elevationCm: 10, confidence: 1 },
      { timeS: 1.5, elevationCm: 20, confidence: 2 },
      { timeS: 3.0, elevationCm: 5, confidence: 3 },
    ];

    const resampled = resampleToUniformGrid(data, 1, 4);
    const byTime = new Map(resampled.map((d) => [Math.round(d.timeS), d]));

    // t=1: exactly halfway between (0.5, 10) and (1.5, 20) -> 15.
    expect(byTime.get(1)!.elevationCm).toBeCloseTo(15);
    // t=2: 1/3 of the way from (1.5, 20) to (3.0, 5) -> 20 + (1/3)*(5-20) = 15.
    expect(byTime.get(2)!.elevationCm).toBeCloseTo(15);
  });

  it("clamps to the nearest edge sample instead of extrapolating outside the data's real time range", () => {
    const data: WaveDataPoint[] = [
      { timeS: 0.5, elevationCm: 10, confidence: 1 },
      { timeS: 1.5, elevationCm: 20, confidence: 2 },
      { timeS: 3.0, elevationCm: 5, confidence: 3 },
    ];

    const resampled = resampleToUniformGrid(data, 1, 4);
    const byTime = new Map(resampled.map((d) => [Math.round(d.timeS), d]));

    // t=0 is before the first real sample (0.5s) -> clamped to it, not extrapolated.
    expect(byTime.get(0)!.elevationCm).toBeCloseTo(10);
    expect(byTime.get(0)!.confidence).toBeCloseTo(1);
    // t=4 is after the last real sample (3.0s) -> clamped to it.
    expect(byTime.get(4)!.elevationCm).toBeCloseTo(5);
    expect(byTime.get(4)!.confidence).toBeCloseTo(3);
  });

  it("produces a grid point count matching durationS * targetSampleRateHz (+1 for the endpoint)", () => {
    const data: WaveDataPoint[] = [
      { timeS: 0, elevationCm: 0, confidence: 1 },
      { timeS: 5, elevationCm: 1, confidence: 1 },
    ];

    const resampled = resampleToUniformGrid(data, 10, 2);
    expect(resampled.length).toBe(21); // 0, 0.1, ..., 2.0

    for (let i = 0; i < resampled.length; i++) {
      expect(resampled[i].timeS).toBeCloseTo(i / 10);
    }
  });

  it("returns an empty array for empty input", () => {
    expect(resampleToUniformGrid([], 10, 5)).toEqual([]);
  });

  it("recovers a smooth sine wave closely when resampling irregular samples drawn from it", () => {
    const trueFn = (t: number) => 5 * Math.sin((2 * Math.PI * t) / 2);
    // Irregular timestamps (simulating rVFC's actual decode timing), still
    // densely sampled relative to the 2s period.
    const irregularTimes = [0, 0.07, 0.19, 0.24, 0.41, 0.55, 0.68, 0.79, 0.95, 1.1, 1.3, 1.42, 1.6, 1.75, 1.9];
    const data: WaveDataPoint[] = irregularTimes.map((t) => ({
      timeS: t,
      elevationCm: trueFn(t),
      confidence: 1,
    }));

    const resampled = resampleToUniformGrid(data, 10, 1.9);
    for (const point of resampled) {
      expect(Math.abs(point.elevationCm - trueFn(point.timeS))).toBeLessThanOrEqual(0.5);
    }
  });
});
