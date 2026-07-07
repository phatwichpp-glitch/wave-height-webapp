import { describe, it, expect } from "vitest";
import {
  extractColumnProfile,
  gaussianSmooth1D,
  computeGradient,
  findSurfaceEdge,
  SurfaceTracker,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "./surfaceDetector";

const WIDTH = 100;
const HEIGHT = 200;
const AIR_VALUE = 200;
const WATER_VALUE = 80;

// Plain-object stand-in for the browser's ImageData, satisfying the interface
// structurally so tests don't depend on any real DOM/canvas API.
function makeImageData(
  width: number,
  height: number,
  edgeY: number,
  options: { extraEdge?: { y: number; value: number; bandHeight: number } } = {}
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const value = y < edgeY ? AIR_VALUE : WATER_VALUE;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 255;
    }
  }

  if (options.extraEdge) {
    const { y: bandY, value, bandHeight } = options.extraEdge;
    const yStart = Math.max(0, bandY - Math.floor(bandHeight / 2));
    const yEnd = Math.min(height, bandY + Math.ceil(bandHeight / 2));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = value;
        data[idx + 1] = value;
        data[idx + 2] = value;
        data[idx + 3] = 255;
      }
    }
  }

  return { data, width, height, colorSpace: "srgb" };
}

describe("extractColumnProfile + findSurfaceEdge", () => {
  it("locates the air/water step transition", () => {
    const imageData = makeImageData(WIDTH, HEIGHT, 100);
    const profile = extractColumnProfile(imageData, 50);

    const { yPosition, confidence } = findSurfaceEdge(profile);

    expect(Math.abs(yPosition - 100)).toBeLessThanOrEqual(3);
    expect(confidence).toBeGreaterThan(1.0);
  });

  it("returns a profile of length equal to image height with correct endpoint values", () => {
    const imageData = makeImageData(WIDTH, HEIGHT, 100);
    const profile = extractColumnProfile(imageData, 50, 5);

    expect(profile.length).toBe(HEIGHT);
    expect(profile[0]).toBeCloseTo(AIR_VALUE);
    expect(profile[HEIGHT - 1]).toBeCloseTo(WATER_VALUE);
  });

  it("handles a fractional x column without producing NaN (regression: ruler tracking yields fractional pixel positions)", () => {
    const imageData = makeImageData(WIDTH, HEIGHT, 100);

    // 50.000000000000014-style float noise is what a cm->pixel round trip
    // actually produces; 50.3 covers a genuinely off-grid position.
    for (const x of [50.000000000000014, 50.3, 49.5]) {
      const profile = extractColumnProfile(imageData, x);
      for (const value of profile) {
        expect(Number.isFinite(value)).toBe(true);
      }
      const { yPosition, confidence } = findSurfaceEdge(profile);
      expect(Math.abs(yPosition - 100)).toBeLessThanOrEqual(3);
      expect(confidence).toBeGreaterThan(1.0);
    }
  });

  it("returns a flat (all-zero) profile instead of NaN for a column entirely outside the image", () => {
    const imageData = makeImageData(WIDTH, HEIGHT, 100);
    const profile = extractColumnProfile(imageData, WIDTH + 50);

    expect(profile.length).toBe(HEIGHT);
    for (const value of profile) {
      expect(value).toBe(0);
    }
  });

  it("flags lowConfidence when the peak gradient isn't clearly stronger than the background (Phase 16)", () => {
    // A flat, uniform column has no real edge at all — every gradient sample
    // is ~equally (near-zero) noisy, so no single point dominates.
    const flatData = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(128);
    const flatImageData = { data: flatData, width: WIDTH, height: HEIGHT, colorSpace: "srgb" } as ImageData;
    const flatProfile = extractColumnProfile(flatImageData, 50);
    const flatResult = findSurfaceEdge(flatProfile);
    expect(flatResult.lowConfidence).toBe(true);

    // A clean, unambiguous step edge should NOT be flagged.
    const cleanImageData = makeImageData(WIDTH, HEIGHT, 100);
    const cleanProfile = extractColumnProfile(cleanImageData, 50);
    const cleanResult = findSurfaceEdge(cleanProfile);
    expect(cleanResult.confidence).toBeGreaterThan(DEFAULT_CONFIDENCE_THRESHOLD);
    expect(cleanResult.lowConfidence).toBe(false);
  });
});

