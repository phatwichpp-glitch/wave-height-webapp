import type { CalibrationData, WaveDataPoint } from "@/types/wave";
import { SurfaceTracker } from "@/lib/surfaceDetector";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/workers/videoProcessing.worker";

const SEEK_TIMEOUT_MS = 3000;
const BASELINE_SAMPLE_FRAMES = 30;

export interface ProcessingOptions {
  xColumn: number;
  columnWidth: number;
  searchMarginPx: number;
  smoothSigma: number;
  baselineY: number | null;
  sampleRateHz: number;
  onProgress?: (percent: number) => void;
}

/** Clamped column-averaging bounds, shared by capture-time cropping and the worker's extraction. */
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

export function captureFrameAtTime(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeS: number,
  cropColumn?: { x: number; columnWidth: number }
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

        if (cropColumn) {
          // Only read the narrow band around the measured column instead of
          // the whole frame, to avoid allocating a full-frame buffer per frame.
          const { xMin, xMax } = getColumnCropBounds(
            cropColumn.x,
            cropColumn.columnWidth,
            canvas.width
          );
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function computeAutoBaseline(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  xColumn: number,
  columnWidth: number,
  searchMarginPx: number,
  smoothSigma: number,
  sampleRateHz: number
): Promise<number> {
  const { xRelative } = getColumnCropBounds(xColumn, columnWidth, video.videoWidth);
  const tracker = new SurfaceTracker(xRelative, columnWidth, searchMarginPx, smoothSigma);
  const samples: number[] = [];

  for (let i = 0; i < BASELINE_SAMPLE_FRAMES; i++) {
    const t = i / sampleRateHz;
    if (t >= video.duration) {
      break;
    }
    const imageData = await captureFrameAtTime(video, canvas, t, {
      x: xColumn,
      columnWidth,
    });
    const { yPosition } = tracker.detect(imageData);
    samples.push(yPosition);
  }

  if (samples.length === 0) {
    throw new Error("Could not read any frames to compute an automatic baseline");
  }

  return median(samples);
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
): Promise<WaveDataPoint[]> {
  const { xColumn, columnWidth, searchMarginPx, smoothSigma, sampleRateHz } = options;
  const duration = video.duration;

  const baselineY =
    options.baselineY ??
    (await computeAutoBaseline(
      video,
      canvas,
      xColumn,
      columnWidth,
      searchMarginPx,
      smoothSigma,
      sampleRateHz
    ));

  const { xRelative } = getColumnCropBounds(xColumn, columnWidth, video.videoWidth);

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
    const dataPoints: WaveDataPoint[] = [];
    // The worker is stateless — see the comment in videoProcessing.worker.ts for
    // why tracking state (lastY / searchRange) lives here instead.
    let lastY: number | null = null;

    const totalFrames = Math.max(1, Math.floor(duration * sampleRateHz));

    for (let i = 0; i < totalFrames; i++) {
      const t = i / sampleRateHz;
      if (t >= duration) {
        break;
      }

      const imageData = await captureFrameAtTime(video, canvas, t, {
        x: xColumn,
        columnWidth,
      });

      const searchRange: [number, number] | null =
        lastY === null ? null : [lastY - searchMarginPx, lastY + searchMarginPx];

      const response = await requestFromWorker(
        worker,
        {
          imageData,
          xColumnRelative: xRelative,
          columnWidth,
          searchRange,
          smoothSigma,
        },
        [imageData.data.buffer]
      );

      lastY = response.yPosition;

      const elevationCm = (baselineY - response.yPosition) / calibration.pixelsPerCm;
      dataPoints.push({ timeS: t, elevationCm, confidence: response.confidence });

      options.onProgress?.(((i + 1) / totalFrames) * 100);
    }

    return dataPoints;
  } finally {
    worker.terminate();
  }
}
