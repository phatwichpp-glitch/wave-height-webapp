import type { CalibrationData, MeasurementPoint, WaveDataPoint } from "@/types/wave";
import { RulerCalibrationTracker } from "@/lib/rulerTracker";
import {
  captureFrameAtTime,
  captureRoiFromCanvas,
  computeAutoBaselines,
  getMultiColumnCropBounds,
  initialSearchRangeFor,
  requestFromWorker,
  type DetectionResult,
  type ProcessingOptions,
} from "@/lib/videoProcessor";
import type { PointRequest } from "@/workers/videoProcessing.worker";

const DEFAULT_PLAYBACK_RATE = 4;
const DEFAULT_MAX_QUEUE_SIZE = 50;
// If the consumer can't keep the queue below maxQueueSize, halve playbackRate
// but never drop below this — much slower than this and the "fast mode"
// isn't earning its keep over the seek-based path anymore.
const MIN_AUTO_PLAYBACK_RATE = 0.5;
// How often (ms) to poll isPausedRef and translate it into real
// video.pause()/play() calls — rVFC is playback-driven, so pausing here
// means actually pausing the <video> element, unlike the seek-based loop's
// synchronous spin-wait.
const PAUSE_WATCHER_INTERVAL_MS = 100;

export function supportsVideoFrameCallback(): boolean {
  // Feature detection only — no browser allowlist/denylist, so this keeps
  // working correctly if/when other engines add support later.
  return (
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}

// Omits `points` (rather than `extends ProcessingOptions` directly): this
// function takes `points` as its own parameter (matching processVideo's
// sibling signature below), so requiring it again inside `options` would
// just be redundant/conflicting at the type level.
export type FrameCallbackOptions = Omit<ProcessingOptions, "points"> & {
  /** Video playback speed multiplier during capture. Default 4. Higher finishes faster but risks the browser dropping frames (sparser data) if it can't decode/composite fast enough. */
  playbackRate?: number;
  /** Caps how many captured-but-not-yet-worker-processed frames may queue up before playbackRate is automatically halved to let the worker catch up. Default 50. */
  maxQueueSize?: number;
};

/** Everything needed to compute one frame's elevation later, snapshotted at the moment it was captured — since ruler tracking can drift the relevant column/baseline/scale between capture and (queued, delayed) consumption. */
interface QueuedFrame {
  imageData: ImageData;
  /** Zero-based relative to analysisStartTimeS, matching WaveDataPoint.timeS's contract. */
  mediaTimeRelativeS: number;
  relativeXByPointId: Map<string, number>;
  xColumnByPointId: Map<string, number>;
  baselineYByPointId: Map<string, number>;
  pixelsPerCmNow: number;
}

function startPauseWatcher(
  video: HTMLVideoElement,
  isPausedRef: { current: boolean }
): () => void {
  // Only auto-resumes playback that *this* watcher itself paused — so a
  // natural end-of-video pause (captureDone) is never overridden.
  let pausedByWatcher = false;
  const intervalId = setInterval(() => {
    if (isPausedRef.current && !video.paused) {
      video.pause();
      pausedByWatcher = true;
    } else if (!isPausedRef.current && pausedByWatcher && video.paused) {
      pausedByWatcher = false;
      video.play();
    }
  }, PAUSE_WATCHER_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

/**
 * Alternative to processVideo() (videoProcessor.ts) that drives capture off
 * real video playback + requestVideoFrameCallback (rVFC) instead of
 * seeking to each sample time one at a time. rVFC only fires for frames the
 * browser has actually decoded and is about to composite, each with a
 * `metadata.mediaTime` timestamp — far cheaper than a seek+'seeked' round
 * trip per sample, at the cost of two things this function must handle:
 * timestamps land wherever the browser decoded a frame (irregular, not a
 * clean sampleRateHz grid — callers resample afterward, see resample.ts),
 * and capture can only run by actually playing the video, so pause/resume
 * means real video.pause()/play() rather than a spin-wait.
 *
 * Deliberately takes the same CalibrationData + optional ProcessingOptions
 * .rulerTracking shape as processVideo(), rather than requiring a
 * RulerCalibration specifically — the large majority of users are on fixed
 * calibration, and this mode should be just as available to them.
 */
export async function processVideoWithFrameCallback(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: CalibrationData,
  points: MeasurementPoint[],
  options: FrameCallbackOptions
): Promise<Record<string, WaveDataPoint[]>> {
  if (points.length === 0) {
    throw new Error("At least one measurement point is required");
  }
  if (!supportsVideoFrameCallback()) {
    throw new Error(
      "This browser does not support requestVideoFrameCallback — use the seek-based processing mode instead."
    );
  }

  const { columnWidth, searchMarginPx, smoothSigma, sampleRateHz } = options;
  const analysisStartTimeS = options.analysisStartTimeS ?? 0;
  const playbackRate = options.playbackRate ?? DEFAULT_PLAYBACK_RATE;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const duration = video.duration;

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
    return Math.min(video.videoWidth - 1, Math.max(0, Math.round(x)));
  }

  // Baselines: reuse the exact same (seek-based) computation processVideo()
  // uses. It's only ~30 short seeks total — negligible next to the main
  // playback-driven capture — and keeps baseline behavior identical between
  // both processing modes.
  const baselines = activeRulerTracker
    ? new Map(
        points.map((p) => [p.id, activeRulerTracker.valueCmToPixelY(p.baselineValueCm as number)])
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

  // Position at the analysis start before switching into playback mode.
  await captureFrameAtTime(video, canvas, analysisStartTimeS);

  const worker = new Worker(
    new URL("../workers/videoProcessing.worker.ts", import.meta.url),
    { type: "module" }
  );

  const stopPauseWatcher = options.isPausedRef
    ? startPauseWatcher(video, options.isPausedRef)
    : null;
  // Declared out here (rather than inside `try`, where it's assigned) purely
  // so `finally` below can still reach it to remove the listener — a
  // `function` declared inside a `try {}` block is block-scoped under strict
  // mode (which ES modules always are), not hoisted to the whole function.
  let handleEnded: (() => void) | null = null;

  try {
    const result: Record<string, WaveDataPoint[]> = {};
    const lastYByPoint = new Map<string, number | null>();
    for (const point of points) {
      result[point.id] = [];
      lastYByPoint.set(point.id, null);
    }

    const queue: QueuedFrame[] = [];
    let captureDone = false;
    let captureError: Error | null = null;
    let effectivePlaybackRate = playbackRate;
    // rVFC fires once per *decoded* frame — typically the source's native
    // frame rate (e.g. 30fps) regardless of playbackRate, which is usually
    // far denser than sampleRateHz actually needs. Only the first decoded
    // frame at/after each 1/sampleRateHz tick is captured (drawImage +
    // getImageData + worker round trip); the rest are skipped via a cheap
    // timestamp check. Without this, capture+worker cost scales with the
    // source's frame rate instead of the user's requested sample rate,
    // which can make this "fast" mode slower overall than seek-based for
    // short clips where per-seek overhead was never the bottleneck.
    let nextSampleTimeS = 0;
    const sampleIntervalS = 1 / sampleRateHz;

    function onFrame(_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) {
      if (captureDone) {
        return; // already finishing up; ignore any callback still in flight
      }

      try {
        const mediaTimeRelativeS = metadata.mediaTime - analysisStartTimeS;
        if (metadata.mediaTime >= duration) {
          captureDone = true;
          video.pause();
          return; // do not reschedule — capture is complete
        }

        if (mediaTimeRelativeS < nextSampleTimeS) {
          video.requestVideoFrameCallback(onFrame);
          return; // decoded frame arrived before the next sample tick — skip it
        }
        // Anchored to *this* frame's actual time rather than incremented
        // from the previous tick, so a stretch of sparse/slow decoding can't
        // make the schedule drift further and further behind real time.
        nextSampleTimeS = mediaTimeRelativeS + sampleIntervalS;

        const columnsByPoint = new Map(points.map((p) => [p.id, currentXColumn(p)]));
        const { xMin, xMax, relativeX } = getMultiColumnCropBounds(
          points.map((p) => columnsByPoint.get(p.id)!),
          columnWidth,
          video.videoWidth
        );

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not get a 2D rendering context from the canvas");
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (activeRulerTracker && activeRulerTracker.shouldCheck()) {
          const roiImageData = captureRoiFromCanvas(canvas, options.rulerTracking!.calibration.roi);
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

        const imageData = ctx.getImageData(xMin, 0, xMax - xMin + 1, canvas.height);
        const pixelsPerCmNow = Math.abs(
          activeRulerTracker ? activeRulerTracker.getCurrentFit().pixelsPerCm : calibration.pixelsPerCm
        );

        queue.push({
          imageData,
          mediaTimeRelativeS,
          relativeXByPointId: new Map(points.map((p, idx) => [p.id, relativeX[idx]])),
          xColumnByPointId: columnsByPoint,
          baselineYByPointId: new Map(baselines),
          pixelsPerCmNow,
        });

        if (queue.length > maxQueueSize) {
          effectivePlaybackRate = Math.max(MIN_AUTO_PLAYBACK_RATE, effectivePlaybackRate / 2);
          video.playbackRate = effectivePlaybackRate;
          console.warn(
            `Frame queue exceeded maxQueueSize (${maxQueueSize}) — the worker isn't keeping up ` +
              `with capture, halving playbackRate to ${effectivePlaybackRate}.`
          );
        }

        options.onProgress?.((mediaTimeRelativeS / (duration - analysisStartTimeS)) * 100);

        video.requestVideoFrameCallback(onFrame);
      } catch (error) {
        captureError = error instanceof Error ? error : new Error(String(error));
        captureDone = true;
      }
    }

    // Once real playback reaches the end of the media, the browser pauses
    // the video on its own and simply stops scheduling further rVFC
    // callbacks — there is no "final" callback with mediaTime >= duration to
    // catch that case inside onFrame itself. Without this listener,
    // captureDone would never be set and the consumer loop would wait
    // forever for a frame that will never arrive.
    handleEnded = () => {
      captureDone = true;
    };
    video.addEventListener("ended", handleEnded);

    video.playbackRate = effectivePlaybackRate;
    video.requestVideoFrameCallback(onFrame);
    await video.play();

    // Consumer loop: drains the queue in order (so lastYByPoint-based search
    // ranges stay sequential), independent of the capture loop's own pace.
    while (!captureDone || queue.length > 0) {
      const frame = queue.shift();
      if (!frame) {
        // Nothing to do yet — yield briefly rather than busy-spinning while
        // capture (or the browser's decode pipeline) catches up.
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      const pointRequests: PointRequest[] = points.map((point) => {
        const lastY = lastYByPoint.get(point.id) ?? null;
        // First frame (no prior lock): search only a bounded margin around
        // where the user clicked, never the whole column (Phase 16 fix —
        // matches processVideo's identical first-frame handling).
        const searchRange: [number, number] =
          lastY === null ? initialSearchRangeFor(point) : [lastY - searchMarginPx, lastY + searchMarginPx];
        return {
          pointId: point.id,
          xColumnRelative: frame.relativeXByPointId.get(point.id)!,
          searchRange,
        };
      });

      const responses = await requestFromWorker(
        worker,
        { imageData: frame.imageData, points: pointRequests, columnWidth, smoothSigma },
        [frame.imageData.data.buffer]
      );

      const detections: DetectionResult[] = [];

      for (const response of responses) {
        lastYByPoint.set(response.pointId, response.yPosition);
        const point = points.find((p) => p.id === response.pointId);
        const baselineY = frame.baselineYByPointId.get(response.pointId);
        if (baselineY === undefined || !point) {
          continue;
        }
        const elevationCm = (baselineY - response.yPosition) / frame.pixelsPerCmNow;
        result[response.pointId].push({
          timeS: frame.mediaTimeRelativeS,
          elevationCm,
          confidence: response.confidence,
        });
        detections.push({
          pointId: response.pointId,
          xColumn: frame.xColumnByPointId.get(point.id)!,
          yPosition: response.yPosition,
          confidence: response.confidence,
          lowConfidence: response.lowConfidence,
          color: point.color,
          baselineY,
        });
      }

      options.onFrameProcessed?.(detections);
    }

    if (captureError) {
      throw captureError;
    }

    return result;
  } finally {
    if (handleEnded) {
      video.removeEventListener("ended", handleEnded);
    }
    stopPauseWatcher?.();
    worker.terminate();
  }
}
