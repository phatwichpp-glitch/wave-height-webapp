import type { CalibrationData, MeasurementPoint, RulerCalibration, WaveDataPoint } from "@/types/wave";
import { SurfaceTracker, DEFAULT_INITIAL_SEARCH_MARGIN_PX } from "@/lib/surfaceDetector";
import { RulerCalibrationTracker } from "@/lib/rulerTracker";
import { resampleToUniformGrid } from "@/lib/resample";
import type {
  PointRequest,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/workers/videoProcessing.worker";

const SEEK_TIMEOUT_MS = 3000;
const BASELINE_SAMPLE_FRAMES = 30;

export interface DetectionResult {
  pointId: string;
  xColumn: number;
  yPosition: number;
  confidence: number;
  lowConfidence: boolean;
  color: string;
  baselineY: number;
}

/** A point's per-frame first-frame search range: bounded around its clicked initialGuessPixelY rather than the whole column, so tracking can't lock onto an unrelated high-contrast object elsewhere in frame (Phase 16). Exported for reuse by frameCallbackProcessor.ts's identical first-frame logic. */
export function initialSearchRangeFor(point: MeasurementPoint): [number, number] {
  const margin = point.initialSearchMarginPx ?? DEFAULT_INITIAL_SEARCH_MARGIN_PX;
  return [point.initialGuessPixelY - margin, point.initialGuessPixelY + margin];
}

export interface RulerTrackingOptions {
  calibration: RulerCalibration;
  cmPerTick: number;
  checkIntervalFrames?: number;
  maxFitError?: number;
}

export interface ProcessingOptions {
  points: MeasurementPoint[];
  columnWidth: number;
  searchMarginPx: number;
  smoothSigma: number;
  sampleRateHz: number;
  /**
   * Absolute video time (seconds) to start analysis from — everything before
   * it (typically the stretch where the camera is still being aimed/settled)
   * is skipped entirely, both for the main sampling loop and for auto-baseline
   * detection. Defaults to 0. The *output* WaveDataPoint.timeS is always
   * zero-based relative to this point (timeS=0 means "analysisStartTimeS
   * into the source video", not "the start of the file") so downstream
   * charts/statistics never need to know this offset existed.
   */
  analysisStartTimeS?: number;
  onProgress?: (percent: number) => void;
  /** Called after every frame is processed, with each point's live detection — for a real-time overlay. */
  onFrameProcessed?: (detections: DetectionResult[]) => void;
  /** Mutable flag the main loop polls before each frame; set .current = true to pause, false to resume. */
  isPausedRef?: { current: boolean };
  /** If set, awaits this many ms after each frame — for a slowed-down "debug" mode so a human can watch the overlay track the surface. */
  debugDelayMs?: number;
  /**
   * When set, re-reads the ruler's tick marks every few frames to continuously
   * correct for a handheld camera drifting and/or zooming, instead of trusting
   * a single fixed `calibration.pixelsPerCm` and each point's fixed xColumn for
   * the whole video. Every point must have `baselineValueCm` set (not just
   * `baselineY`) when this is used — a fixed-pixel baseline would go stale as
   * soon as the camera's scale changes. Note only vertical drift/zoom is
   * corrected: the ruler ROI and its center column are fixed in frame
   * coordinates, so sustained horizontal panning is not compensated.
   */
  rulerTracking?: RulerTrackingOptions;
  /** Called each time a ruler re-calibration check is rejected (fit error above maxFitError) and the previous calibration is kept — for surfacing a warning in the UI. */
  onRulerCheckFailed?: (fitErrorPx: number) => void;
}

/**
 * Clamped crop bounds covering every column in `xColumns` at once, so a frame
 * with multiple measurement points only needs a single getImageData() call
 * instead of one per point. `relativeX[i]` is `xColumns[i]`'s position within
 * that combined crop.
 *
 * Inputs are rounded to whole pixels first: ruler tracking produces fractional
 * column positions, but getImageData() truncates fractional origins and typed
 * arrays can't be indexed fractionally, so passing fractions through would
 * silently misalign (or NaN out) the extracted profiles.
 */
export function getMultiColumnCropBounds(
  xColumns: number[],
  columnWidth: number,
  imageWidth: number
): { xMin: number; xMax: number; relativeX: number[] } {
  const columns = xColumns.map((x) => Math.round(x));
  const halfWidth = Math.floor(columnWidth / 2);
  const xMin = Math.max(0, Math.min(...columns) - halfWidth);
  const xMax = Math.min(imageWidth - 1, Math.max(...columns) + halfWidth);
  const relativeX = columns.map((x) => x - xMin);
  return { xMin, xMax, relativeX };
}

// HTMLMediaElement.HAVE_CURRENT_DATA — written as a literal because the lib
// unit tests run under Node, where the HTMLMediaElement global doesn't exist.
const HAVE_CURRENT_DATA = 2;

export function captureFrameAtTime(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeS: number,
  cropRegion?: { xMin: number; xMax: number }
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let settled = false;

    function drawAndRead(): ImageData {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not get a 2D rendering context from the canvas");
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (cropRegion) {
        // Only read the narrow band covering the measured column(s) instead
        // of the whole frame, to avoid allocating a full-frame buffer per frame.
        const { xMin, xMax } = cropRegion;
        return ctx.getImageData(xMin, 0, xMax - xMin + 1, canvas.height);
      }
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    // Already positioned at the requested time with a decodable frame: read it
    // directly. Some browsers (notably Safari) never fire 'seeked' for a seek
    // to the current position, which would otherwise stall into the timeout.
    if (
      video.readyState >= HAVE_CURRENT_DATA &&
      Math.abs(video.currentTime - timeS) < 1e-6
    ) {
      try {
        resolve(drawAndRead());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    function cleanup() {
      clearTimeout(timeoutId);
      video.removeEventListener("seeked", handleSeeked);
    }

    function handleSeeked() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      try {
        resolve(drawAndRead());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      // 'seeked' never fired for some reason we didn't anticipate — rather
      // than fail the whole run, fall back to whatever frame the video is
      // currently showing. It may be a frame or two off, but that's a far
      // better outcome than aborting processing entirely (Phase 13).
      try {
        console.warn(
          `Timed out waiting for 'seeked' at ${timeS}s — using the video's current frame as a fallback.`
        );
        resolve(drawAndRead());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", handleSeeked);
    video.currentTime = timeS;
  });
}

/** Reads a region directly from a canvas that already has the current frame painted on it (via captureFrameAtTime), with no extra video seek needed. */
export function captureRoiFromCanvas(
  canvas: HTMLCanvasElement,
  roi: { x: number; y: number; width: number; height: number }
): ImageData {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D rendering context from the canvas");
  }
  return ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
}

async function waitWhilePaused(isPausedRef: { current: boolean }): Promise<void> {
  while (isPausedRef.current) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Auto-detects a baseline (median y over the first ~30 frames) for every
 * point whose baselineY is null. Each point still gets its own baseline
 * (still water level can differ slightly between points along a flume), but
 * every sampled frame is captured once — one seek + one getImageData covering
 * all pending columns — rather than re-seeking the same 30 frames per point.
 * Runs on the main thread (cheap enough not to need worker offload). Not used
 * when ruler tracking is active (see processVideo) since a fixed-pixel
 * baseline would go stale under zoom. Exported for reuse by
 * frameCallbackProcessor.ts, which needs the identical baseline behavior
 * before switching into its own (playback-driven) main capture loop.
 */
export async function computeAutoBaselines(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  points: MeasurementPoint[],
  columnWidth: number,
  searchMarginPx: number,
  smoothSigma: number,
  sampleRateHz: number,
  analysisStartTimeS: number
): Promise<Map<string, number>> {
  const baselines = new Map<string, number>();
  const pending: MeasurementPoint[] = [];

  for (const point of points) {
    if (point.baselineY !== null) {
      baselines.set(point.id, point.baselineY);
    } else {
      pending.push(point);
    }
  }

  if (pending.length === 0) {
    return baselines;
  }

  const { xMin, xMax, relativeX } = getMultiColumnCropBounds(
    pending.map((point) => point.xColumn),
    columnWidth,
    video.videoWidth
  );
  const trackers = pending.map(
    (point, i) =>
      new SurfaceTracker(
        relativeX[i],
        point.initialGuessPixelY,
        columnWidth,
        searchMarginPx,
        smoothSigma,
        point.initialSearchMarginPx ?? DEFAULT_INITIAL_SEARCH_MARGIN_PX
      )
  );
  const samplesByPoint = new Map<string, number[]>(pending.map((point) => [point.id, []]));

  for (let i = 0; i < BASELINE_SAMPLE_FRAMES; i++) {
    const t = analysisStartTimeS + i / sampleRateHz;
    if (t >= video.duration) {
      break;
    }
    const imageData = await captureFrameAtTime(video, canvas, t, { xMin, xMax });
    pending.forEach((point, k) => {
      const { yPosition } = trackers[k].detect(imageData);
      samplesByPoint.get(point.id)!.push(yPosition);
    });
  }

  for (const point of pending) {
    const samples = samplesByPoint.get(point.id)!;
    if (samples.length === 0) {
      throw new Error(
        `Could not read any frames to compute an automatic baseline for point "${point.label}"`
      );
    }
    baselines.set(point.id, median(samples));
  }

  return baselines;
}

/** Exported for reuse by frameCallbackProcessor.ts's worker-consumer loop — identical request/response contract, just fed by a queue instead of a synchronous seek loop. */
export function requestFromWorker(
  worker: Worker,
  message: WorkerRequestMessage,
  transfer: Transferable[]
): Promise<WorkerResponseMessage> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    }
    function handleMessage(event: MessageEvent<WorkerResponseMessage>) {
      cleanup();
      resolve(event.data);
    }
    function handleError(event: ErrorEvent) {
      cleanup();
      reject(new Error(event.message));
    }

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage(message, transfer);
  });
}

