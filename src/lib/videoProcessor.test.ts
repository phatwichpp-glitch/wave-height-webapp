import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureFrameAtTime, processVideo } from "./videoProcessor";
import { extractColumnProfile, findSurfaceEdge } from "./surfaceDetector";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/workers/videoProcessing.worker";
import type { CalibrationData } from "@/types/wave";

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

// Stand-in for the real Worker: runs the exact same extractColumnProfile +
// findSurfaceEdge logic the real videoProcessing.worker.ts uses, so
// processVideo's orchestration (looping, progress, elevation conversion) can
// be tested without a real browser Worker/postMessage implementation (neither
// Node nor jsdom implements Web Workers).
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
    const profile = extractColumnProfile(
      message.imageData,
      message.xColumnRelative,
      message.columnWidth
    );
    const result = findSurfaceEdge(profile, message.searchRange, message.smoothSigma);

    queueMicrotask(() => {
      this.messageHandlers.forEach((handler) =>
        handler({ data: result } as MessageEvent<WorkerResponseMessage>)
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

  it("produces one data point per sampled frame and reports progress to completion", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    const canvas = createMockCanvas(100, 200);
    const progressValues: number[] = [];

    const result = await processVideo(video, canvas, calibration, {
      xColumn: 50,
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      baselineY: 100,
      sampleRateHz: 10,
      onProgress: (percent) => progressValues.push(percent),
    });

    expect(result.length).toBe(10); // duration=1s * sampleRateHz=10
    expect(progressValues.length).toBe(10);
    expect(progressValues[progressValues.length - 1]).toBeCloseTo(100);

    for (const point of result) {
      expect(typeof point.timeS).toBe("number");
      expect(typeof point.elevationCm).toBe("number");
      expect(typeof point.confidence).toBe("number");
    }
  });

  it("auto-computes a baseline from the first frames when baselineY is null", async () => {
    const video = createMockVideo({ videoWidth: 100, videoHeight: 200, duration: 1 });
    const canvas = createMockCanvas(100, 200);

    const result = await processVideo(video, canvas, calibration, {
      xColumn: 50,
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      baselineY: null,
      sampleRateHz: 10,
    });

    expect(result.length).toBe(10);
  });
});
