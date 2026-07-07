import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supportsVideoFrameCallback, processVideoWithFrameCallback } from "./frameCallbackProcessor";
import { extractColumnProfile, findSurfaceEdge } from "./surfaceDetector";
import type {
  PointRequest,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/workers/videoProcessing.worker";
import type { CalibrationData, MeasurementPoint } from "@/types/wave";

describe("supportsVideoFrameCallback", () => {
  const originalHTMLVideoElement = (globalThis as Record<string, unknown>).HTMLVideoElement;

  afterEach(() => {
    (globalThis as Record<string, unknown>).HTMLVideoElement = originalHTMLVideoElement;
  });

  it("returns true when HTMLVideoElement.prototype has requestVideoFrameCallback", () => {
    class FakeHTMLVideoElement {
      requestVideoFrameCallback() {
        return 1;
      }
    }
    (globalThis as Record<string, unknown>).HTMLVideoElement = FakeHTMLVideoElement;

    expect(supportsVideoFrameCallback()).toBe(true);
  });

  it("returns false when the method is missing from the prototype", () => {
    class FakeHTMLVideoElement {}
    (globalThis as Record<string, unknown>).HTMLVideoElement = FakeHTMLVideoElement;

    expect(supportsVideoFrameCallback()).toBe(false);
  });

  it("returns false when HTMLVideoElement doesn't exist at all (e.g. non-browser environment)", () => {
    (globalThis as Record<string, unknown>).HTMLVideoElement = undefined;

    expect(supportsVideoFrameCallback()).toBe(false);
  });
});

// --- Mocks for processVideoWithFrameCallback ---
//
// requestVideoFrameCallback's real timing is driven by the browser's video
// compositor — there is no meaningful way to simulate genuine decode/composite
// timing in jsdom/Node, so (per this phase's own guidance) that part is not
// tested here. What *is* fully mockable and worth testing thoroughly is the
// orchestration this file is actually responsible for: capturing a frame,
// queuing it with everything ruler-drift-dependent snapshotted, feeding the
// queue to the worker in order, computing elevation, detecting completion,
// and reducing playbackRate under queue backpressure. The mock's
// requestVideoFrameCallback stores the callback and does nothing on its own —
// the test fires it explicitly, standing in for "the browser decoded a frame".

type Listener = () => void;

function createMockVideoForFrameCallback(options: {
  videoWidth: number;
  videoHeight: number;
  duration: number;
}) {
  const listeners: Record<string, Listener[]> = {};
  let currentTimeValue = 0;
  let playbackRateValue = 1;
  let pausedValue = true;
  let pendingCallback: VideoFrameRequestCallback | null = null;

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
    readyState: 2, // HAVE_CURRENT_DATA — lets captureFrameAtTime's fast path resolve immediately
    get currentTime() {
      return currentTimeValue;
    },
    set currentTime(value: number) {
      currentTimeValue = value;
      queueMicrotask(() => (listeners["seeked"] ?? []).forEach((h) => h()));
    },
    get playbackRate() {
      return playbackRateValue;
    },
    set playbackRate(value: number) {
      playbackRateValue = value;
    },
    get paused() {
      return pausedValue;
    },
    play() {
      pausedValue = false;
      return Promise.resolve();
    },
    pause() {
      pausedValue = true;
    },
    requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
      pendingCallback = callback;
      return 1;
    },
    cancelVideoFrameCallback() {
      pendingCallback = null;
    },
  };

  return {
    video: video as unknown as HTMLVideoElement,
    fireFrame(mediaTime: number) {
      const callback = pendingCallback;
      pendingCallback = null;
      callback?.(0, { mediaTime } as VideoFrameCallbackMetadata);
    },
    /** Simulates the browser reaching the natural end of playback: pauses on its own and fires 'ended' — *without* one final rVFC callback reporting mediaTime >= duration (real browsers don't guarantee one). */
    fireEnded() {
      pausedValue = true;
      (listeners["ended"] ?? []).forEach((h) => h());
    },
    hasPendingFrame: () => pendingCallback !== null,
    getPlaybackRate: () => playbackRateValue,
    isPaused: () => pausedValue,
  };
}

