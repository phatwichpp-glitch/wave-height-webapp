import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureFrameAtTime,
  getMultiColumnCropBounds,
  processVideo,
} from "./videoProcessor";
import { extractColumnProfile, findSurfaceEdge } from "./surfaceDetector";
import type {
  PointRequest,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/workers/videoProcessing.worker";
import type { CalibrationData, MeasurementPoint, RulerCalibration } from "@/types/wave";

type Listener = () => void;

function createMockVideo(options: {
  videoWidth: number;
  videoHeight: number;
  duration: number;
  fireSeeked?: boolean;
}) {
  const listeners: Record<string, Listener[]> = {};
  let currentTimeValue = 0;

  const video = {
    addEventListener(type: string, handler: Listener) {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    },
    removeEventListener(type: string, handler: Listener) {
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
    },
    videoWidth: options.videoWidth,
    videoHeight: options.videoHeight,
    duration: options.duration,
    get currentTime() {
      return currentTimeValue;
    },
    set currentTime(value: number) {
      currentTimeValue = value;
      if (options.fireSeeked === false) {
        return; // simulate a seek that never completes, for timeout testing
      }
      queueMicrotask(() => {
        (listeners["seeked"] ?? []).forEach((handler) => handler());
      });
    },
  };

  return video as unknown as HTMLVideoElement;
}

function createMockCanvas(width: number, height: number) {
  let canvasWidth = width;
  let canvasHeight = height;

  const ctx = {
    drawImage() {
      /* no-op: no real video frame to draw in this mock */
    },
    getImageData(_x: number, _y: number, w: number, h: number): ImageData {
      const data = new Uint8ClampedArray(w * h * 4).fill(150);
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
  };

  return {
    getContext() {
      return ctx;
    },
    get width() {
      return canvasWidth;
    },
    set width(value: number) {
      canvasWidth = value;
    },
    get height() {
      return canvasHeight;
    },
    set height(value: number) {
      canvasHeight = value;
    },
  } as unknown as HTMLCanvasElement;
}

// Like createMockCanvas, but renders a real per-column air/water edge (as a
// function of column position and the mock video's current time) instead of
// a flat fill — needed to verify that two measurement points bundled into the
// same captured crop each track their own edge correctly.
function createMockCanvasWithVerticalEdges(
  video: HTMLVideoElement,
  width: number,
  height: number,
  edgeYForColumnAndTime: (x: number, t: number) => number
) {
  let canvasWidth = width;
  let canvasHeight = height;

  const ctx = {
    drawImage() {
      /* no-op */
    },
    getImageData(x: number, _y: number, w: number, h: number): ImageData {
      const t = video.currentTime;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const globalX = x + col;
          const edgeY = edgeYForColumnAndTime(globalX, t);
          const value = row < edgeY ? 200 : 80;
          const idx = (row * w + col) * 4;
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
  };

  return {
    getContext() {
      return ctx;
    },
    get width() {
      return canvasWidth;
    },
    set width(value: number) {
      canvasWidth = value;
    },
    get height() {
      return canvasHeight;
    },
    set height(value: number) {
      canvasHeight = value;
    },
  } as unknown as HTMLCanvasElement;
}

// A mock canvas whose getImageData renders two things depending on which
// region is queried: a striped ruler tick pattern inside `rulerRoi`, and a
// static air/water edge (at `edgeY`) everywhere else — enough to exercise
// both processVideo's measurement-point pipeline and its ruler re-calibration
// pipeline (captureRoiFromCanvas) from the same synthetic frame.
function createMockCanvasForRulerTest(
  width: number,
  height: number,
  rulerRoi: { x: number; y: number; width: number; height: number },
  rulerSpacingPx: number,
  edgeY: number
) {
  let canvasWidth = width;
  let canvasHeight = height;

  const AIR = 200;
  const WATER = 80;
  const TICK = 70;
  const BACKGROUND = 210;

  const ctx = {
    drawImage() {
      /* no-op */
    },
    getImageData(x: number, y: number, w: number, h: number): ImageData {
      const data = new Uint8ClampedArray(w * h * 4);

      for (let row = 0; row < h; row++) {
        const globalY = y + row;
        for (let col = 0; col < w; col++) {
          const globalX = x + col;

          const inRuler =
            globalX >= rulerRoi.x &&
            globalX < rulerRoi.x + rulerRoi.width &&
            globalY >= rulerRoi.y &&
            globalY < rulerRoi.y + rulerRoi.height;

          let value: number;
          if (inRuler) {
            const rowInRoi = globalY - rulerRoi.y;
            const mod = ((rowInRoi % rulerSpacingPx) + rulerSpacingPx) % rulerSpacingPx;
            value = mod < 1 ? TICK : BACKGROUND;
          } else {
            value = globalY < edgeY ? AIR : WATER;
          }

          const idx = (row * w + col) * 4;
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }

      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
  };

  return {
    getContext() {
      return ctx;
    },
    get width() {
      return canvasWidth;
    },
    set width(value: number) {
      canvasWidth = value;
    },
    get height() {
      return canvasHeight;
    },
    set height(value: number) {
      canvasHeight = value;
    },
  } as unknown as HTMLCanvasElement;
}

// Stand-in for the real Worker: runs the exact same extractColumnProfile +
// findSurfaceEdge logic the real videoProcessing.worker.ts uses (for every
// point in the message), so processVideo's orchestration (looping, progress,
// elevation conversion, multi-point independence) can be tested without a
// real browser Worker/postMessage implementation (neither Node nor jsdom
// implements Web Workers).
class MockWorker {
  private messageHandlers: Array<(event: MessageEvent<WorkerResponseMessage>) => void> = [];

  addEventListener(type: string, handler: (event: MessageEvent<WorkerResponseMessage>) => void) {
    if (type === "message") {
      this.messageHandlers.push(handler);
    }
  }

  removeEventListener(
    type: string,
    handler: (event: MessageEvent<WorkerResponseMessage>) => void
  ) {
    if (type === "message") {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    }
  }

  postMessage(message: WorkerRequestMessage) {
    const results = message.points.map((point: PointRequest) => {
      const profile = extractColumnProfile(
        message.imageData,
        point.xColumnRelative,
        message.columnWidth
      );
      const { yPosition, confidence } = findSurfaceEdge(
        profile,
        point.searchRange,
        message.smoothSigma
      );
      return { pointId: point.pointId, yPosition, confidence };
    });

    queueMicrotask(() => {
      this.messageHandlers.forEach((handler) =>
        handler({ data: results } as MessageEvent<WorkerResponseMessage>)
      );
    });
  }

  terminate() {
    /* no-op */
  }
}

describe("captureFrameAtTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when the video never fires 'seeked'", async () => {
    vi.useFakeTimers();
    const video = createMockVideo({
      videoWidth: 100,
      videoHeight: 200,
      duration: 10,
      fireSeeked: false,
    });
    const canvas = {} as HTMLCanvasElement;

    const promise = captureFrameAtTime(video, canvas, 1.5);
    const assertion = expect(promise).rejects.toThrow(/timed out/i);

    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe("getMultiColumnCropBounds", () => {
  it("computes correct relative offsets for widely separated points", () => {
    const { xMin, xMax, relativeX } = getMultiColumnCropBounds([50, 800], 3, 1000);

    expect(xMin).toBe(49); // 50 - floor(3/2)
    expect(xMax).toBe(801); // 800 + floor(3/2)
    expect(relativeX).toEqual([1, 751]);

    // Mapping each relative offset back onto the crop's origin must recover
    // the original absolute column positions.
    expect(xMin + relativeX[0]).toBe(50);
    expect(xMin + relativeX[1]).toBe(800);
  });
});

describe("processVideo", () => {
  const calibration: CalibrationData = {
    point1: { x: 0, y: 0 },
    point2: { x: 0, y: 100 },
    knownDistanceCm: 10,
    pixelsPerCm: 10,
  };

  beforeEach(() => {
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const singlePoint: MeasurementPoint[] = [
    {
      id: "p1",
      xColumn: 50,
      label: "Point 1",
      color: "#3b82f6",
      baselineY: 100,
      baselineValueCm: null,
      xOffsetCm: 0,
    },
  ];

  it("produces one data point per sampled frame per point and reports progress to completion", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    const canvas = createMockCanvas(100, 200);
    const progressValues: number[] = [];

    const result = await processVideo(video, canvas, calibration, {
      points: singlePoint,
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
      onProgress: (percent) => progressValues.push(percent),
    });

    expect(result.p1.length).toBe(10); // duration=1s * sampleRateHz=10
    expect(progressValues.length).toBe(10);
    expect(progressValues[progressValues.length - 1]).toBeCloseTo(100);

    for (const point of result.p1) {
      expect(typeof point.timeS).toBe("number");
      expect(typeof point.elevationCm).toBe("number");
      expect(typeof point.confidence).toBe("number");
    }
  });

  it("auto-computes a baseline from the first frames when baselineY is null", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    const canvas = createMockCanvas(100, 200);

    const result = await processVideo(video, canvas, calibration, {
      points: [{ ...singlePoint[0], baselineY: null }],
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
    });

    expect(result.p1.length).toBe(10);
  });

  it("tracks two points independently when their edges move in opposite directions", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    // Left half (x<50): edge moves down over time. Right half: edge moves up.
    const canvas = createMockCanvasWithVerticalEdges(video, 100, 200, (x, t) =>
      x < 50 ? 100 + Math.round(t * 20) : 100 - Math.round(t * 20)
    );

    const points: MeasurementPoint[] = [
      {
        id: "left",
        xColumn: 20,
        label: "Left",
        color: "#3b82f6",
        baselineY: 100,
        baselineValueCm: null,
        xOffsetCm: 0,
      },
      {
        id: "right",
        xColumn: 80,
        label: "Right",
        color: "#ef4444",
        baselineY: 100,
        baselineValueCm: null,
        xOffsetCm: 0,
      },
    ];

    const result = await processVideo(video, canvas, calibration, {
      points,
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
    });

    const leftData = result.left;
    const rightData = result.right;

    expect(leftData.length).toBe(10);
    expect(rightData.length).toBe(10);

    // Left edge moved down (y increased) -> elevation (baseline - y) decreases.
    expect(leftData[leftData.length - 1].elevationCm).toBeLessThan(leftData[0].elevationCm);
    // Right edge moved up (y decreased) -> elevation increases.
    expect(rightData[rightData.length - 1].elevationCm).toBeGreaterThan(
      rightData[0].elevationCm
    );
  });

  it("pauses the main loop while isPausedRef.current is true and resumes when set false", async () => {
    vi.useFakeTimers();
    try {
      const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
      const canvas = createMockCanvas(100, 200);
      const isPausedRef = { current: true };
      const progressValues: number[] = [];

      const resultPromise = processVideo(video, canvas, calibration, {
        points: singlePoint,
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        sampleRateHz: 10,
        isPausedRef,
        onProgress: (percent) => progressValues.push(percent),
      });

      // Still paused: the poll loop should keep waiting, no frames processed yet.
      await vi.advanceTimersByTimeAsync(500);
      expect(progressValues.length).toBe(0);

      // Resume: the next poll tick should notice the flag flipped and proceed.
      isPausedRef.current = false;
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result.p1.length).toBe(10);
      expect(progressValues.length).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onFrameProcessed with a live detection per point after every frame", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    const canvas = createMockCanvas(100, 200);
    const frames: number[] = [];

    const result = await processVideo(video, canvas, calibration, {
      points: singlePoint,
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
      onFrameProcessed: (detections) => {
        frames.push(detections.length);
        expect(detections[0]).toMatchObject({
          pointId: "p1",
          color: "#3b82f6",
          baselineY: 100,
        });
        expect(typeof detections[0].xColumn).toBe("number");
        expect(typeof detections[0].yPosition).toBe("number");
        expect(typeof detections[0].confidence).toBe("number");
      },
    });

    expect(frames.length).toBe(10);
    expect(frames.every((count) => count === 1)).toBe(true);
    expect(result.p1.length).toBe(10);
  });

  it("uses the ruler tracker's live pixelsPerCm instead of the static calibration when rulerTracking is enabled", async () => {
    const rulerRoi = { x: 0, y: 0, width: 20, height: 300 };
    const rulerSpacingPx = 20; // ruler-derived pixelsPerCm = 20 (cmPerTick = 1)
    const edgeY = 120;

    const video = createMockVideo({ videoWidth: 60, videoHeight: 300, duration: 1 });
    const canvas = createMockCanvasForRulerTest(60, 300, rulerRoi, rulerSpacingPx, edgeY);

    // Deliberately wrong/stale — must be ignored once ruler tracking is active.
    const staleCalibration: CalibrationData = {
      point1: { x: 0, y: 0 },
      point2: { x: 0, y: 100 },
      knownDistanceCm: 10,
      pixelsPerCm: 10,
    };

    const rulerCalibration: RulerCalibration = {
      point1: { x: 10, y: 0, valueCm: 0 },
      point2: { x: 10, y: 200, valueCm: 10 }, // 200px / 10cm = 20 px/cm, matches the ticks
      roi: rulerRoi,
    };

    const point: MeasurementPoint = {
      id: "p1",
      xColumn: 999, // ignored once ruler tracking is active
      label: "Point 1",
      color: "#3b82f6",
      baselineY: null,
      baselineValueCm: 5, // -> baselineY = 0 + (5 - 0) * 20 = 100
      xOffsetCm: 1.5, // -> currentXColumn = rulerCenterX(10) + 1.5 * 20 = 40
    };

    const result = await processVideo(video, canvas, staleCalibration, {
      points: [point],
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
      rulerTracking: {
        calibration: rulerCalibration,
        cmPerTick: 1,
        checkIntervalFrames: 1,
        maxFitError: 5,
      },
    });

    expect(result.p1.length).toBe(10);

    // edge at y=120, baseline at y=100 -> elevationCm = (100-120)/20 = -1.0
    // using the ruler's scale (allowing a little slack for normal tick-fit
    // noise). The stale static calibration (pixelsPerCm=10) would instead
    // give exactly -2.0, which this also rules out.
    for (const sample of result.p1) {
      expect(Math.abs(sample.elevationCm - -1.0)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(sample.elevationCm - -2.0)).toBeGreaterThan(0.5);
    }
  });
});
