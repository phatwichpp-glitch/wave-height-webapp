import { describe, it, expect } from "vitest";
import {
  extractColumnProfile,
  gaussianSmooth1D,
  computeGradient,
  findSurfaceEdge,
  SurfaceTracker,
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
});

describe("SurfaceTracker", () => {
  it("tracks a slowly moving surface across frames", () => {
    const tracker = new SurfaceTracker(50, 3, 40);
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
    const tracker = new SurfaceTracker(50, 3, 40);

    const baselineFrame = makeImageData(WIDTH, HEIGHT, 100);
    const baseline = tracker.detect(baselineFrame);
    expect(Math.abs(baseline.yPosition - 100)).toBeLessThanOrEqual(3);

    const noisyFrame = makeImageData(WIDTH, HEIGHT, 101, {
      extraEdge: { y: 180, value: 255, bandHeight: 6 },
    });
    const result = tracker.detect(noisyFrame);

    expect(Math.abs(result.yPosition - 101)).toBeLessThanOrEqual(3);
  });

  it("resets lastY back to null", () => {
    const tracker = new SurfaceTracker(50);
    tracker.detect(makeImageData(WIDTH, HEIGHT, 100));

    tracker.reset();

    // After reset, the next detect() should search the whole image again
    // (i.e. it should still find a far-away edge instead of being constrained).
    const farFrame = makeImageData(WIDTH, HEIGHT, 150);
    const result = tracker.detect(farFrame);
    expect(Math.abs(result.yPosition - 150)).toBeLessThanOrEqual(3);
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