/** A canvas whose getImageData reflects a single caller-controlled edge position — standing in for "whatever the video currently shows" without needing real decoded video content. */
function createMockCanvasWithControllableEdge(
  width: number,
  height: number,
  getEdgeY: () => number
) {
  let canvasWidth = width;
  let canvasHeight = height;

  const ctx = {
    drawImage() {
      /* no-op */
    },
    getImageData(_x: number, _y: number, w: number, h: number): ImageData {
      const edgeY = getEdgeY();
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        const value = row < edgeY ? 200 : 80;
        for (let col = 0; col < w; col++) {
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

// Same role as videoProcessor.test.ts's MockWorker: runs the real
// extractColumnProfile + findSurfaceEdge logic the actual worker uses, so the
// queue/consumer loop can be exercised without a real Worker/postMessage.
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
      const profile = extractColumnProfile(message.imageData, point.xColumnRelative, message.columnWidth);
      const { yPosition, confidence, lowConfidence } = findSurfaceEdge(profile, point.searchRange, message.smoothSigma);
      return { pointId: point.pointId, yPosition, confidence, lowConfidence };
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

function flushAsync(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("processVideoWithFrameCallback", () => {
  const calibration: CalibrationData = {
    point1: { x: 0, y: 0 },
    point2: { x: 0, y: 100 },
    knownDistanceCm: 10,
    pixelsPerCm: 10,
  };
  const points: MeasurementPoint[] = [
    {
      id: "p1",
      xColumn: 50,
      label: "Point 1",
      color: "#3b82f6",
      baselineY: 100, // fixed: skips auto-baseline's own seek-based sampling
      baselineValueCm: null,
      xOffsetCm: 0,
      initialGuessPixelY: 100,
      initialSearchMarginPx: null,
    },
  ];

  const originalHTMLVideoElement = (globalThis as Record<string, unknown>).HTMLVideoElement;

  beforeEach(() => {
    vi.stubGlobal("Worker", MockWorker);
    // This test file's vitest project runs under a plain "node" environment
    // (see vitest.config.ts), which has no HTMLVideoElement global at all —
    // stub one with the method present so supportsVideoFrameCallback()'s
    // feature check (used internally as a guard) passes for these tests.
    class FakeHTMLVideoElementWithSupport {
      requestVideoFrameCallback() {
        return 1;
      }
    }
    (globalThis as Record<string, unknown>).HTMLVideoElement = FakeHTMLVideoElementWithSupport;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (globalThis as Record<string, unknown>).HTMLVideoElement = originalHTMLVideoElement;
  });

  it("captures frames as they're delivered via rVFC, computes elevation via the worker, and stops at duration", async () => {
    const { video, fireFrame } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 1,
    });
    let edgeY = 100;
    const canvas = createMockCanvasWithControllableEdge(100, 200, () => edgeY);

    const resultPromise = processVideoWithFrameCallback(video, canvas, calibration, points, {
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10, // sets the 1/10s throttle interval between captured frames
    });

    await flushAsync(); // let setup (baseline skip, initial seek, video.play()) settle

    edgeY = 100; // at baseline -> elevation ~0
    fireFrame(0.1); // on the 1/10s sample grid -> captured
    await flushAsync();

    edgeY = 80; // 20px above baseline -> elevation = (100-80)/10 = 2cm
    fireFrame(0.2); // also on-grid -> captured
    await flushAsync();

    fireFrame(1); // mediaTime >= duration -> signals completion, no further capture

    const result = await resultPromise;

    expect(result.p1.length).toBe(2);
    expect(result.p1[0].timeS).toBeCloseTo(0.1);
    expect(Math.abs(result.p1[0].elevationCm)).toBeLessThanOrEqual(0.5);
    expect(result.p1[1].timeS).toBeCloseTo(0.2);
    expect(result.p1[1].elevationCm).toBeCloseTo(2, 0);
    expect(video.paused).toBe(true);
  });

  it("does not lock onto a strong decoy edge on the first frame — bounded by the point's initialGuessPixelY, matching processVideo's identical fix (Phase 16)", async () => {
    const { video, fireFrame } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 1,
    });
    const decoyEdgeY = 20;
    const realEdgeY = 150;
    const canvas = {
      getContext() {
        return {
          drawImage() {
            /* no-op */
          },
          getImageData(_x: number, _y: number, w: number, h: number): ImageData {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let row = 0; row < h; row++) {
              const value = row < decoyEdgeY ? 50 : row < realEdgeY ? 250 : 200;
              for (let col = 0; col < w; col++) {
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
      },
      width: 100,
      height: 200,
    } as unknown as HTMLCanvasElement;

    const pointsWithSeed: MeasurementPoint[] = [
      { ...points[0], baselineY: realEdgeY, initialGuessPixelY: realEdgeY },
    ];

    const resultPromise = processVideoWithFrameCallback(video, canvas, calibration, pointsWithSeed, {
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
    });
    await flushAsync();

    fireFrame(0.1);
    await flushAsync();
    fireFrame(1); // >= duration -> completion

    const result = await resultPromise;

    expect(result.p1.length).toBe(1);
    // Real edge is constant at 150, seeded baseline is also 150 -> elevation
    // near zero. A decoy lock at y=20 would produce a huge, obviously wrong offset.
    expect(Math.abs(result.p1[0].elevationCm)).toBeLessThanOrEqual(2);
  });

  it("skips decoded frames arriving faster than 1/sampleRateHz instead of capturing every one (regression: capturing every decoded frame made this mode slower than seek-based for short clips)", async () => {
    const { video, fireFrame } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 10,
    });
    const canvas = createMockCanvasWithControllableEdge(100, 200, () => 100);

    const resultPromise = processVideoWithFrameCallback(video, canvas, calibration, points, {
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10, // 1 sample per 0.1s
    });
    await flushAsync();

    // Simulate a decoder delivering frames far denser than the 0.1s grid
    // (e.g. a 30fps source): only the first frame at/after each tick should
    // be captured, not all of them.
    const decodedTimes = [0.01, 0.03, 0.06, 0.1, 0.12, 0.15, 0.18, 0.21, 0.24, 0.27, 0.3];
    for (const t of decodedTimes) {
      fireFrame(t);
      await flushAsync(5);
    }
    await flushAsync(50);
    fireFrame(10); // end capture

    const result = await resultPromise;

    // Grid ticks at 0.1, 0.2, 0.3 -> exactly 3 captured, not all 11 decoded.
    expect(result.p1.length).toBe(3);
  });

  it("completes when the video reaches 'ended' naturally, even with no final onFrame callback reporting mediaTime >= duration (regression: real playback ending doesn't guarantee one more rVFC callback)", async () => {
    const { video, fireFrame, fireEnded } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 1,
    });
    const canvas = createMockCanvasWithControllableEdge(100, 200, () => 100);

    const resultPromise = processVideoWithFrameCallback(video, canvas, calibration, points, {
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
    });
    await flushAsync();

    fireFrame(0.1);
    await flushAsync();
    fireFrame(0.9); // last decoded frame is still < duration (1) — never reports "done"

    await flushAsync();
    fireEnded(); // browser reaches end of media on its own and just stops

    const result = await Promise.race([
      resultPromise,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);

    expect(result).not.toBe("timeout");
    expect((result as Record<string, unknown[]>).p1.length).toBe(2);
  });

  it("halves playbackRate once the queue exceeds maxQueueSize, to let the worker catch up", async () => {
    const { video, fireFrame } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 100, // long enough that none of the driven frames reach it
    });
    const canvas = createMockCanvasWithControllableEdge(100, 200, () => 100);

    const resultPromise = processVideoWithFrameCallback(video, canvas, calibration, points, {
      columnWidth: 3,
      searchMarginPx: 40,
      smoothSigma: 2.0,
      sampleRateHz: 10,
      playbackRate: 4,
      maxQueueSize: 3,
    });

    await flushAsync();

    const initialPlaybackRate = video.playbackRate;
    expect(initialPlaybackRate).toBe(4);

    // Fire more frames back-to-back than maxQueueSize, synchronously (no
    // await between them) so the consumer loop has no chance to drain any
    // of them first — this deterministically forces the queue past the cap.
    for (let i = 1; i <= 5; i++) {
      fireFrame(i * 0.1);
    }

    expect(video.playbackRate).toBeLessThan(initialPlaybackRate);

    // Let the backlog drain, then end the run cleanly.
    await flushAsync(100);
    fireFrame(100);
    await resultPromise;
  });

  it("throws when the browser doesn't support requestVideoFrameCallback", async () => {
    class FakeHTMLVideoElementWithoutSupport {}
    (globalThis as Record<string, unknown>).HTMLVideoElement = FakeHTMLVideoElementWithoutSupport;

    const { video } = createMockVideoForFrameCallback({
      videoWidth: 100,
      videoHeight: 200,
      duration: 10,
    });
    const canvas = createMockCanvasWithControllableEdge(100, 200, () => 100);

    await expect(
      processVideoWithFrameCallback(video, canvas, calibration, points, {
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        sampleRateHz: 10,
      })
    ).rejects.toThrow(/does not support/i);
  });
});
