"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CalibrationData,
  MeasurementPoint,
  RulerCalibration,
  WaveDataPoint,
} from "@/types/wave";
import { processVideo, type DetectionResult } from "@/lib/videoProcessor";
import PointSelector from "@/components/PointSelector";
import LiveViewerCanvas from "@/components/LiveViewerCanvas";
import ProcessingControls from "@/components/ProcessingControls";

interface ProcessingPanelProps {
  videoUrl: string;
  calibration: CalibrationData;
  onComplete: (
    data: Record<string, WaveDataPoint[]>,
    points: MeasurementPoint[],
    sampleRateHz: number,
    /** The user's optional expected-wave-frequency hint (Hz), or null if left blank — used downstream to pick a detrend window and restrict the FFT peak search. */
    expectedFrequencyHz: number | null
  ) => void;
  /** When set (from RulerCalibrationPanel), points track the ruler continuously instead of using a fixed pixel column/baseline. */
  rulerCalibration?: RulerCalibration | null;
  cmPerTick?: number;
}

const MAX_POINTS = 8;
const DEBUG_MODE_DELAY_MS = 75;
const RULER_CHECK_INTERVAL_FRAMES = 10;
const RULER_MAX_FIT_ERROR_PX = 2.0;

export default function ProcessingPanel({
  videoUrl,
  calibration,
  onComplete,
  rulerCalibration = null,
  cmPerTick,
}: ProcessingPanelProps) {
  // Dedicated hidden video + visible frame canvas for processVideo()'s own
  // captures — separate from PointSelector's own video/canvas used just for
  // the picker UI. The frame canvas is visible (not display:none) so it can
  // double as the live preview underneath LiveViewerCanvas's overlay.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable mutable flag the processing loop polls directly — kept in sync
  // with the `isPaused` state (which exists only to re-render the button label).
  const isPausedRef = useRef({ current: false }).current;
  const frameCounterRef = useRef(0);

  const [isMetadataReady, setIsMetadataReady] = useState(false);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [sampleRateHz, setSampleRateHz] = useState("10");
  const [expectedFrequencyHz, setExpectedFrequencyHz] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [overlayEveryNFrames, setOverlayEveryNFrames] = useState(1);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [rulerCheckFailures, setRulerCheckFailures] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setIsMetadataReady(false);

    function handleLoadedMetadata() {
      setIsMetadataReady(true);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [videoUrl]);

  const parsedSampleRate = parseFloat(sampleRateHz);

  // Optional: blank is valid (means "no hint"), but a non-blank value must be
  // a usable positive number or processing is blocked — a silently-ignored
  // typo here would be confusing since it changes detrending/FFT-search behavior.
  const trimmedExpectedFrequency = expectedFrequencyHz.trim();
  const parsedExpectedFrequency =
    trimmedExpectedFrequency === "" ? null : parseFloat(trimmedExpectedFrequency);
  const hasInvalidExpectedFrequency =
    trimmedExpectedFrequency !== "" &&
    (!Number.isFinite(parsedExpectedFrequency) || (parsedExpectedFrequency ?? 0) <= 0);

  const missingBaselines =
    !!rulerCalibration && points.some((point) => point.baselineValueCm === null);

  const canStart =
    isMetadataReady &&
    !isProcessing &&
    points.length > 0 &&
    !missingBaselines &&
    !hasInvalidExpectedFrequency &&
    Number.isFinite(parsedSampleRate) &&
    parsedSampleRate > 0;

  function handleTogglePause() {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
  }

  function handleFrameProcessed(detections: DetectionResult[]) {
    frameCounterRef.current += 1;
    if (frameCounterRef.current % overlayEveryNFrames === 0) {
      setCurrentDetections(detections);
    }
  }

  async function handleStart() {
    const video = videoRef.current;
    const canvas = processingCanvasRef.current;
    if (!video || !canvas || !canStart) {
      return;
    }

    isPausedRef.current = false;
    frameCounterRef.current = 0;
    setIsPaused(false);
    setCurrentDetections([]);
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setResultCount(null);
    setRulerCheckFailures(0);

    try {
      const data = await processVideo(video, canvas, calibration, {
        points,
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        sampleRateHz: parsedSampleRate,
        onProgress: (percent) => setProgress(percent),
        onFrameProcessed: handleFrameProcessed,
        onRulerCheckFailed: () => setRulerCheckFailures((count) => count + 1),
        isPausedRef,
        debugDelayMs: debugMode ? DEBUG_MODE_DELAY_MS : undefined,
        rulerTracking:
          rulerCalibration && cmPerTick
            ? {
                calibration: rulerCalibration,
                cmPerTick,
                checkIntervalFrames: RULER_CHECK_INTERVAL_FRAMES,
                maxFitError: RULER_MAX_FIT_ERROR_PX,
              }
            : undefined,
      });

      const totalPoints = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
      setResultCount(totalPoints);
      onComplete(data, points, parsedSampleRate, parsedExpectedFrequency);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Off-screen video; the frame canvas below stays visible so it can act as the live preview. */}
      <video ref={videoRef} className="hidden" muted playsInline />

      <PointSelector
        videoUrl={videoUrl}
        onChange={setPoints}
        maxPoints={MAX_POINTS}
        rulerCalibration={rulerCalibration}
      />

      {missingBaselines && (
        <p className="text-sm text-amber-600">
          Every point needs a still-water baseline entered in cm before processing can start.
        </p>
      )}

      {hasInvalidExpectedFrequency && (
        <p className="text-sm text-amber-600">
          Expected wave frequency must be a positive number, or left blank.
        </p>
      )}

      {/* Kept as one persistent element (never unmounted) so processingCanvasRef
          always points to the same node processVideo() is capturing into —
          only its visibility toggles, so the live preview actually shows the
          frames being captured instead of a freshly-mounted blank canvas. */}
      <div
        className={`relative w-full max-w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 ${
          isProcessing ? "" : "hidden"
        }`}
      >
        <canvas ref={processingCanvasRef} className="block w-full max-w-full" />
        <LiveViewerCanvas
          videoCanvasRef={processingCanvasRef}
          currentDetections={currentDetections}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Sample rate (Hz)
          <input
            type="number"
            min={1}
            step="any"
            value={sampleRateHz}
            onChange={(event) => setSampleRateHz(event.target.value)}
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Expected wave frequency (Hz, optional)
          <input
            type="number"
            min={0}
            step="any"
            value={expectedFrequencyHz}
            onChange={(event) => setExpectedFrequencyHz(event.target.value)}
            placeholder="e.g. 0.4"
            aria-label="Expected wave frequency in Hz"
            className="w-40 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isProcessing ? "Processing…" : "Start Processing"}
        </button>
      </div>

      <ProcessingControls
        isProcessing={isProcessing}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        debugMode={debugMode}
        onDebugModeChange={setDebugMode}
        overlayEveryNFrames={overlayEveryNFrames}
        onOverlayEveryNFramesChange={setOverlayEveryNFrames}
      />

      {isProcessing && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {rulerCheckFailures > 0 && (
        <p className="text-sm text-amber-600">
          Ruler re-calibration was skipped {rulerCheckFailures} time
          {rulerCheckFailures === 1 ? "" : "s"} (tick fit error too high) — those
          stretches reused the last good scale, so check that the ruler stayed
          visible and in focus.
        </p>
      )}

      {resultCount !== null && !isProcessing && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Processed {resultCount} data points across {points.length} measurement point
          {points.length === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}