export async function processVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: CalibrationData,
  options: ProcessingOptions
): Promise<Record<string, WaveDataPoint[]>> {
  const { points, columnWidth, searchMarginPx, smoothSigma, sampleRateHz } = options;
  const analysisStartTimeS = options.analysisStartTimeS ?? 0;
  const duration = video.duration;

  if (points.length === 0) {
    throw new Error("At least one measurement point is required");
  }

  if (analysisStartTimeS >= duration) {
    throw new Error(
      `analysisStartTimeS (${analysisStartTimeS}s) must be before the video ends (${duration}s)`
    );
  }

  let rulerTracker: RulerCalibrationTracker | null = null;
  if (options.rulerTracking) {
    const { calibration: rulerCalibration, cmPerTick, checkIntervalFrames, maxFitError } =
      options.rulerTracking;

    for (const point of points) {
      if (point.baselineValueCm === null) {
        throw new Error(
          `Point "${point.label}" needs baselineValueCm set when ruler-based re-calibration ` +
            "is enabled — a fixed pixel baseline would go stale as the camera's scale changes."
        );
      }
    }

    rulerTracker = new RulerCalibrationTracker(
      rulerCalibration,
      cmPerTick,
      checkIntervalFrames,
      maxFitError
    );
  }

  const activeRulerTracker = rulerTracker;

  function currentXColumn(point: MeasurementPoint): number {
    const x = activeRulerTracker
      ? activeRulerTracker.pixelXForOffset(point.xOffsetCm)
      : point.xColumn;
    // Ruler tracking yields fractional pixel positions, and a drifting camera
    // can push a point past the frame edge — snap to the nearest valid column
    // so profile extraction always reads real pixels.
    return Math.min(video.videoWidth - 1, Math.max(0, Math.round(x)));
  }

  const baselines = activeRulerTracker
    ? new Map(
        points.map((p) => [
          p.id,
          activeRulerTracker.valueCmToPixelY(p.baselineValueCm as number),
        ])
      )
    : await computeAutoBaselines(
        video,
        canvas,
        points,
        columnWidth,
        searchMarginPx,
        smoothSigma,
        sampleRateHz,
        analysisStartTimeS
      );

  // Turbopack's special-case static analysis for `new Worker(new URL(...))`
  // (which bundles+transpiles the target as a worker entry point, instead of
  // treating it as a generic static asset) only kicks in for a relative path
  // literal with an explicit extension — a "@/..." alias here silently falls
  // back to copying the raw, untranspiled .ts file as a static asset instead.
  const worker = new Worker(
    new URL("../workers/videoProcessing.worker.ts", import.meta.url),
    { type: "module" }
  );

  try {
    const result: Record<string, WaveDataPoint[]> = {};
    const lastYByPoint = new Map<string, number | null>();
    for (const point of points) {
      result[point.id] = [];
      lastYByPoint.set(point.id, null);
    }

    const totalFrames = Math.max(1, Math.floor((duration - analysisStartTimeS) * sampleRateHz));

    for (let i = 0; i < totalFrames; i++) {
      if (options.isPausedRef) {
        await waitWhilePaused(options.isPausedRef);
      }

      // relativeT is what gets reported (WaveDataPoint.timeS): zero-based
      // from analysisStartTimeS, so charts/statistics never need to know an
      // offset existed. t is the actual absolute video time to seek to.
      const relativeT = i / sampleRateHz;
      const t = analysisStartTimeS + relativeT;
      if (t >= duration) {
        break;
      }

      // Recomputed fresh every frame from each point's *current* column —
      // under ruler tracking that column can drift/zoom over time, so a
      // one-time-only crop computed before the loop could stop covering it.
      const { xMin, xMax, relativeX } = getMultiColumnCropBounds(
        points.map((point) => currentXColumn(point)),
        columnWidth,
        video.videoWidth
      );

      const imageData = await captureFrameAtTime(video, canvas, t, { xMin, xMax });

      if (activeRulerTracker && activeRulerTracker.shouldCheck()) {
        const roiImageData = captureRoiFromCanvas(
          canvas,
          options.rulerTracking!.calibration.roi
        );
        activeRulerTracker.update(roiImageData);
        if (activeRulerTracker.lastUpdateSkipped) {
          options.onRulerCheckFailed?.(activeRulerTracker.lastSkippedFitError);
        }
        for (const point of points) {
          if (point.baselineValueCm !== null) {
            baselines.set(point.id, activeRulerTracker.valueCmToPixelY(point.baselineValueCm));
          }
        }
      }

      const pointRequests: PointRequest[] = points.map((point, idx) => {
        const lastY = lastYByPoint.get(point.id) ?? null;
        // First frame (no prior lock): search only a bounded margin around
        // where the user clicked, never the whole column — an unbounded
        // search here is what let tracking lock onto an unrelated
        // high-contrast object (a ruler tick, a phone edge, a window frame)
        // instead of the real water surface (Phase 16 fix).
        const searchRange: [number, number] =
          lastY === null
            ? initialSearchRangeFor(point)
            : [lastY - searchMarginPx, lastY + searchMarginPx];
        return { pointId: point.id, xColumnRelative: relativeX[idx], searchRange };
      });

      const responses = await requestFromWorker(
        worker,
        { imageData, points: pointRequests, columnWidth, smoothSigma },
        [imageData.data.buffer]
      );

      // The ruler fit's pixelsPerCm is signed (negative when the ruler's
      // printed values increase upward in the frame — the usual mounting for a
      // water-level staff gauge). Elevation below is defined as up-positive in
      // *pixel* space, so only the magnitude of the scale applies; using the
      // signed value would flip the whole elevation time series.
      const pixelsPerCmNow = Math.abs(
        activeRulerTracker
          ? activeRulerTracker.getCurrentFit().pixelsPerCm
          : calibration.pixelsPerCm
      );

      const detections: DetectionResult[] = [];

      for (const response of responses) {
        lastYByPoint.set(response.pointId, response.yPosition);
        const point = points.find((p) => p.id === response.pointId);
        const baselineY = baselines.get(response.pointId);
        if (baselineY === undefined || !point) {
          continue;
        }
        const elevationCm = (baselineY - response.yPosition) / pixelsPerCmNow;
        result[response.pointId].push({
          timeS: relativeT,
          elevationCm,
          confidence: response.confidence,
        });
        detections.push({
          pointId: response.pointId,
          xColumn: currentXColumn(point),
          yPosition: response.yPosition,
          confidence: response.confidence,
          lowConfidence: response.lowConfidence,
          color: point.color,
          baselineY,
        });
      }

      options.onFrameProcessed?.(detections);
      options.onProgress?.(((i + 1) / totalFrames) * 100);

      if (options.debugDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.debugDelayMs));
      }
    }

    return result;
  } finally {
    worker.terminate();
  }
}

