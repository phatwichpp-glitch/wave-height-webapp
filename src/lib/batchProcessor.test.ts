// @vitest-environment jsdom
// This file needs jsdom (not the project's default `node` environment)
// because processBatch() uses browser APIs (document.createElement,
// HTMLMediaElement, URL.createObjectURL).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateBatchConfig, matchVideoToConfig, processBatch } from "./batchProcessor";
import * as videoProcessorModule from "@/lib/videoProcessor";
import type { BatchConfig, BatchResult, WaveDataPoint } from "@/types/wave";

const validConfig: BatchConfig = {
  defaultCalibration: {
    point1: { x: 0, y: 0 },
    point2: { x: 0, y: 100 },
    knownDistanceCm: 10,
    pixelsPerCm: 10,
  },
  defaultPoints: [
    {
      id: "p1",
      xColumn: 50,
      label: "Point 1",
      color: "#3b82f6",
      baselineY: 100,
      baselineValueCm: null,
      xOffsetCm: 0,
    },
  ],
  videos: [{ fileNamePattern: "video1.mp4" }],
  sampleRateHz: 10,
};

describe("validateBatchConfig", () => {
  it("accepts a valid config", () => {
    expect(validateBatchConfig(validConfig)).toEqual(validConfig);
  });

  it("throws a specific error when a required field is missing", () => {
    const broken = { ...validConfig, defaultCalibration: undefined };
    expect(() => validateBatchConfig(broken)).toThrow(/defaultCalibration/);
  });

  it("throws a specific error when a field has the wrong type", () => {
    const broken = { ...validConfig, sampleRateHz: "ten" };
    expect(() => validateBatchConfig(broken)).toThrow(/sampleRateHz/);
  });

  it("throws when videos is not an array", () => {
    const broken = { ...validConfig, videos: "not-an-array" };
    expect(() => validateBatchConfig(broken)).toThrow(/videos/);
  });

  it("throws when a measurement point is missing a required field", () => {
    const broken = {
      ...validConfig,
      defaultPoints: [{ xColumn: 50, label: "Point 1", color: "#3b82f6" }], // missing id
    };
    expect(() => validateBatchConfig(broken)).toThrow(/defaultPoints\[0\]\.id/);
  });

  it("throws when the top-level value isn't an object", () => {
    expect(() => validateBatchConfig(null)).toThrow();
    expect(() => validateBatchConfig("a string")).toThrow();
  });
});

describe("matchVideoToConfig", () => {
  it("finds an exact filename match", () => {
    expect(matchVideoToConfig("video1.mp4", validConfig)).toEqual({
      fileNamePattern: "video1.mp4",
    });
  });

  it("returns null when there's no match", () => {
    expect(matchVideoToConfig("unknown.mp4", validConfig)).toBeNull();
  });
});

function makeSineWaveData(): WaveDataPoint[] {
  const sampleRateHz = 10;
  const durationS = 8;
  const periodS = 1;
  const amplitude = 2;
  const n = durationS * sampleRateHz;
  return Array.from({ length: n }, (_, i) => {
    const t = i / sampleRateHz;
    return {
      timeS: t,
      elevationCm: amplitude * Math.sin((2 * Math.PI * t) / periodS),
      confidence: 3,
    };
  });
}

describe("processBatch", () => {
  beforeEach(() => {
    // jsdom doesn't decode real video files, so make load() fire
    // 'loadedmetadata' immediately for any video element processBatch creates.
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (
      this: HTMLVideoElement
    ) {
      queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps processing later files when an earlier one errors, calling callbacks in the right order", async () => {
    const files = [
      new File([""], "video1.mp4"),
      new File([""], "video2.mp4"),
      new File([""], "video3.mp4"),
    ];

    let callIndex = 0;
    vi.spyOn(videoProcessorModule, "processVideo").mockImplementation(
      async (_video, _canvas, _calibration, options) => {
        const index = callIndex++;
        if (index === 1) {
          throw new Error("Simulated decode failure");
        }
        return { [options.points[0].id]: makeSineWaveData() };
      }
    );

    const startedFiles: string[] = [];
    const completedResults: BatchResult[] = [];
    const erroredFiles: Array<{ fileName: string; message: string }> = [];

    const results = await processBatch(
      files,
      validConfig,
      (fileName) => startedFiles.push(fileName),
      (result) => completedResults.push(result),
      (fileName, error) => erroredFiles.push({ fileName, message: error.message })
    );

    expect(startedFiles).toEqual(["video1.mp4", "video2.mp4", "video3.mp4"]);
    expect(results.map((r) => r.fileName)).toEqual(["video1.mp4", "video2.mp4", "video3.mp4"]);
    expect(results.map((r) => r.status)).toEqual(["done", "error", "done"]);

    expect(erroredFiles).toEqual([{ fileName: "video2.mp4", message: "Simulated decode failure" }]);

    // onVideoComplete must fire for every file, success or failure.
    expect(completedResults.map((r) => r.fileName)).toEqual([
      "video1.mp4",
      "video2.mp4",
      "video3.mp4",
    ]);
    expect(completedResults.map((r) => r.status)).toEqual(["done", "error", "done"]);

    expect(completedResults[0].statistics?.p1).toBeDefined();
    expect(completedResults[1].statistics).toBeUndefined();
    expect(completedResults[2].statistics?.p1).toBeDefined();
  });

  it("uses a video's overridePoints/overrideCalibration instead of the batch defaults when matched", async () => {
    const overridePoint = {
      id: "override-p1",
      xColumn: 999,
      label: "Override Point",
      color: "#ef4444",
      baselineY: 50,
      baselineValueCm: null,
      xOffsetCm: 0,
    };
    const configWithOverride: BatchConfig = {
      ...validConfig,
      videos: [{ fileNamePattern: "special.mp4", overridePoints: [overridePoint] }],
    };

    const files = [new File([""], "special.mp4")];

    const receivedOptions: unknown[] = [];
    vi.spyOn(videoProcessorModule, "processVideo").mockImplementation(
      async (_video, _canvas, _calibration, options) => {
        receivedOptions.push(options);
        return { [options.points[0].id]: makeSineWaveData() };
      }
    );

    await processBatch(
      files,
      configWithOverride,
      () => {},
      () => {},
      () => {}
    );

    expect(receivedOptions).toHaveLength(1);
    expect((receivedOptions[0] as { points: typeof overridePoint[] }).points).toEqual([
      overridePoint,
    ]);
  });
});
