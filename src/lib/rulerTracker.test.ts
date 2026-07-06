import { describe, it, expect, vi } from "vitest";
import {
  extractRulerProfile,
  detectTickPeaks,
  fitUniformGrid,
  RulerCalibrationTracker,
  type TickPeak,
} from "./rulerTracker";
import type { RulerCalibration } from "@/types/wave";

const AIR_VALUE = 210;
const TICK_VALUE = 70;

/**
 * A synthetic ruler: a uniform bright background with a single dark pixel row
 * (a "tick mark") every `spacingPx` rows, starting at `phaseOffsetPx`.
 */
function makeRulerImageData(options: {
  width: number;
  height: number;
  roi: { x: number; y: number; width: number; height: number };
  spacingPx: number;
  phaseOffsetPx?: number;
}): ImageData {
  const { width, height, roi, spacingPx, phaseOffsetPx = 0 } = options;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = AIR_VALUE;
    data[idx + 1] = AIR_VALUE;
    data[idx + 2] = AIR_VALUE;
    data[idx + 3] = 255;
  }

  for (let row = 0; row < roi.height; row++) {
    const mod = ((row - phaseOffsetPx) % spacingPx + spacingPx) % spacingPx;
    if (mod >= 1) {
      continue; // only a single-pixel-wide tick line per period
    }
    const y = roi.y + row;
    if (y < 0 || y >= height) {
      continue;
    }
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      if (x < 0 || x >= width) {
        continue;
      }
      const idx = (y * width + x) * 4;
      data[idx] = TICK_VALUE;
      data[idx + 1] = TICK_VALUE;
      data[idx + 2] = TICK_VALUE;
    }
  }

  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function spacingsBetween(peaks: TickPeak[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    gaps.push(peaks[i].pixelPos - peaks[i - 1].pixelPos);
  }
  return gaps;
}

describe("extractRulerProfile", () => {
  it("returns a profile of length roi.height", () => {
    const roi = { x: 0, y: 0, width: 20, height: 100 };
    const imageData = makeRulerImageData({ width: 20, height: 100, roi, spacingPx: 10 });

    const profile = extractRulerProfile(imageData, roi);

    expect(profile.length).toBe(100);
  });
});

describe("detectTickPeaks", () => {
  it("finds tick positions spaced consistently within 2px of the true spacing", () => {
    const spacingPx = 20;
    const roi = { x: 0, y: 0, width: 20, height: 200 };
    const imageData = makeRulerImageData({ width: 20, height: 200, roi, spacingPx });

    const profile = extractRulerProfile(imageData, roi);
    const peaks = detectTickPeaks(profile);

    expect(peaks.length).toBeGreaterThanOrEqual(5);

    for (const gap of spacingsBetween(peaks)) {
      expect(Math.abs(gap - spacingPx)).toBeLessThanOrEqual(2);
    }
  });
});

describe("fitUniformGrid", () => {
  it("recovers a known pixelsPerCm within 3%", () => {
    const truePixelsPerCm = 15;
    const cmPerTick = 1;
    const spacingPx = truePixelsPerCm * cmPerTick;
    const roi = { x: 0, y: 0, width: 20, height: 300 };
    const imageData = makeRulerImageData({ width: 20, height: 300, roi, spacingPx });

    const profile = extractRulerProfile(imageData, roi);
    const peaks = detectTickPeaks(profile);

    const fit = fitUniformGrid(peaks, truePixelsPerCm, 0, 0, cmPerTick);

    const relativeError = Math.abs(fit.pixelsPerCm - truePixelsPerCm) / truePixelsPerCm;
    expect(relativeError).toBeLessThanOrEqual(0.03);
  });

  it("falls back to the prior fit (infinite error) when there are no peaks", () => {
    const fit = fitUniformGrid([], 10, 0, 0, 1);
    expect(fit.pixelsPerCm).toBe(10);
    expect(fit.fitError).toBe(Infinity);
  });
});

