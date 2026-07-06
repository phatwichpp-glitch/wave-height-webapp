// @vitest-environment jsdom
// This file needs jsdom (not the project's default `node` environment) because
// saveCalibrationToLocalStorage/loadCalibrationFromLocalStorage touch the browser
// localStorage API, which plain Node does not provide without an experimental flag.
import { describe, it, expect, beforeEach } from "vitest";
import {
  calculatePixelsPerCm,
  saveCalibrationToLocalStorage,
  loadCalibrationFromLocalStorage,
} from "./calibration";
import type { CalibrationData } from "@/types/wave";

describe("calculatePixelsPerCm", () => {
  it("computes pixels per cm from a known distance", () => {
    const result = calculatePixelsPerCm({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    expect(result).toBeCloseTo(10.0);
  });

  it("throws when knownDistanceCm is zero or negative", () => {
    expect(() =>
      calculatePixelsPerCm({ x: 0, y: 0 }, { x: 0, y: 100 }, 0)
    ).toThrow();
    expect(() =>
      calculatePixelsPerCm({ x: 0, y: 0 }, { x: 0, y: 100 }, -5)
    ).toThrow();
  });

  it("throws when the two points are identical", () => {
    expect(() =>
      calculatePixelsPerCm({ x: 10, y: 20 }, { x: 10, y: 20 }, 10)
    ).toThrow();
  });
});

describe("localStorage calibration round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads calibration data", () => {
    const data: CalibrationData = {
      point1: { x: 0, y: 0 },
      point2: { x: 0, y: 100 },
      knownDistanceCm: 10,
      pixelsPerCm: 10,
    };

    saveCalibrationToLocalStorage(data);
    const loaded = loadCalibrationFromLocalStorage();

    expect(loaded).toEqual(data);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadCalibrationFromLocalStorage()).toBeNull();
  });
});
