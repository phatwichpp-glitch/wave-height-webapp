import type { CalibrationData, MeasurementPoint, RulerCalibration, WaveDataPoint } from "@/types/wave";
import { SurfaceTracker } from "@/lib/surfaceDetector";
import { RulerCalibrationTracker } from "@/lib/rulerTracker";
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
  color: string;
  baselineY: number;
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
   * soon as the camera's scale changes.
   */
  rulerTracking?: RulerTrackingOptions;
}

/** Clamped column-averaging bounds for a single column, shared by capture-time cropping and the worker's extraction. */
export function getColumnCropBounds(
  x: number,
  columnWidth: number,
  imageWidth: number
): { xMin: number; xMax: number; xRelative: number } {
  const halfWidth = Math.floor(columnWidth / 2);
  const xMin = Math.max(0, x - halfWidth);
  const xMax = Math.min(imageWidth - 1, x + halfWidth);
  return { xMin, xMax, xRelative: x - xMin };
}

/**
 * Clamped crop bounds covering every column in `xColumns` at once, so a frame
 * with multiple measurement points only needs a single getImageData() call
 * instead of one per point. `relativeX[i]` is `xColumns[i]`'s position within
 * that combined crop.
 */
export function getMultiColumnCropBounds(
  xColumns: number[],
  columnWidth: number,
  imageWidth: number
): { xMin: number; xMax: number; relativeX: number[] } {
  const halfWidth = Math.floor(columnWidth / 2);
  const xMin = Math.max(0, Math.min(...xColumns) - halfWidth);
  const xMax = Math.min(imageWidth - 1, Math.max(...xColumns) + halfWidth);
  const relativeX = xColumns.map((x) => x - xMin);
  return { xMin, xMax, relativeX };
}

export function captureFrameAtTime(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeS: number,
  cropRegion?: { xMin: number; xMax: number }
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let settled = false;

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
          resolve(ctx.getImageData(xMin, 0, xMax - xMin + 1, canvas.height));
        } else {
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
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
      reject(new Error(`Timed out waiting for video to seek to ${timeS}s`));
    }, SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", handleSeeked);
    video.currentTime = timeS;
  });
}

/** Reads a region directly from a canvas that already has the current frame painted on it (via captureFrameAtTime), with no extra video seek needed. */
function captureRoiFromCanvas(
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
 * point whose baselineY is null. Done per point, independently, on the main
 * thread (cheap enough not to need worker offload) — still water level can
 * differ slightly between points along a flume, so each gets its own baseline
 * rather than sharing one. Not used when ruler tracking is active (see
 * processVideo) since a fixed-pixel baseline would go stale under zoom.
 */
async function computeAutoBaselines(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  points: MeasurementPoint[],
  columnWidth: number,
  searchMarginPx: number,
  smoothSigma: number,
  sampleRateHz: number
): Promise<Map<string, number>> {
  const baselines = new Map<string, number>();

  for (const point of points) {
    if (point.baselineY !== null) {
      baselines.set(point.id, point.baselineY);
      continue;
    }

    const cropBounds = getColumnCropBounds(point.xColumn, columnWidth, video.videoWidth);
    const tracker = new SurfaceTracker(
      cropBounds.xRelative,
      columnWidth,
      searchMarginPx,
      smoothSigma
    );
    const samples: number[] = [];

    for (let i = 0; i < BASELINE_SAMPLE_FRAMES; i++) {
      const t = i / sampleRateHz;
      if (t >= video.duration) {
        break;
      }
      const imageData = await captureFrameAtTime(video, canvas, t, cropBounds);
      const { yPosition } = tracker.detect(imageData);
      samples.push(yPosition);
    }

    if (samples.length === 0) {
      throw new Error(
        `Could not read any frames to compute an automatic baseline for point "${point.label}"`
      );
    }

    baselines.set(point.id, median(samples));
  }

  return baselines;
}

function requestFromWorker(
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
  const duration = video.duration;

  if (points.length === 0) {
    throw new Error("At least one measurement point is required");
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
    return activeRulerTracker ? activeRulerTracker.pixelXForOffset(point.xOffsetCm) : point.xColumn;
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
        sampleRateHz
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

    const totalFrames = Math.max(1, Math.floor(duration * sampleRateHz));

    for (let i = 0; i < totalFrames; i++) {
      if (options.isPausedRef) {
        await waitWhilePaused(options.isPausedRef);
      }

      const t = i / sampleRateHz;
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
        for (const point of points) {
          if (point.baselineValueCm !== null) {
            baselines.set(point.id, activeRulerTracker.valueCmToPixelY(point.baselineValueCm));
          }
        }
      }

      const pointRequests: PointRequest[] = points.map((point, idx) => {
        const lastY = lastYByPoint.get(point.id) ?? null;
        const searchRange: [number, number] | null =
          lastY === null ? null : [lastY - searchMarginPx, lastY + searchMarginPx];
        return { pointId: point.id, xColumnRelative: relativeX[idx], searchRange };
      });

      const responses = await requestFromWorker(
        worker,
        { imageData, points: pointRequests, columnWidth, smoothSigma },
        [imageData.data.buffer]
      );

      const pixelsPerCmNow = activeRulerTracker
        ? activeRulerTracker.getCurrentFit().pixelsPerCm
        : calibration.pixelsPerCm;

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
          timeS: t,
          elevationCm,
          confidence: response.confidence,
        });
        detections.push({
          pointId: response.pointId,
          xColumn: currentXColumn(point),
          yPosition: response.yPosition,
          confidence: response.confidence,
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