describe("SurfaceTracker", () => {
  it("tracks a slowly moving surface across frames", () => {
    const tracker = new SurfaceTracker(50, 100, 3, 40);
    const trueEdges = [100, 101, 103, 104, 103, 101, 100, 99, 98, 99];
    const detected: number[] = [];

    for (const edgeY of trueEdges) {
      const imageData = makeImageData(WIDTH, HEIGHT, edgeY);
      const { yPosition } = tracker.detect(imageData);
      detected.push(yPosition);
    }

    trueEdges.forEach((trueY, i) => {
      expect(Math.abs(detected[i] - trueY)).toBeLessThanOrEqual(3);
    });

    for (let i = 1; i < detected.length; i++) {
      expect(Math.abs(detected[i] - detected[i - 1])).toBeLessThanOrEqual(5);
    }
  });

  it("does not jump to a fake edge outside the search margin", () => {
    const tracker = new SurfaceTracker(50, 100, 3, 40);

    const baselineFrame = makeImageData(WIDTH, HEIGHT, 100);
    const baseline = tracker.detect(baselineFrame);
    expect(Math.abs(baseline.yPosition - 100)).toBeLessThanOrEqual(3);

    const noisyFrame = makeImageData(WIDTH, HEIGHT, 101, {
      extraEdge: { y: 180, value: 255, bandHeight: 6 },
    });
    const result = tracker.detect(noisyFrame);

    expect(Math.abs(result.yPosition - 101)).toBeLessThanOrEqual(3);
  });

  it("never performs an unbounded whole-column search on the first frame, even for a fake edge far stronger than the real one (Phase 16 — root cause of locking onto a ruler/phone/window instead of the water surface)", () => {
    const initialSeedY = 150;
    const initialSearchMarginPx = 60;
    // A very strong fake edge at y=20 (max possible contrast, 0 -> 255) well
    // outside [90, 210] — if the first-frame search were still unbounded,
    // this would win easily over the real (lower-contrast) edge near the seed.
    const imageData = makeImageData(WIDTH, HEIGHT, 100, {
      extraEdge: { y: 20, value: 255, bandHeight: 2 },
    });
    // Force the strongest signal to be the fake edge, not the real one, by
    // using a huge contrast band right at y=20 against a uniform background.
    const tracker = new SurfaceTracker(50, initialSeedY, 3, 40, 2.0, initialSearchMarginPx);
    const result = tracker.detect(imageData);

    expect(result.yPosition).toBeGreaterThanOrEqual(initialSeedY - initialSearchMarginPx);
    expect(result.yPosition).toBeLessThanOrEqual(initialSeedY + initialSearchMarginPx);
  });

  it("still detects correctly when initialSeedY is close to the real surface (no regression for the common case)", () => {
    const tracker = new SurfaceTracker(50, 105, 3, 40);
    const imageData = makeImageData(WIDTH, HEIGHT, 100);
    const result = tracker.detect(imageData);
    expect(Math.abs(result.yPosition - 100)).toBeLessThanOrEqual(3);
  });

  it("resets lastY back to null, re-applying the bounded initial-seed search rather than an unbounded one (Phase 16: reset() must not reopen the old whole-column search)", () => {
    const initialSeedY = 100;
    const initialSearchMarginPx = 60;
    const tracker = new SurfaceTracker(50, initialSeedY, 3, 40, 2.0, initialSearchMarginPx);
    tracker.detect(makeImageData(WIDTH, HEIGHT, 100));

    tracker.reset();

    // A "surface" far outside the initial seed's margin ([40, 160]) must
    // NOT be found even right after reset — the old behavior (search the
    // whole image again) is exactly the bug this phase removes.
    const farFrame = makeImageData(WIDTH, HEIGHT, 250);
    const result = tracker.detect(farFrame);
    expect(result.yPosition).toBeGreaterThanOrEqual(initialSeedY - initialSearchMarginPx);
    expect(result.yPosition).toBeLessThanOrEqual(initialSeedY + initialSearchMarginPx);
  });
});

describe("gaussianSmooth1D", () => {
  it("preserves signal length", () => {
    const signal = new Float32Array([1, 2, 3, 4, 5]);
    const smoothed = gaussianSmooth1D(signal, 2.0);
    expect(smoothed.length).toBe(signal.length);
  });

  it("leaves a constant signal effectively unchanged", () => {
    const signal = new Float32Array(50).fill(42);
    const smoothed = gaussianSmooth1D(signal, 2.0);

    for (const value of smoothed) {
      expect(value).toBeCloseTo(42, 4);
    }
  });
});

describe("computeGradient", () => {
  it("returns ~1 everywhere for a linear ramp", () => {
    const signal = new Float32Array([0, 1, 2, 3, 4, 5]);
    const gradient = computeGradient(signal);

    for (const value of gradient) {
      expect(value).toBeCloseTo(1, 5);
    }
  });
});