describe("RulerCalibrationTracker", () => {
  const cmPerTick = 1;

  function makeCalibration(pixelsPerCm: number, roi: RulerCalibration["roi"]): RulerCalibration {
    return {
      point1: { x: roi.x + roi.width / 2, y: 0, valueCm: 0 },
      point2: { x: roi.x + roi.width / 2, y: pixelsPerCm * 10, valueCm: 10 },
      roi,
    };
  }

  it("shouldCheck() returns true every checkIntervalFrames calls", () => {
    const roi = { x: 0, y: 0, width: 20, height: 300 };
    const tracker = new RulerCalibrationTracker(makeCalibration(15, roi), cmPerTick, 5, 2.0);

    const results = Array.from({ length: 12 }, () => tracker.shouldCheck());
    expect(results).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it("tracks a continuously zooming-in camera without losing lock", () => {
    const roi = { x: 0, y: 0, width: 20, height: 400 };
    const initialPixelsPerCm = 15;
    const tracker = new RulerCalibrationTracker(
      makeCalibration(initialPixelsPerCm, roi),
      cmPerTick,
      1,
      2.0
    );

    // Simulate a camera zooming in gradually across many re-calibration
    // cycles (1% growth per step — a real video would call update() every
    // checkIntervalFrames actual frames, so consecutive fits only ever see a
    // small incremental drift, never a sudden jump). Cumulatively this still
    // reaches a substantial ~1.5x zoom by the end.
    let simulatedPixelsPerCm = initialPixelsPerCm;
    const fits: Array<{ simulatedPixelsPerCm: number; pixelsPerCm: number }> = [];

    const steps = 40;
    for (let step = 0; step < steps; step++) {
      simulatedPixelsPerCm *= 1.01;
      const spacingPx = simulatedPixelsPerCm * cmPerTick;
      const imageData = makeRulerImageData({ width: 20, height: 400, roi, spacingPx });

      tracker.shouldCheck();
      const fit = tracker.update(imageData);
      fits.push({ simulatedPixelsPerCm, pixelsPerCm: fit.pixelsPerCm });
    }

    // The tracker should have followed the zoom the whole way, ending up
    // close to the final true scale — not stuck near the initial value, and
    // not having jumped to a wildly wrong tick count at any point.
    const finalFit = fits[fits.length - 1];
    const relativeError =
      Math.abs(finalFit.pixelsPerCm - finalFit.simulatedPixelsPerCm) /
      finalFit.simulatedPixelsPerCm;
    expect(relativeError).toBeLessThanOrEqual(0.05);

    // Monotonic tracking: pixelsPerCm should have increased along with the
    // simulated zoom, not stayed flat or jumped around erratically.
    for (let i = 1; i < fits.length; i++) {
      expect(fits[i].pixelsPerCm).toBeGreaterThan(fits[i - 1].pixelsPerCm * 0.99);
    }
  });

  it("does not update currentFit when fit error exceeds maxFitError", () => {
    const roi = { x: 0, y: 0, width: 20, height: 200 };
    const tracker = new RulerCalibrationTracker(makeCalibration(15, roi), cmPerTick, 1, 0.01);

    const before = tracker.getCurrentFit();

    // A blank/noisy image with no real ticks should produce a poor (or empty) fit.
    const noisyImageData = {
      data: new Uint8ClampedArray(20 * 200 * 4).fill(128),
      width: 20,
      height: 200,
      colorSpace: "srgb",
    } as ImageData;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const after = tracker.update(noisyImageData);
    warnSpy.mockRestore();

    expect(after).toEqual(before);
    // The rejection is also exposed as state, so callers can surface a UI warning.
    expect(tracker.lastUpdateSkipped).toBe(true);
    expect(tracker.lastSkippedFitError).toBeGreaterThan(0.01);
  });

  it("valueCmToPixelY and pixelXForOffset match hand-calculated values", () => {
    const roi = { x: 100, y: 0, width: 20, height: 300 };
    const pixelsPerCm = 10;
    const calibration = makeCalibration(pixelsPerCm, roi);
    const tracker = new RulerCalibrationTracker(calibration, cmPerTick, 1000, 2.0);

    // anchorPixelPos = point1.y = 0, anchorValueCm = point1.valueCm = 0.
    expect(tracker.valueCmToPixelY(0)).toBeCloseTo(0);
    expect(tracker.valueCmToPixelY(5)).toBeCloseTo(50); // 5cm * 10px/cm
    expect(tracker.valueCmToPixelY(-2)).toBeCloseTo(-20);

    // currentRulerCenterX = roi.x + roi.width/2 = 100 + 10 = 110.
    expect(tracker.pixelXForOffset(0)).toBeCloseTo(110);
    expect(tracker.pixelXForOffset(3)).toBeCloseTo(140); // 110 + 3*10
    expect(tracker.pixelXForOffset(-1)).toBeCloseTo(100);
  });

  it("keeps positive offsets to the right when ruler values increase upward (negative pixelsPerCm)", () => {
    const roi = { x: 100, y: 0, width: 20, height: 300 };
    // Values increase upward: valueCm 0 at pixel y=300, valueCm 30 at y=0
    // -> pixelsPerCm = (0 - 300) / (30 - 0) = -10.
    const calibration: RulerCalibration = {
      point1: { x: 110, y: 300, valueCm: 0 },
      point2: { x: 110, y: 0, valueCm: 30 },
      roi,
    };
    const tracker = new RulerCalibrationTracker(calibration, cmPerTick, 1000, 2.0);

    expect(tracker.getCurrentFit().pixelsPerCm).toBeCloseTo(-10);

    // The signed vertical mapping is unchanged: higher cm value -> smaller pixel y.
    expect(tracker.valueCmToPixelY(0)).toBeCloseTo(300);
    expect(tracker.valueCmToPixelY(10)).toBeCloseTo(200);

    // Horizontal placement must use the magnitude: positive offset = right of
    // center (x=110), never mirrored to the left by the negative sign.
    expect(tracker.pixelXForOffset(3)).toBeCloseTo(140);
    expect(tracker.pixelXForOffset(-1)).toBeCloseTo(100);
  });
});