export type ProcessingMode = "auto" | "seek-based" | "frame-callback";

/**
 * Single entry point that picks between the two processing implementations:
 * seek-based (processVideo, above — universally compatible, seeks one frame
 * at a time) and frame-callback (processVideoWithFrameCallback,
 * frameCallbackProcessor.ts — much faster, but only works in browsers
 * supporting requestVideoFrameCallback, and produces irregularly-timed
 * samples that need resampling onto a uniform grid before they match
 * seek-based output's contract).
 *
 * Imports frameCallbackProcessor.ts, which itself imports several helpers
 * back from this file — a circular import, but a safe one here: every
 * reference on both sides is only ever used inside function bodies invoked
 * later, never at module-evaluation time, so both modules finish
 * initializing their exports before anything actually calls across the cycle.
 */
export async function processVideoAuto(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: CalibrationData,
  points: MeasurementPoint[],
  options: Omit<ProcessingOptions, "points"> & { mode?: ProcessingMode; playbackRate?: number }
): Promise<Record<string, WaveDataPoint[]>> {
  const { mode = "auto", playbackRate, ...restOptions } = options;
  // processVideo (seek-based) still expects `points` bundled into its
  // options object — re-inject it here since processVideoAuto's own
  // signature (matching processVideoWithFrameCallback) takes it separately.
  const processingOptions: ProcessingOptions = { ...restOptions, points };

  // Dynamic import instead of a static one: this file (videoProcessor.ts) is
  // also imported by plain seek-based-only call sites (e.g. Phase 3-9's
  // existing usage) that never need frame-callback support at all — pulling
  // it in unconditionally would mean it's always bundled even when unused.
  const { processVideoWithFrameCallback, supportsVideoFrameCallback } = await import(
    "@/lib/frameCallbackProcessor"
  );

  async function runFrameCallback(): Promise<Record<string, WaveDataPoint[]>> {
    const rawResult = await processVideoWithFrameCallback(video, canvas, calibration, points, {
      ...processingOptions,
      playbackRate,
    });
    const durationS = video.duration - (options.analysisStartTimeS ?? 0);
    const resampled: Record<string, WaveDataPoint[]> = {};
    for (const point of points) {
      resampled[point.id] = resampleToUniformGrid(
        rawResult[point.id] ?? [],
        options.sampleRateHz,
        durationS
      );
    }
    return resampled;
  }

  if (mode === "seek-based") {
    return processVideo(video, canvas, calibration, processingOptions);
  }
  if (mode === "frame-callback") {
    return runFrameCallback();
  }

  // mode === "auto"
  if (supportsVideoFrameCallback()) {
    return runFrameCallback();
  }
  console.warn(
    "requestVideoFrameCallback is not supported in this browser — falling back to seek-based processing."
  );
  return processVideo(video, canvas, calibration, processingOptions);
}
